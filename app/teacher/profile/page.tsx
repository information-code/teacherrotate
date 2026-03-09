import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { ProfileForm } from '@/components/teacher/ProfileForm'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  let { data: profile } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // 若 profile 不存在（trigger 尚未執行），用 insert 建立（不覆蓋已有 role）
  if (!profile) {
    await admin.from('profiles').insert({
      id: user.id,
      email: user.email ?? '',
      name: (user.user_metadata?.full_name as string) ?? user.email?.split('@')[0] ?? '',
      role: 'teacher',
    })
    const { data: created } = await admin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    profile = created
  }

  if (!profile) {
    return (
      <div className="card max-w-md text-sm text-zinc-600">
        <p>無法載入個人資料，請重新整理頁面或聯絡系統管理員。</p>
      </div>
    )
  }

  return <ProfileForm profile={profile} />
}
