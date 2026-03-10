export type AppRole = 'teacher' | 'admin' | 'superadmin'

/** admin 或 superadmin 皆可進入管理後台 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'superadmin'
}
