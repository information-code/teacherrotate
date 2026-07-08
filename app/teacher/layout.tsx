import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { TeacherSidebar } from '@/components/layout/TeacherSidebar'
import { getSiteTitle } from '@/lib/site'
import { TopBar } from '@/components/layout/TopBar'
import { MobileNavProvider } from '@/components/layout/MobileNav'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()

  // 用 admin client 讀 profile，繞過 RLS 確保能取得資料
  let { data: profile } = await admin
    .from('profiles')
    .select('name, email, role, employment_type')
    .eq('id', user.id)
    .single()

  // id 找不到 → 用 email 備援連結（老師先登入、管理者後建 profile 的舊 session 也能自動接上）
  if (!profile && user.email) {
    const { data: byEmail } = await admin
      .from('profiles')
      .select('name, email, role, employment_type')
      .eq('email', user.email)
      .maybeSingle()
    if (byEmail) {
      await admin.from('profiles').update({ id: user.id }).eq('email', user.email)
      profile = byEmail
    }
  }

  // profile 不存在 → email 不在白名單，拒絕進入
  if (!profile) redirect('/unauthorized')

  const siteTitle = await getSiteTitle()

  return (
    <MobileNavProvider>
      <div className="flex h-screen bg-zinc-50 overflow-hidden">
        <TeacherSidebar employmentType={profile.employment_type} siteTitle={siteTitle} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar
            userName={profile?.name ?? profile?.email ?? user.email ?? ''}
            role="teacher"
            isAdmin={profile?.role === 'admin' || profile?.role === 'superadmin'}
          />
          <main className="relative flex-1 overflow-y-auto p-3 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </MobileNavProvider>
  )
}
