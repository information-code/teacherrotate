import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar } from '@/components/layout/AdminSidebar'
import { TopBar } from '@/components/layout/TopBar'

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
  if (profile.role !== 'admin') redirect('/teacher')

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      <AdminSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          userName={profile.name ?? profile.email ?? user.email ?? ''}
          role="admin"
          isAdmin={true}
        />
        <main className="relative flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
