// 超鐘簽到（減課鐘點費）共用邏輯：型別、可授課日計算、簽到列展開。
// 「不上課日」＝ holidays（is_holiday）∪ overtime_skip_dates；一般週休二日以星期判斷。

export const OT_WEEKDAYS = [1, 2, 3, 4, 5] as const
export const OT_DAY_ZH = ['', '一', '二', '三', '四', '五', '六', '日']
export const OT_PERIOD_ZH = ['', '第一節', '第二節', '第三節', '第四節', '第五節', '第六節', '第七節']

/** 身分＝帳號資料的聘任別（與 whitelist 一致）；手動輸入的清冊列固定為 hourly */
export const OT_CATEGORIES = [
  { value: 'formal', label: '正式' },
  { value: 'substitute', label: '代理' },
  { value: 'hourly', label: '鐘點' },
  { value: 'foreign', label: '外師' },
] as const
export type OtCategory = (typeof OT_CATEGORIES)[number]['value']
export const otCategoryLabel = (v: string) =>
  OT_CATEGORIES.find(c => c.value === v)?.label ?? v

/** 正式／代理教師每人（跨計畫合計）每週減課上限；鐘點／外師無上限 */
export const OT_WEEKLY_CAP = 6
export const isCappedCategory = (v: string) => v === 'formal' || v === 'substitute'

export interface OtPlan {
  id: string
  name: string
  start_date: string   // YYYY-MM-DD
  end_date: string
  rate: number         // 節薪
  budget: number       // 總經費（0＝未設定）
}

/** 超鐘點區間（含首尾）；空陣列＝整個計畫期程 */
export interface OtRange { start: string; end: string }

export interface OtTeacher {
  id: string
  plan_id: string
  teacher_id: string | null
  name: string
  category: string     // formal | substitute | hourly | foreign
  labor_fee: number
  health_fee: number
  lunch_fee: number
  other_fee: number
  note: string
  ranges: OtRange[]
}

/** 解析 DB 的 ranges JSONB（壞資料丟棄），依開始日排序 */
export function normalizeRanges(v: unknown): OtRange[] {
  if (!Array.isArray(v)) return []
  const out: OtRange[] = []
  for (const r of v.slice(0, 24)) {
    const start = String((r as { start?: unknown })?.start ?? '')
    const end = String((r as { end?: unknown })?.end ?? '')
    if (isDateStr(start) && isDateStr(end) && start <= end) out.push({ start, end })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

/** 日期是否落在任一區間內（無區間＝不限制） */
export function inRanges(date: string, ranges: OtRange[]): boolean {
  if (ranges.length === 0) return true
  return ranges.some(r => date >= r.start && date <= r.end)
}

export interface OtSlot {
  id: string
  teacher_row_id: string
  weekday: number      // 1-5
  period: number       // 1-7
  class_name: string
  domain: string
}

export interface OtSkipDate {
  id: string
  date: string
  name: string
}

export interface OtHoliday {
  date: string
  name: string
  is_holiday: boolean
}

// ───────────── 日期工具（純字串運算，避免時區偏移）─────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDateStr = (s: string) => DATE_RE.test(s)

function toUTC(d: string): number {
  const [y, m, day] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, day)
}
function fromUTC(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}
/** 星期（1=一 … 7=日） */
export function weekdayOf(date: string): number {
  const w = new Date(toUTC(date)).getUTCDay()
  return w === 0 ? 7 : w
}
export const DAY_MS = 86400000

/** 不上課日集合：國定假日（is_holiday）＋特殊不上課日 */
export function buildSkipSet(holidays: OtHoliday[], skips: OtSkipDate[]): Set<string> {
  const set = new Set<string>()
  for (const h of holidays) if (h.is_holiday) set.add(h.date)
  for (const s of skips) set.add(s.date)
  return set
}

/** [start, end] 內指定星期的可授課日（排除不上課日） */
export function teachingDates(start: string, end: string, weekday: number, skip: Set<string>): string[] {
  if (!isDateStr(start) || !isDateStr(end)) return []
  const out: string[] = []
  for (let t = toUTC(start); t <= toUTC(end); t += DAY_MS) {
    const d = fromUTC(t)
    if (weekdayOf(d) !== weekday) continue
    if (skip.has(d)) continue
    out.push(d)
  }
  return out
}

/** [start, end] 內各星期（一~五）可授課日數 */
export function weekdayCounts(start: string, end: string, skip: Set<string>): number[] {
  const counts = [0, 0, 0, 0, 0]
  if (!isDateStr(start) || !isDateStr(end)) return counts
  for (let t = toUTC(start); t <= toUTC(end); t += DAY_MS) {
    const d = fromUTC(t)
    const w = weekdayOf(d)
    if (w > 5 || skip.has(d)) continue
    counts[w - 1]++
  }
  return counts
}

/** 兩段區間的交集；無交集回傳 null */
export function intersectRange(
  aStart: string, aEnd: string, bStart: string, bEnd: string,
): [string, string] | null {
  const s = toUTC(aStart) >= toUTC(bStart) ? aStart : bStart
  const e = toUTC(aEnd) <= toUTC(bEnd) ? aEnd : bEnd
  return toUTC(s) <= toUTC(e) ? [s, e] : null
}

/** 月份（YYYY-MM）→ [首日, 末日] */
export function monthRange(month: string): [string, string] | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

export interface OtSessionRow {
  date: string       // YYYY-MM-DD
  weekday: number
  period: number
  class_name: string
  domain: string
}

/**
 * 展開某位教師在區間內的簽到列（每時段 × 每個符合星期的可授課日），
 * 依日期、節次排序。區間會先與計畫期程取交集；
 * ranges＝該師的超鐘點區間（多段，空＝整個期程），區間外的日子不算。
 */
export function expandSessions(
  slots: OtSlot[], plan: OtPlan, rangeStart: string, rangeEnd: string, skip: Set<string>,
  ranges: OtRange[] = [],
): OtSessionRow[] {
  const range = intersectRange(plan.start_date, plan.end_date, rangeStart, rangeEnd)
  if (!range) return []
  const rows: OtSessionRow[] = []
  for (const s of slots) {
    for (const d of teachingDates(range[0], range[1], s.weekday, skip)) {
      if (!inRanges(d, ranges)) continue
      rows.push({ date: d, weekday: s.weekday, period: s.period, class_name: s.class_name, domain: s.domain })
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period)
  return rows
}

/** 民國年（依日期） */
export const rocYear = (date: string) => Number(date.slice(0, 4)) - 1911

export const money = (n: number) => n.toLocaleString('zh-Hant-TW')
