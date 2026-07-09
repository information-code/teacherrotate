// 工作首頁（行事曆／公告／代辦）共用型別與日期工具（前後端皆可用）

export interface SchoolEvent {
  id: string
  title: string
  description: string
  start_date: string
  end_date: string
}

export interface Holiday {
  date: string
  name: string
  is_holiday: boolean
  source: string
}

export interface PersonalEvent {
  id: string
  date: string
  title: string
  note: string
}

export interface Announcement {
  id: string
  title: string
  content: string
  office: string
  pinned: boolean
  requires_action: boolean
  link_url: string
  publish_at: string
  expire_at: string | null
  read?: boolean       // 教師端：本人是否已讀
  read_count?: number  // 管理端：已讀人數
}

export interface Todo {
  id: string
  title: string
  note: string
  due_date: string | null
  status: string
  source: string
  announcement_id: string | null
  completed_at: string | null
}

/** 處室標籤選項（公告用） */
export const OFFICES = ['教務處', '學務處', '總務處', '輔導室', '人事室', '會計室', '校長室']

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 本地時區的 YYYY-MM-DD */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dashboardTodayStr(): string {
  return toDateStr(new Date())
}

/**
 * 月曆格線：以週日為每週第一天，回傳涵蓋整月的 42 格日期
 * month 為 1–12
 */
export function monthGridDates(year: number, month: number): string[] {
  const first = new Date(year, month - 1, 1)
  const gridStart = new Date(year, month - 1, 1 - first.getDay())
  const dates: string[] = []
  for (let i = 0; i < 42; i++) {
    dates.push(toDateStr(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)))
  }
  return dates
}

/** 日期是否落在（含首尾的）區間內 */
export function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end
}

/** 'M/D（週X）' 顯示用 */
export function fmtDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

/** 是否為週六日 */
export function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay()
  return day === 0 || day === 6
}
