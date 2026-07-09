import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar } from '@/components/layout/AdminSidebar'
import { getSiteTitle } from '@/lib/site'
import { TopBar } from '@/components/layout/TopBar'
import { MobileNavProvider } from '@/components/layout/MobileNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('name, email, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/teacher')

  // 系統管理員全功能；行政人員（權限名冊啟用者）僅校務公告，其餘由 (full) layout 二次把關
  const isFullAdmin = profile.role === 'admin' || profile.role === 'superadmin'
  let staffOnly = false
  if (!isFullAdmin) {
    const { data: roster } = await admin
      .from('staff_roster').select('duty')
      .eq('teacher_id', user.id).eq('enabled', true)
      .limit(1).maybeSingle()
    if (!roster) redirect('/teacher')
    staffOnly = true
  }

  const siteTitle = await getSiteTitle()

  return (
    <MobileNavProvider>
      <div className="flex h-screen bg-zinc-50 overflow-hidden">
        <AdminSidebar siteTitle={siteTitle} staffOnly={staffOnly} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar
            userName={profile.name ?? profile.email ?? user.email ?? ''}
            role="admin"
            isAdmin={true}
          />
          <main className="relative flex-1 overflow-y-auto p-3 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </MobileNavProvider>
  )
}
