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

/** superadmin 發布時的職稱標籤與歸屬處室 */
export const SUPERADMIN_TITLE = '最高管理者'
export const SUPERADMIN_OFFICE = '教務處'
export const ADMIN_TITLE = '管理員'

export interface StaffRosterRow {
  duty: string
  office: string
  teacher_id: string | null
  enabled: boolean
  teacher_name?: string | null
}
