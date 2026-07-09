import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar } from '@/components/layout/AdminSidebar'
import { getSiteTitle } from '@/lib/site'
import { TopBar } from '@/components/layout/TopBar'
import { MobileNavProvider } from '@/components/layout/MobileNav'
import { getAdminAccess } from '@/lib/staff-server'

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

  // superadmin 全功能；其他人依權限矩陣（staff_roster.perms），無任何權限者回教師端。
  // 各頁另有 guardPage 依單頁權限二次把關。
  const access = await getAdminAccess(user.id)
  if (!access) redirect('/teacher')

  const siteTitle = await getSiteTitle()

  return (
    <MobileNavProvider>
      <div className="flex h-screen bg-zinc-50 overflow-hidden">
        <AdminSidebar
          siteTitle={siteTitle}
          perms={Array.from(access.perms)}
          isSuper={access.role === 'superadmin'}
        />
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
