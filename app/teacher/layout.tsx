import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { TeacherSidebar } from '@/components/layout/TeacherSidebar'
import { TopBar } from '@/components/layout/TopBar'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()

  // 用 admin client 讀 profile，繞過 RLS 確保能取得資料
  let { data: profile } = await admin
    .from('profiles')
    .select('name, email, role')
    .eq('id', user.id)
    .single()

  // 若 profile 不存在（trigger 可能尚未執行），用 insert 建立（不覆蓋已有資料）
  if (!profile) {
    await admin
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email ?? '',
        name: (user.user_metadata?.full_name as string) ?? user.email?.split('@')[0] ?? '',
        role: 'teacher',
      })
      .select('name, email, role')
      .single()
    const { data: created } = await admin
      .from('profiles')
      .select('name, email, role')
      .eq('id', user.id)
      .single()
    profile = created
  }

  return (
    <div className="flex h-screen bg-zinc-50 overflow-hidden">
      <TeacherSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          userName={profile?.name ?? profile?.email ?? user.email ?? ''}
          role="teacher"
          isAdmin={profile?.role === 'admin' || profile?.role === 'superadmin'}
        />
        <main className="relative flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
