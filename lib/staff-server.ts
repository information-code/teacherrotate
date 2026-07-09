import 'server-only'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ALL_PERM_KEYS, isDirector } from '@/lib/staff'

/**
 * 呼叫者的管理權限。兩層：
 *  - superadmin（跟人走）：全部頁面權限
 *  - 行政職務（staff_roster 名冊）：perms 矩陣勾選的頁面
 * 兼任職務的 superadmin 也帶 duty/office（發布標籤依職務）。
 */
export interface AdminAccess {
  userId: string
  role: 'superadmin' | 'staff'
  perms: Set<string>
  duty: string | null
  office: string | null
  isDirector: boolean
}

export async function getAdminAccess(userId: string): Promise<AdminAccess | null> {
  const [{ data: profile }, { data: roster }] = await Promise.all([
    supabaseAdmin.from('profiles').select('role').eq('id', userId).single(),
    supabaseAdmin.from('staff_roster').select('duty, office, perms')
      .eq('teacher_id', userId).limit(1).maybeSingle(),
  ])

  const duty = roster?.duty ?? null
  const office = roster?.office ?? null

  if (profile?.role === 'superadmin') {
    return {
      userId, role: 'superadmin', perms: new Set(ALL_PERM_KEYS),
      duty, office, isDirector: false,
    }
  }
  const perms = Array.isArray(roster?.perms) ? (roster!.perms as string[]) : []
  if (perms.length === 0) return null
  return {
    userId, role: 'staff', perms: new Set(perms),
    duty, office, isDirector: duty ? isDirector(duty) : false,
  }
}

/** 是否具備任一權限。perms 傳空陣列＝僅 superadmin 可過 */
export async function hasPerms(userId: string, perms: string[]): Promise<boolean> {
  const access = await getAdminAccess(userId)
  if (!access) return false
  if (access.role === 'superadmin') return true
  return perms.some(p => access.perms.has(p))
}

/**
 * API route 用：驗證登入並要求任一權限。
 * perms 空陣列＝僅 superadmin。
 */
export async function requirePerms(perms: string[]):
  Promise<{ access: AdminAccess } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await getAdminAccess(user.id)
  if (!access || (access.role !== 'superadmin' && !perms.some(p => access.perms.has(p)))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { access }
}

/**
 * 管理頁面（server component）用的守門：未登入導回登入頁、
 * 無任一權限導回教師端。perms 空陣列＝僅 superadmin。
 */
export async function guardPage(perms: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await hasPerms(user.id, perms))) redirect('/teacher')
}

/** 行政人員對某筆內容（公告／活動）是否有編輯權 */
export function canEditContent(
  access: AdminAccess,
  row: { created_by: string | null; office: string },
): boolean {
  if (access.role !== 'staff') return true
  if (access.isDirector) return row.office === access.office || row.created_by === access.userId
  return row.created_by === access.userId
}

/** 目前進行中的學年度；未設定回傳 null */
export async function getCurrentSchoolYear(): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from('settings').select('value').eq('key', 'current_school_year').maybeSingle()
  const y = Number(data?.value)
  return Number.isInteger(y) && y > 0 ? y : null
}
