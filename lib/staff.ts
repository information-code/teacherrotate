// 行政職務 → 處室對照（前後端共用）
// 職務名稱與 scoremap.work 一致；scoremap 若新增行政職務，這裡要跟著補。

export const OFFICE_ORDER = ['教務處', '學務處', '總務處', '輔導室'] as const

export const DUTY_OFFICE_MAP: Record<string, string> = {
  教務主任: '教務處',
  註冊組長: '教務處',
  課務組長: '教務處',
  課發組長: '教務處',
  資訊組長: '教務處',
  學務主任: '學務處',
  生教組長: '學務處',
  健體組長: '學務處',
  活動組長: '學務處',
  環衛組長: '學務處',
  總務主任: '總務處',
  文書組長: '總務處',
  輔導主任: '輔導室',
  輔導組長: '輔導室',
  親職組長: '輔導室',
  特教組長: '輔導室',
}

export const ADMIN_DUTIES = Object.keys(DUTY_OFFICE_MAP)

/** 主任可編輯該處室所有內容；組長只能編輯自己發布的 */
export function isDirector(duty: string): boolean {
  return duty.endsWith('主任')
}

/** superadmin 發布時的職稱標籤與歸屬處室（名冊無兼任職務時的預設） */
export const SUPERADMIN_TITLE = '最高管理者'
export const SUPERADMIN_OFFICE = '教務處'

/**
 * 權限矩陣的欄位＝管理頁面。key 與 /admin/<key> 路徑一致
 * （holidays 例外：行事曆頁內的假日維護細項）。
 * 系統偏好（含權限管理）不在矩陣內，固定僅最高管理者。
 */
export const PERM_GROUPS: { group: string; perms: { key: string; label: string }[] }[] = [
  {
    group: '校務公告',
    perms: [
      { key: 'announcements', label: '公告管理' },
      { key: 'calendar',      label: '行事曆管理' },
      { key: 'holidays',      label: '假日維護' },
    ],
  },
  {
    group: '教師管理',
    perms: [
      { key: 'whitelist', label: '帳號資料' },
      { key: 'teachers',  label: '教師資料' },
      { key: 'rotations', label: '工作紀錄' },
    ],
  },
  {
    group: '選填管理',
    perms: [
      { key: 'confirmations',   label: '確認統計' },
      { key: 'statistics',      label: '志願統計' },
      { key: 'selection-panel', label: '選填面板' },
      { key: 'scoremap',        label: '分數對照表' },
    ],
  },
  {
    group: '配課管理',
    perms: [
      { key: 'allocation-config',     label: '配課設定' },
      { key: 'allocation-statistics', label: '配課統計' },
    ],
  },
  {
    group: '排課管理',
    perms: [
      { key: 'schedule-config', label: '排課設定' },
      { key: 'schedule-wizard', label: '排課精靈' },
    ],
  },
  {
    group: '設備管理',
    perms: [
      { key: 'equipment-config', label: '設備設定' },
      { key: 'equipment',        label: '借用管理' },
    ],
  },
]

export const ALL_PERM_KEYS = PERM_GROUPS.flatMap(g => g.perms.map(p => p.key))

export interface StaffRosterRow {
  duty: string
  office: string
  teacher_id: string | null
  perms: string[]
  teacher_name?: string | null
}
