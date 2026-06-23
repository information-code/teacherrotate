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

/** 全校固定占用（如本土語）：套用到所有班的同一時段。 */
export interface FixedSlot { id: string; label: string; slots: Slot[] }

export interface ScheduleConfig {
  bands: Record<Band, BandGrid>
  fixedSlots: FixedSlot[]                         // 全校固定（本土語…）
  bandCommonOff: Record<Band, Slot[]>             // 學年導師共同不排課（該年段全導師空出）
  classBlocks: Record<string, Slot[]>             // 班級封鎖（種子班…）classKey = `${grade}-${index}`
  teacherOff: Record<string, Slot[]>              // 教師不排課（由排課需求帶出後課務組填）
  classTeacher: Record<string, string>            // 導師配班：classKey → teacherId（管理者指定）
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
    fixedSlots: [],
    bandCommonOff: { low: [], mid: [], high: [] },
    classBlocks: {},
    teacherOff: {},
    classTeacher: {},
  }
}

export function normalizeScheduleConfig(raw: unknown): ScheduleConfig {
  const base = defaultScheduleConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<ScheduleConfig>
  const bands = {} as Record<Band, BandGrid>
  for (const b of BANDS) {
    const g = r.bands?.[b]
    bands[b] = g && typeof g === 'object'
      ? { periodsPerDay: Number(g.periodsPerDay ?? DEFAULT_PERIODS), teachable: { ...(g.teachable ?? {}) } }
      : bandGridWithHalfDays(DEFAULT_HALF_DAYS[b])
  }
  return {
    bands,
    fixedSlots: Array.isArray(r.fixedSlots) ? r.fixedSlots.map(f => ({ id: String(f.id ?? ''), label: String(f.label ?? ''), slots: Array.isArray(f.slots) ? f.slots : [] })) : [],
    bandCommonOff: {
      low: r.bandCommonOff?.low ?? [], mid: r.bandCommonOff?.mid ?? [], high: r.bandCommonOff?.high ?? [],
    },
    classBlocks: r.classBlocks ?? {},
    teacherOff: r.teacherOff ?? {},
    classTeacher: r.classTeacher ?? {},
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
