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

/** 鎖課名目：名目（label）給管理者辨識、科目（subject）顯示在課表格子上。
 *  isNative＝本土語鎖課（本土語開課表的時段來源、班級格顯示閩南語師，與名目取名無關）。 */
export interface LockType { id: string; label: string; subject: string; color: string; isNative: boolean }

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

// ── 教室設定 ──
// 目的：一、讓系統知道哪些教室同層同區、彼此接近（排課走動成本）；
//       二、統計科任教室數（每間需要一張科任教室課表）。
export type RoomKind = 'class' | 'subject' | 'native' | 'none'
export const ROOM_KIND_LABEL: Record<RoomKind, string> = { class: '一般教室', subject: '科任教室', native: '本土語言教室', none: '其他／未使用' }

/** 一間教室：一般教室填班級（classKey）、科任教室填名稱＋選填編號（同名多間，如自然教室一、二）
 *  ＋對應科目（排課據此計算教室衝突與走動成本；空＝不綁科目）
 *  ＋管理教師（managerId，選填）：排課時該教室優先給管理教師的課使用
 *  ＋可排語別（langs，本土語言教室用）：非清單內的語別不可排；空＝任何語別皆可。 */
export interface Room { id: string; kind: RoomKind; classKey: string; name: string; no: string; subject: string; managerId: string; langs: string[] }

// 本土語語別（語別課程用；閩南語走班級的本土語科目）
export const NATIVE_LANGS = ['閩南語', '客語（四縣）', '客語（海陸）', '台灣手語', '原住民族語', '新住民語', '閩東語']

/** 本土語場次狀態覆寫：場次由 鎖課時段×語別課程配課 自動推導，預設全部實體（維持）。
 *  課表生成後管理者依實際情況覆寫：stream＝直播共學（不具名）、cancelled＝取消（學生回原班上閩南語）。
 *  key = `${slotKey}|${課程名}|${grade}` */
export interface NativeLangConfig {
  states: Record<string, 'stream' | 'cancelled'>
}

/** 科任教室顯示名稱＝名稱＋編號。 */
export function roomLabel(r: Pick<Room, 'name' | 'no'>): string {
  return `${r.name}${r.no}`
}

/** 一個區域：同層樓一排彼此相鄰的教室。ring＝環狀（首尾也相鄰）；否則直排（首尾最遠）。 */
export interface RoomZone { id: string; floor: string; area: string; ring: boolean; rooms: Room[] }

// 科任教室常用名稱（datalist 快選用）
export const SUBJECT_ROOM_PRESETS = [
  '音樂教室', '自然教室', '英語教室', '電腦教室', '科技教室', '資訊教室', '視覺藝術教室', '表演藝術教室', '律動教室', '圖書室', '活動中心',
]

// ── 權重設定 ──
// 引擎只排科任課，所有規則的作用對象都是「科任課的落點」；保護導師是部分規則的目的，不是機制。
// 權重五段：關/低/中/高/必須 → 罰分 0/1/3/9/硬限制（指數型，高一項抵低九項）。

// 權重四段：關/低/中/高。硬性要求一律列為固定硬限制（引擎絕不違反），不提供「必須」權重。
// type 仍保留 'must' 以相容舊資料，normalize 時自動降為 'high'。
export type WeightLevel = 'off' | 'low' | 'mid' | 'high' | 'must'
export const WEIGHT_LEVELS: WeightLevel[] = ['off', 'low', 'mid', 'high']
export const WEIGHT_LEVEL_LABEL: Record<WeightLevel, string> = { off: '關閉', low: '低', mid: '中', high: '高', must: '必須' }
export const WEIGHT_PENALTY: Record<WeightLevel, number> = { off: 0, low: 1, mid: 3, high: 9, must: Infinity }

/** 內建規則（只能調權重與參數，不能增刪）。 */
export interface BuiltinRules {
  dailyMax: { level: WeightLevel; n: number }     // 科任每日節數上限 N
  consecMax: { level: WeightLevel; n: number }    // 連續授課軟上限 N（永不連 7＝固定硬限制，絕對上限 6 連）
  compact: WeightLevel                            // 減少零碎空堂（單一空堂的多寡；「上空上空」交錯為固定硬限制）
  dayBalance: WeightLevel                         // 教師每日負擔平衡
  // 已升級為固定硬限制（2026-07-04 使用者拍板，不再是權重）：
  //   同型態同日（連堂日/單節日不混）、同科同日、同科不隔天、科任課同日成塊
  // 已刪除（被硬限制自動涵蓋）：連堂單節分半週（間隔≥2天的組合必然跨半週）
  walkCost: WeightLevel                           // 走動成本（依教室設定相鄰距離）
  roomPrefer: WeightLevel                         // 專科教室優先（不夠時回原班）
  roomManagerFirst: WeightLevel                   // 教室管理教師優先：管理者必得自己的教室（結構保證）；非管理者用到有管理者的教室時扣分
  homeroomMorning: WeightLevel                    // 科任課讓出上午（導師留白集中上午，利於導師排國數）
  homeroomBalance: WeightLevel                    // 班級科任課每日平衡＝導師的每日負擔平衡（留白分散）
  homeroomDailyMax: { level: WeightLevel; n: number }  // 導師每日節數上限：每班每日留白 ≤ N（科任課至少補到 每日格數−N）
  artBiweekly: { enabled: boolean; grades: number[] }  // 視藝單雙週連堂（占固定兩格，藝術週/導師週輪替；單週組起始 1,3,5、雙週組 2,4,6）
}

/** 模板規則：管理者可無限新增實例，引擎實作模板計分邏輯。 */
export type RuleTemplate = 'avoidPeriods' | 'noConsecDays' | 'doublePeriod' | 'timePrefer'
export const RULE_TEMPLATE_LABEL: Record<RuleTemplate, string> = {
  avoidPeriods: '科目避開節次', noConsecDays: '科目不連續日', doublePeriod: '科目連堂', timePrefer: '科目時段偏好',
}
export interface TemplateRule {
  id: string
  template: RuleTemplate
  subjects: string[]              // 適用科目
  grades: number[]                // 適用年級（空＝全部年級）
  level: WeightLevel
  periods?: number[]              // avoidPeriods：避開的節次
  fullDayOnly?: boolean           // avoidPeriods：僅整天日適用（如避第 7 節，不影響半天日第 4 節）
  pref?: 'morning' | 'afternoon'  // timePrefer：偏好時段
}

export interface ScheduleWeights {
  builtin: BuiltinRules
  templates: TemplateRule[]
}

export function defaultScheduleWeights(): ScheduleWeights {
  return {
    builtin: {
      dailyMax: { level: 'high', n: 6 },
      consecMax: { level: 'high', n: 3 },
      compact: 'low',
      dayBalance: 'low',
      walkCost: 'mid',
      roomPrefer: 'high',
      roomManagerFirst: 'mid',
      homeroomMorning: 'mid',
      homeroomBalance: 'low',
      homeroomDailyMax: { level: 'high', n: 5 },
      artBiweekly: { enabled: true, grades: [4, 6] },
    },
    templates: [
      { id: 'tpl-pe-lunch', template: 'avoidPeriods', subjects: ['體育'], grades: [], periods: [4, 5], level: 'mid' },
      { id: 'tpl-exam-last', template: 'avoidPeriods', subjects: ['社會', '自然', '英語'], grades: [], periods: [7], fullDayOnly: true, level: 'mid' },
      { id: 'tpl-dbl-nature', template: 'doublePeriod', subjects: ['自然'], grades: [], level: 'high' },
      { id: 'tpl-dbl-social', template: 'doublePeriod', subjects: ['社會'], grades: [], level: 'high' },
      { id: 'tpl-dbl-life', template: 'doublePeriod', subjects: ['生活'], grades: [], level: 'high' },
      { id: 'tpl-dbl-maker', template: 'doublePeriod', subjects: ['智慧探究家：科技創新任務'], grades: [], level: 'high' },
      { id: 'tpl-dbl-art', template: 'doublePeriod', subjects: ['視覺藝術'], grades: [3, 5], level: 'high' },
    ],
  }
}

const WEIGHT_LEVEL_SET = new Set<string>(WEIGHT_LEVELS)
function normLevel(v: unknown, fallback: WeightLevel): WeightLevel {
  if (v === 'must') return 'high'   // 舊資料的「必須」一律降為「高」（硬性要求已改為固定硬限制）
  return WEIGHT_LEVEL_SET.has(String(v)) ? v as WeightLevel : fallback
}

export function normalizeScheduleWeights(raw: unknown): ScheduleWeights {
  const base = defaultScheduleWeights()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<ScheduleWeights>
  const b = (r.builtin ?? {}) as Partial<BuiltinRules>
  const db = base.builtin
  return {
    builtin: {
      dailyMax: { level: normLevel(b.dailyMax?.level, db.dailyMax.level), n: Number(b.dailyMax?.n ?? db.dailyMax.n) },
      consecMax: { level: normLevel(b.consecMax?.level, db.consecMax.level), n: Number(b.consecMax?.n ?? db.consecMax.n) },
      compact: normLevel(b.compact, db.compact),
      dayBalance: normLevel(b.dayBalance, db.dayBalance),
      walkCost: normLevel(b.walkCost, db.walkCost),
      roomPrefer: normLevel(b.roomPrefer, db.roomPrefer),
      roomManagerFirst: normLevel(b.roomManagerFirst, db.roomManagerFirst),
      homeroomMorning: normLevel(b.homeroomMorning, db.homeroomMorning),
      homeroomBalance: normLevel(b.homeroomBalance, db.homeroomBalance),
      homeroomDailyMax: { level: normLevel(b.homeroomDailyMax?.level, db.homeroomDailyMax.level), n: Number(b.homeroomDailyMax?.n ?? db.homeroomDailyMax.n) },
      artBiweekly: {
        enabled: b.artBiweekly?.enabled !== false,
        grades: Array.isArray(b.artBiweekly?.grades) ? b.artBiweekly!.grades.map(Number) : [...db.artBiweekly.grades],
      },
    },
    templates: Array.isArray(r.templates)
      ? r.templates.filter(t => t.template !== 'noConsecDays')   // 已被硬限制「同科不隔天」涵蓋
        .map(t => ({
          id: String(t.id ?? ''),
          template: (['avoidPeriods', 'noConsecDays', 'doublePeriod', 'timePrefer'] as RuleTemplate[]).includes(t.template as RuleTemplate) ? t.template as RuleTemplate : 'avoidPeriods',
          subjects: Array.isArray(t.subjects) ? t.subjects.map(String) : [],
          grades: Array.isArray(t.grades) ? t.grades.map(Number) : [],
          level: normLevel(t.level, 'mid'),
          periods: Array.isArray(t.periods) ? t.periods.map(Number) : undefined,
          fullDayOnly: t.fullDayOnly === true ? true : undefined,
          pref: t.pref === 'morning' || t.pref === 'afternoon' ? t.pref : undefined,
        }))
      : base.templates,
  }
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
  roomZones: RoomZone[]                           // 教室設定：樓層×區域×相鄰教室
  weights: ScheduleWeights                        // 權重設定：內建規則＋模板規則實例
  nativeLang: NativeLangConfig                    // 本土語設定：老師語別＋開課表
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
    roomZones: [],
    weights: defaultScheduleWeights(),
    nativeLang: { states: {} },
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
          // 舊資料自動遷移：科目為「本土語」者視為本土語鎖課
          isNative: t.isNative === true || String(t.subject ?? '') === '本土語',
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
    roomZones: Array.isArray(r.roomZones)
      ? r.roomZones.map(z => ({
          id: String(z.id ?? ''), floor: String(z.floor ?? ''), area: String(z.area ?? ''),
          ring: Boolean(z.ring),
          rooms: Array.isArray(z.rooms)
            ? z.rooms.map(rm => ({
                id: String(rm.id ?? ''),
                kind: (['class', 'subject', 'native', 'none'] as RoomKind[]).includes(rm.kind as RoomKind) ? rm.kind as RoomKind : 'class',
                classKey: String(rm.classKey ?? ''), name: String(rm.name ?? ''), no: String(rm.no ?? ''),
                subject: String(rm.subject ?? ''), managerId: String(rm.managerId ?? ''),
                langs: Array.isArray(rm.langs) ? rm.langs.map(String) : [],
              }))
            : [],
        }))
      : [],
    weights: normalizeScheduleWeights((raw as Record<string, unknown>).weights),
    nativeLang: (() => {
      const n = (raw as { nativeLang?: Partial<NativeLangConfig> }).nativeLang
      const states: Record<string, 'stream' | 'cancelled'> = {}
      for (const [k, v] of Object.entries(n?.states ?? {})) {
        if (v === 'stream' || v === 'cancelled') states[k] = v
      }
      return { states }
    })(),
  }
}

// ── 本土語場次自動推導 ──
// 前提紀律（前置檢查把關）：某語別課程×年級的配課節數 ＝ 該年級本土語鎖課「相異時段數」。
// 全部預設實體；states 覆寫為直播/取消。教室自動分配（依可排語別，一室一語別一時段）。
export interface DerivedNativeSession {
  slot: string
  course: string          // 語別課程名（配課設定「其他」）
  lang: string
  grade: number
  teacherId: string       // 配課推導（含虛擬帳號）；'' ＝配課不足
  roomId: string | null   // 自動分配；null ＝教室不足
  state: 'physical' | 'stream' | 'cancelled'
}

export function deriveNativeSessions(opts: {
  config: ScheduleConfig
  extraCourses: { lang: string; grade: number; hours: number }[]   // 年級×語別×需求總節數
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>   // tid → 語別 → 年級 → 節數
}): { sessions: DerivedNativeSession[]; issues: { level: 'error' | 'warn'; text: string; tab?: string }[] } {
  const { config, extraCourses, hoursByTeacher } = opts
  const issues: { level: 'error' | 'warn'; text: string; tab?: string }[] = []
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))

  // 各年級本土語鎖課相異時段
  const gradeSlots: Record<number, string[]> = {}
  for (const [ck2, cells] of Object.entries(config.lockCells)) {
    const g = Number(ck2.split('-')[0])
    for (const [slot, tid] of Object.entries(cells)) {
      if (!nativeTypeIds.has(tid)) continue
      const arr = (gradeSlots[g] ??= [])
      if (!arr.includes(slot)) arr.push(slot)
    }
  }
  for (const arr of Object.values(gradeSlots)) {
    arr.sort((a, b) => { const A = parseSlotKey(a), B = parseSlotKey(b); return A.day - B.day || A.period - B.period })
  }

  const nativeRooms: { id: string; label: string; langs: string[] }[] = []
  for (const z of config.roomZones) for (const r of z.rooms) {
    if (r.kind === 'native') nativeRooms.push({ id: r.id, label: (r.name || '本土語言教室') + r.no, langs: r.langs })
  }

  const gradeZh = ['', '一', '二', '三', '四', '五', '六']
  const sessions: DerivedNativeSession[] = []
  for (const c of extraCourses) {
    if (!c.lang) continue
    const g = c.grade
    // 該語別×年級的老師（依配課節數展開；科目名＝語別名）
    const exp: string[] = []
    for (const [tid, m] of Object.entries(hoursByTeacher)) {
      const h = Number(m[c.lang]?.[String(g)]) || 0
      for (let i = 0; i < h; i++) exp.push(tid)
    }
    if (c.hours > 0 && exp.length !== c.hours) {
      issues.push({
        level: 'warn',
        text: `「${c.lang}」${gradeZh[g]}年級已配 ${exp.length} 節／需求 ${c.hours} 節${exp.length < c.hours ? '——差額請於配課統計建立虛擬帳號補足' : '（超配）'}。`,
      })
    }
    if (exp.length === 0 && c.hours === 0) continue
    const slots = gradeSlots[g] ?? []
    if (exp.length !== slots.length) {
      issues.push({
        level: 'warn',
        text: `「${c.lang}」${gradeZh[g]}年級配課 ${exp.length} 節，但該年級本土語鎖課有 ${slots.length} 個相異時段——需相等才能自動推導場次（請調整配課或鎖課）。`,
        tab: 'lock',
      })
    }
    for (let i = 0; i < slots.length; i++) {
      const key = `${slots[i]}|${c.lang}|${g}`
      sessions.push({
        slot: slots[i], course: c.lang, lang: c.lang, grade: g,
        teacherId: exp[i] ?? '',
        roomId: null,
        state: config.nativeLang.states[key] ?? 'physical',
      })
    }
  }

  // 教室自動分配（取消的場次不占教室）
  const taken = new Map<string, Set<string>>()
  for (const s of sessions) {
    if (s.state === 'cancelled') continue
    const room = nativeRooms.find(r =>
      (r.langs.length === 0 || r.langs.includes(s.lang)) && !(taken.get(s.slot)?.has(r.id)))
    if (room) {
      s.roomId = room.id
      ;(taken.get(s.slot) ?? taken.set(s.slot, new Set()).get(s.slot)!).add(room.id)
    } else {
      issues.push({ level: 'warn', text: `本土語言教室不足：${s.slot} 的「${s.course}」分不到教室（檢查教室數與可排語別）。`, tab: 'room' })
    }
  }

  return { sessions, issues }
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
