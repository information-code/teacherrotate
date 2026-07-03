// 排課（timetabling）共用型別與演算法。
// 輸入＝配課結果（哪位老師教哪些班的哪些科目幾節）＋排課設定（時段格、各種占用）。
// 輸出＝每班課表、每位老師課表、未能排入的清單。
// MVP 採貪婪（greedy）：硬限制＝教師同時段不衝突＋封鎖時段；軟限制＝同科盡量分散到不同天。

// ── 時間軸 ──
export const SCHEDULE_DAYS = [1, 2, 3, 4, 5] as const   // 週一~週五
export const DAY_LABEL: Record<number, string> = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' }
export const DEFAULT_PERIODS = 7                          // 每天節次上限（可於設定調整）

export type Band = 'low' | 'mid' | 'high'
export const BANDS: Band[] = ['low', 'mid', 'high']
export const BAND_LABEL: Record<Band, string> = { low: '低年級', mid: '中年級', high: '高年級' }
export const BAND_GRADES: Record<Band, number[]> = { low: [1, 2], mid: [3, 4], high: [5, 6] }
export function bandOf(grade: number): Band {
  if (grade <= 2) return 'low'
  if (grade <= 4) return 'mid'
  return 'high'
}

export interface Slot { day: number; period: number }
export function slotKey(s: Slot): string { return `${s.day}-${s.period}` }
export function parseSlotKey(k: string): Slot { const [d, p] = k.split('-').map(Number); return { day: d, period: p } }

// ── 排課設定 ──

/** 一個年段的時段格：哪些 (day,period) 是「可排課節」。 */
export interface BandGrid {
  periodsPerDay: number                 // 該年段每天節次數（上限）
  teachable: Record<string, boolean>    // key = `${day}-${period}` → 是否可排課節
}

/** 鎖課名目：名目（label）給管理者辨識、科目（subject）顯示在課表格子上。 */
export interface LockType { id: string; label: string; subject: string; color: string }

// 鎖課名目可選的低彩度色票（key 存進設定，顯示時查表）
export const LOCK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  rose:   { bg: '#ffe4e6', text: '#9f1239', border: '#fda4af' },
  amber:  { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  lime:   { bg: '#ecfccb', text: '#3f6212', border: '#bef264' },
  teal:   { bg: '#ccfbf1', text: '#115e59', border: '#5eead4' },
  sky:    { bg: '#e0f2fe', text: '#075985', border: '#7dd3fc' },
  violet: { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },
  pink:   { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  slate:  { bg: '#e2e8f0', text: '#334155', border: '#94a3b8' },
}
export const LOCK_COLOR_KEYS = Object.keys(LOCK_COLORS)

// 個人不排課類別
export type OffCategory = 'counseling' | 'admin' | 'training' | 'other'
export const OFF_CATEGORIES: OffCategory[] = ['counseling', 'admin', 'training', 'other']
export const OFF_CATEGORY_LABEL: Record<OffCategory, string> = {
  counseling: '輔導團', admin: '行政', training: '進修', other: '其他',
}

/** 個人不排課：該教師這些時段不排課（導師→班級課表該時段排科任課；科任→該時段留空）。 */
export interface PersonalOff {
  id: string
  teacherId: string
  category: OffCategory
  note: string            // 補充說明（類別為其他時建議填）
  slots: string[]         // slotKey 列表
}

/** 科任配班中「導師自上」的特殊值（該班該科由導師授課，不指派科任）。 */
export const HOMEROOM_SELF = '__homeroom__'
export function subjectClassKey(grade: number, index: number, subject: string): string {
  return `${grade}-${index}|${subject}`
}

export interface ScheduleConfig {
  bands: Record<Band, BandGrid>
  classTeacher: Record<string, string>            // 導師配班：classKey → teacherId（管理者指定）
  subjectClassTeacher: Record<string, string>     // 科任配班：`${grade}-${index}|${subject}` → teacherId 或 HOMEROOM_SELF
  lockTypes: LockType[]                           // 鎖課名目
  lockCells: Record<string, Record<string, string>>  // 鎖課標記：classKey → slotKey → lockTypeId
  gradeCommonOff: Record<string, string[]>        // 學年共同不排課：年級("1"~"6") → slotKey 列表（連動該年級所有導師）
  personalOff: PersonalOff[]                      // 個人不排課
}

/** 產生一張時段格：halfDays 中的星期只開 1~4 節（半天），其餘整天 7 節。 */
export function bandGridWithHalfDays(halfDays: number[]): BandGrid {
  const teachable: Record<string, boolean> = {}
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= DEFAULT_PERIODS; p++) {
    teachable[`${d}-${p}`] = halfDays.includes(d) ? p <= 4 : true
  }
  return { periodsPerDay: DEFAULT_PERIODS, teachable }
}
export function defaultBandGrid(): BandGrid { return bandGridWithHalfDays([]) }

// 預設半天（只開 1~4 節）：低年級 一三四五、中年級 一三五、高年級 三
export const DEFAULT_HALF_DAYS: Record<Band, number[]> = { low: [1, 3, 4, 5], mid: [1, 3, 5], high: [3] }

export function defaultScheduleConfig(): ScheduleConfig {
  return {
    bands: {
      low: bandGridWithHalfDays(DEFAULT_HALF_DAYS.low),
      mid: bandGridWithHalfDays(DEFAULT_HALF_DAYS.mid),
      high: bandGridWithHalfDays(DEFAULT_HALF_DAYS.high),
    },
    classTeacher: {},
    subjectClassTeacher: {},
    lockTypes: [],
    lockCells: {},
    gradeCommonOff: {},
    personalOff: [],
  }
}

export function normalizeScheduleConfig(raw: unknown): ScheduleConfig {
  const base = defaultScheduleConfig()
  if (!raw || typeof raw !== 'object') return base
  // 舊欄位 bandCommonOff（年段 Slot[]）→ 遷移為 gradeCommonOff（年級 slotKey[]）
  const r = raw as Partial<ScheduleConfig> & { bandCommonOff?: Record<Band, Slot[]> }
  const bands = {} as Record<Band, BandGrid>
  for (const b of BANDS) {
    const g = r.bands?.[b]
    bands[b] = g && typeof g === 'object'
      ? { periodsPerDay: Number(g.periodsPerDay ?? DEFAULT_PERIODS), teachable: { ...(g.teachable ?? {}) } }
      : bandGridWithHalfDays(DEFAULT_HALF_DAYS[b])
  }
  let gradeCommonOff: Record<string, string[]> = {}
  if (r.gradeCommonOff && typeof r.gradeCommonOff === 'object') {
    for (const [g, v] of Object.entries(r.gradeCommonOff)) {
      if (Array.isArray(v)) gradeCommonOff[g] = v.map(String)
    }
  } else if (r.bandCommonOff) {
    for (const b of BANDS) {
      const slots = (r.bandCommonOff[b] ?? []).map(s => slotKey(s))
      if (slots.length) for (const g of BAND_GRADES[b]) gradeCommonOff[String(g)] = [...slots]
    }
  }
  const lockCells: Record<string, Record<string, string>> = {}
  if (r.lockCells && typeof r.lockCells === 'object') {
    for (const [ck, m] of Object.entries(r.lockCells)) {
      if (m && typeof m === 'object') lockCells[ck] = { ...m }
    }
  }
  return {
    bands,
    classTeacher: r.classTeacher ?? {},
    subjectClassTeacher: r.subjectClassTeacher ?? {},
    lockTypes: Array.isArray(r.lockTypes)
      ? r.lockTypes.map(t => ({
          id: String(t.id ?? ''), label: String(t.label ?? ''), subject: String(t.subject ?? ''),
          color: LOCK_COLORS[String(t.color ?? '')] ? String(t.color) : LOCK_COLOR_KEYS[0],
        }))
      : [],
    lockCells,
    gradeCommonOff,
    personalOff: Array.isArray(r.personalOff)
      ? r.personalOff.map(p => ({
          id: String(p.id ?? ''), teacherId: String(p.teacherId ?? ''),
          category: OFF_CATEGORIES.includes(p.category as OffCategory) ? p.category as OffCategory : 'other',
          note: String(p.note ?? ''), slots: Array.isArray(p.slots) ? p.slots.map(String) : [],
        }))
      : [],
  }
}

/** 取一個年段時段格中所有可排課的 slotKey（依星期、節次排序）。 */
export function gridSlotKeys(grid: BandGrid): string[] {
  const out: string[] = []
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) {
    if (grid.teachable[`${d}-${p}`]) out.push(`${d}-${p}`)
  }
  return out
}

// ── 班級 / 課 ──
export interface ClassRef { grade: number; index: number }   // index 0-based
export function classKey(grade: number, index: number): string { return `${grade}-${index}` }
export function classLabel(grade: number, index: number): string { return `${grade}年${index + 1}班` }

/** 科任平均分配：把某年級某科的各班，平均分給有配該科該年級的科任。
 *  teachers: 該科該年級的科任，hours = 其 subjectGradeHours[subject][grade]。
 *  回傳 classIndex → 老師（容量 = floor(hours / perClass)）；容量不足的班回傳 null（未指派）。
 */
export function distributeClasses(
  classCount: number, perClass: number,
  teachers: { id: string; name: string; hours: number }[],
): (({ id: string; name: string }) | null)[] {
  const result: (({ id: string; name: string }) | null)[] = new Array(classCount).fill(null)
  if (perClass <= 0) return result
  // 依容量展開成「班級配額」佇列，老師依序認領班級
  const queue: { id: string; name: string }[] = []
  for (const t of teachers) {
    const cap = Math.floor((Number(t.hours) || 0) / perClass)
    for (let i = 0; i < cap; i++) queue.push({ id: t.id, name: t.name })
  }
  for (let c = 0; c < classCount; c++) result[c] = queue[c] ?? null
  return result
}

// ── 排課演算法 ──

/** 一節待排的課（某班某科一節，已指定老師）。 */
export interface Lesson { classKey: string; subject: string; teacherId: string; teacherName: string }

export interface PlanInput {
  classKeys: string[]                                   // 要排的班（該年段）
  slotKeys: string[]                                    // 可排課時段（年段時段格）
  lessons: Lesson[]                                     // 全部待排節（每節一筆）
  classBlocked: Record<string, Set<string>>             // classKey → 封鎖 slotKey（班級封鎖＋固定占用）
  teacherBlocked: Record<string, Set<string>>           // teacherId → 封鎖 slotKey（不排課＋共同時段）
}

export interface PlacedLesson { classKey: string; slot: Slot; subject: string; teacherId: string; teacherName: string }
export interface UnplacedLesson { classKey: string; subject: string; teacherId: string; teacherName: string; count: number }
export interface PlanResult { placed: PlacedLesson[]; unplaced: UnplacedLesson[] }

/**
 * 貪婪排課：
 *  1. 先排「最難排」的課（老師越忙、待排越多者越先排），降低後段卡死機率。
 *  2. 每節找一個格子，需同時滿足：該班該時段空 + 該老師該時段空 + 非封鎖。
 *  3. 軟限制：同班同科盡量不排在同一天（優先選該科尚未用過的星期）。
 *  4. 排不進 → 計入未排清單。
 */
export function planSchedule(input: PlanInput): PlanResult {
  const { slotKeys, classBlocked, teacherBlocked } = input

  // 已占用：classKey → Set<slotKey>、teacherId → Set<slotKey>
  const classBusy: Record<string, Set<string>> = {}
  const teacherBusy: Record<string, Set<string>> = {}
  for (const ck of input.classKeys) classBusy[ck] = new Set(classBlocked[ck] ?? [])
  // 同班同科已用過的星期：`${classKey}|${subject}` → Set<day>
  const subjDays: Record<string, Set<number>> = {}

  const tBlocked = (id: string) => teacherBlocked[id] ?? new Set<string>()
  const tBusy = (id: string) => (teacherBusy[id] ??= new Set<string>())

  // 老師總負擔（越忙越先排）
  const load: Record<string, number> = {}
  for (const l of input.lessons) load[l.teacherId] = (load[l.teacherId] || 0) + 1
  const lessons = [...input.lessons].sort((a, b) => (load[b.teacherId] - load[a.teacherId]))

  const placed: PlacedLesson[] = []
  const unplacedMap: Record<string, UnplacedLesson> = {}

  for (const l of lessons) {
    const cBusy = classBusy[l.classKey] ?? (classBusy[l.classKey] = new Set())
    const tb = tBlocked(l.teacherId), tu = tBusy(l.teacherId)
    const usedDays = (subjDays[`${l.classKey}|${l.subject}`] ??= new Set())

    // 候選格子：班空 + 老師空（未封鎖、未占用）
    const candidates = slotKeys.filter(k => {
      if (cBusy.has(k)) return false
      if (tb.has(k) || tu.has(k)) return false
      return true
    })
    if (candidates.length === 0) {
      const key = `${l.classKey}|${l.subject}|${l.teacherId}`
      ;(unplacedMap[key] ??= { classKey: l.classKey, subject: l.subject, teacherId: l.teacherId, teacherName: l.teacherName, count: 0 }).count++
      continue
    }
    // 軟限制：優先選該科尚未用過的星期
    const fresh = candidates.filter(k => !usedDays.has(parseSlotKey(k).day))
    const pick = (fresh.length ? fresh : candidates)[0]
    const slot = parseSlotKey(pick)

    cBusy.add(pick); tu.add(pick); usedDays.add(slot.day)
    placed.push({ classKey: l.classKey, slot, subject: l.subject, teacherId: l.teacherId, teacherName: l.teacherName })
  }

  return { placed, unplaced: Object.values(unplacedMap) }
}
