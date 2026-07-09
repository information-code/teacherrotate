import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isDirector } from '@/lib/staff'

/** 呼叫者的校務公告權限：系統管理員全權；行政人員以 staff_roster 為準 */
export interface PublisherAccess {
  userId: string
  role: 'superadmin' | 'admin' | 'staff'
  duty: string | null    // 行政人員的職務（staff 才有）
  office: string | null  // 行政人員所屬處室
  isDirector: boolean    // 主任可編該處室全部；組長僅能編自己發布的
}

/**
 * 取得呼叫者的公告／行事曆權限。無權限回傳 null。
 * 最終權限以 staff_roster 為準（開始學年度時帶入、平時可改人）。
 * 系統管理員若兼任行政職務（名冊中有他，開關與否不拘），權限仍是
 * 管理員全權，但 duty/office 帶職務——發布標籤依職務、不用管理者標籤。
 */
export async function getPublisherAccess(userId: string): Promise<PublisherAccess | null> {
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userId).single()
  if (profile?.role === 'superadmin' || profile?.role === 'admin') {
    const { data: duty } = await supabaseAdmin
      .from('staff_roster').select('duty, office')
      .eq('teacher_id', userId)
      .limit(1).maybeSingle()
    return {
      userId,
      role: profile.role,
      duty: duty?.duty ?? null,
      office: duty?.office ?? null,
      isDirector: false,
    }
  }

  const { data: roster } = await supabaseAdmin
    .from('staff_roster').select('duty, office')
    .eq('teacher_id', userId).eq('enabled', true)
    .limit(1).maybeSingle()
  if (!roster) return null
  return {
    userId,
    role: 'staff',
    duty: roster.duty,
    office: roster.office,
    isDirector: isDirector(roster.duty),
  }
}

/** API route 用：驗證登入並取得公告權限，失敗回傳可直接 return 的 response */
export async function requirePublisher():
  Promise<{ access: PublisherAccess } | { error: NextResponse }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await getPublisherAccess(user.id)
  if (!access) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { access }
}

/** 行政人員對某筆內容（公告／活動）是否有編輯權 */
export function canEditContent(
  access: PublisherAccess,
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
