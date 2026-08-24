// 設備報修：共用常數、型別與計算（前後端共用，不可 import server-only 模組）

/** 案件狀態機（單向推進；老師按「已解決」直接跳 closed 輕量結案） */
export const REPAIR_STATUSES = [
  { key: 'pending',    label: '待處理' },
  { key: 'accepted',   label: '已接案' },
  { key: 'dispatched', label: '已出勤排查' },
  { key: 'vendor',     label: '已報廠商協助' },
  { key: 'closed',     label: '已結案' },
] as const

export type RepairStatus = (typeof REPAIR_STATUSES)[number]['key']

export function repairStatusLabel(key: string): string {
  return REPAIR_STATUSES.find(s => s.key === key)?.label ?? key
}

/** 結案方式（statistics 用來區分自行解決／問題消失／管理端修復） */
export const RESOLVED_KINDS = [
  { key: 'self',     label: '自行排除' },
  { key: 'vanished', label: '問題自行消失' },
  { key: 'fixed',    label: '已修復' },
] as const

export type ResolvedKind = (typeof RESOLVED_KINDS)[number]['key']

export function resolvedKindLabel(key: string | null): string {
  if (!key) return ''
  return RESOLVED_KINDS.find(k => k.key === key)?.label ?? key
}

/** 自助排解內容（掛在標準問題上；設備項目層有 fallback 一份） */
export interface RepairGuide {
  /** 教學影片網址（YouTube 等，空字串＝無） */
  videoUrl: string
  /** 教學步驟（多行純文字） */
  stepsMd: string
  /** 示意圖 storage path */
  photos: string[]
}

export const EMPTY_GUIDE: RepairGuide = { videoUrl: '', stepsMd: '', photos: [] }

export function parseGuide(raw: unknown): RepairGuide {
  const g = (raw ?? {}) as Partial<RepairGuide>
  return {
    videoUrl: typeof g.videoUrl === 'string' ? g.videoUrl : '',
    stepsMd: typeof g.stepsMd === 'string' ? g.stepsMd : '',
    photos: Array.isArray(g.photos) ? g.photos.filter((p): p is string => typeof p === 'string') : [],
  }
}

export function guideIsEmpty(g: RepairGuide): boolean {
  return !g.videoUrl && !g.stepsMd.trim() && g.photos.length === 0
}

export interface RepairConfig {
  /** 未結案超過此小時數 → 黃色警告 */
  slaWarnHours: number
  /** 未結案超過此小時數 → 紅色警告 */
  slaAlertHours: number
}

export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  slaWarnHours: 24,
  slaAlertHours: 72,
}

export function parseRepairConfig(raw: unknown): RepairConfig {
  const c = (raw ?? {}) as Partial<RepairConfig>
  return {
    slaWarnHours: typeof c.slaWarnHours === 'number' ? c.slaWarnHours : DEFAULT_REPAIR_CONFIG.slaWarnHours,
    slaAlertHours: typeof c.slaAlertHours === 'number' ? c.slaAlertHours : DEFAULT_REPAIR_CONFIG.slaAlertHours,
  }
}

/** 距報修經過時間的顯示文字（如「3 小時 20 分」「2 天 5 小時」） */
export function elapsedText(fromIso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(fromIso).getTime()
  if (ms < 0) return '剛剛'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '剛剛'
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時 ${minutes % 60} 分`
  const days = Math.floor(hours / 24)
  return `${days} 天 ${hours % 24} 小時`
}

/** SLA 燈號：未結案依經過小時數回 'ok' | 'warn' | 'alert'；已結案一律 'ok' */
export function slaLevel(
  createdIso: string,
  status: string,
  config: RepairConfig,
  now: Date = new Date(),
): 'ok' | 'warn' | 'alert' {
  if (status === 'closed') return 'ok'
  const hours = (now.getTime() - new Date(createdIso).getTime()) / 3600000
  if (hours >= config.slaAlertHours) return 'alert'
  if (hours >= config.slaWarnHours) return 'warn'
  return 'ok'
}

/** 報修人員身分 */
export const CONTACT_ROLES = [
  { key: 'teacher', label: '老師' },
  { key: 'student', label: '學生' },
] as const

export function contactRoleLabel(key: string): string {
  return CONTACT_ROLES.find(r => r.key === key)?.label ?? key
}

// 註：問題聚合不做前端即時建議／同義詞比對（使用者決策 2026-08-24）——
// 老師沒對到標準問題就自由填寫，統一由管理端案件報表「歸類」到標準問題。
