import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminAccess } from '@/lib/staff-server'
import { ALL_PERM_KEYS } from '@/lib/staff'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const access = await getAdminAccess(user.id)
  if (!access) redirect('/teacher')

  // 導向第一個有權限的頁面（假日維護在行事曆頁內）
  const first = ALL_PERM_KEYS.find(key => access.perms.has(key)) ?? 'announcements'
  redirect(`/admin/${first === 'holidays' ? 'calendar' : first}`)
}
