import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

// (full) 群組：僅系統管理員（admin/superadmin）可用的管理頁。
// 行政人員（staff_roster）只被外層 layout 放行到公告與行事曆，闖進來一律轉走。
export default async function FullAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'superadmin') {
    redirect('/admin/announcements')
  }

  return <>{children}</>
}
