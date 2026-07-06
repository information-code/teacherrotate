// 資訊設備借用：共用常數、型別與計算（前後端共用，不可 import server-only 模組）

/** 學校節次（固定清單，管理者在設定頁勾選開放哪些） */
export const EQUIPMENT_PERIODS = [
  { key: 'morning', label: '早自習' },
  { key: 'p1', label: '第1節' },
  { key: 'p2', label: '第2節' },
  { key: 'p3', label: '第3節' },
  { key: 'p4', label: '第4節' },
  { key: 'noon', label: '午休' },
  { key: 'p5', label: '第5節' },
  { key: 'p6', label: '第6節' },
  { key: 'p7', label: '第7節' },
  { key: 'p8', label: '第8節' },
  { key: 'after', label: '放學後' },
] as const

export type PeriodKey = (typeof EQUIPMENT_PERIODS)[number]['key']

export function periodLabel(key: string): string {
  return EQUIPMENT_PERIODS.find(p => p.key === key)?.label ?? key
}

/** 依節次固定順序排序後轉成顯示文字（如「第2節、第3節」） */
export function periodsText(keys: string[]): string {
  const order = EQUIPMENT_PERIODS.map(p => p.key as string)
  return [...keys]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map(periodLabel)
    .join('、')
}

/** 檢查項目（掛在設備上，借用/歸還各一份） */
export interface ChecklistItem {
  label: string
  requiresPhoto: boolean
}

/** 教師送出時的檢查結果快照（含照片 storage path） */
export interface ChecklistResult extends ChecklistItem {
  checked: boolean
  photos: string[]
}

export interface EquipmentConfig {
  /** 開放借用的節次 key */
  openPeriods: string[]
  /** 四份同意書內容（純文字，多行） */
  agreements: {
    borrow: string
    return: string
    longterm: string
    renewal: string
  }
  /** 逾期通知模板，支援 {老師} {設備} {日期} {時段} 變數 */
  overdueMessageTemplate: string
  /** 續借週期（週） */
  renewalWeeks: number
  /** 到期前幾天開始顯示續借回傳按鈕 */
  renewalNoticeDays: number
  /** 短期借用可預借未來天數 */
  maxAdvanceDays: number
  /** 每次上傳照片上限（張） */
  maxPhotos: number
}

export const DEFAULT_EQUIPMENT_CONFIG: EquipmentConfig = {
  openPeriods: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
  agreements: {
    borrow:
      '本人已確認借用設備及週邊配件狀態良好，借用期間妥善保管與使用，' +
      '如有遺失或損壞願負保管之責，並於借用時段結束後如期歸還原位。',
    return:
      '本人已將設備及週邊配件歸還原位，並確認設備狀態良好、配件齊全。',
    longterm:
      '本人同意長期借用本設備，借用期間妥善保管與使用，如有遺失或損壞願負保管之責，' +
      '並依規定於到期時回傳設備現況照片辦理續借或歸還。',
    renewal:
      '本人已回傳設備現況照片，確認設備及週邊配件狀態良好，並同意繼續長期借用本設備。',
  },
  overdueMessageTemplate:
    '{老師}老師您好，提醒您於{日期}{時段}借用的「{設備}」尚未完成歸還手續，' +
    '請儘速至系統辦理歸還並將設備歸回原位，謝謝您。',
  renewalWeeks: 20,
  renewalNoticeDays: 7,
  maxAdvanceDays: 14,
  maxPhotos: 5,
}

/** 合併儲存值與預設值（設定新增欄位時舊資料自動補齊） */
export function normalizeEquipmentConfig(raw: unknown): EquipmentConfig {
  const r = (raw ?? {}) as Partial<EquipmentConfig>
  return {
    ...DEFAULT_EQUIPMENT_CONFIG,
    ...r,
    agreements: { ...DEFAULT_EQUIPMENT_CONFIG.agreements, ...(r.agreements ?? {}) },
    openPeriods: Array.isArray(r.openPeriods) ? r.openPeriods : DEFAULT_EQUIPMENT_CONFIG.openPeriods,
  }
}

export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  available: '可借用',
  maintenance: '維修中',
  retired: '停用',
}

export const LOAN_STATUS_LABEL: Record<string, string> = {
  reserved: '已預約',
  borrowed: '借用中',
  returned: '已歸還',
  cancelled: '已取消',
  closed: '管理者結案',
}

/** 借用期間（跨日用）：loan_date～end_date、start_period～end_period */
export interface LoanRange {
  loan_date: string
  end_date?: string | null
  periods: string[]
  start_period?: string | null
  end_period?: string | null
}

/** 借用的實際到期日（跨日取結束日，舊單日資料取借用日） */
export function loanDueDate(l: { loan_date: string; end_date?: string | null }): string {
  return l.end_date ?? l.loan_date
}

/** 借用時間顯示文字：單日「日期｜節次」、跨日「起日 節次 ～ 迄日 節次」 */
export function loanTimeText(l: LoanRange): string {
  const end = loanDueDate(l)
  if (end === l.loan_date) return `${l.loan_date}｜${periodsText(l.periods)}`
  return `${l.loan_date} ${periodLabel(l.start_period ?? '')} ～ ${end} ${periodLabel(l.end_period ?? '')}`
}

/**
 * 跨日借用中，某一天占用的節次（開放節次依固定順序）：
 * 首日從開始時段到當日最後、末日從當日第一節到結束時段、中間日整天，同日取區間。
 */
export function daySlotPeriods(
  openPeriods: string[],
  date: string,
  startDate: string,
  endDate: string,
  startPeriod: string,
  endPeriod: string
): string[] {
  const order = EQUIPMENT_PERIODS.map(p => p.key as string)
  const open = order.filter(k => openPeriods.includes(k))
  const si = open.indexOf(startPeriod)
  const ei = open.indexOf(endPeriod)
  if (si < 0 || ei < 0) return []
  const isFirst = date === startDate
  const isLast = date === endDate
  if (isFirst && isLast) return si <= ei ? open.slice(si, ei + 1) : []
  if (isFirst) return open.slice(si)
  if (isLast) return open.slice(0, ei + 1)
  return open
}

/** startDate～endDate（含兩端）的日期清單 */
export function dateRangeList(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  let d = startDate
  while (d <= endDate && dates.length <= 62) {
    dates.push(d)
    d = addDays(d, 1)
  }
  return dates
}

/** 逾期判定基準：借用日當天結束（23:59）仍未歸還即逾期，以「天」計 */
export function overdueDays(loanDate: string, endAt: string | null, today: string): number {
  const end = (endAt ? endAt.slice(0, 10) : today)
  const diff = Math.floor((Date.parse(end) - Date.parse(loanDate)) / 86400000)
  return Math.max(0, diff)
}

/** 逾期通知模板變數替換 */
export function renderOverdueMessage(
  template: string,
  vars: { teacher: string; equipment: string; date: string; periods: string }
): string {
  return template
    .replaceAll('{老師}', vars.teacher)
    .replaceAll('{設備}', vars.equipment)
    .replaceAll('{日期}', vars.date)
    .replaceAll('{時段}', vars.periods)
}

/** 今天（本地時區）的 YYYY-MM-DD */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** date 加上 n 天 */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
