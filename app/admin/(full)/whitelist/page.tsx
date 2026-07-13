import { guardPage } from '@/lib/staff-server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import WhitelistClient from './WhitelistClient'

export const dynamic = 'force-dynamic'

export default async function WhitelistPage() {
  await guardPage(['whitelist'])
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = getAdminClient()

  let isSuperAdmin = false
  if (user) {
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    isSuperAdmin = me?.role === 'superadmin'
  }

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, name, email, role, employment_type, created_at')
    .in('role', ['teacher', 'admin'])
    .order('name')

  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  // 以 id 判斷是否登入過：已註冊者 profile.id＝auth.users.id。
  // 不能用 email 比對——管理者改過資料信箱（如統一為學校網域）後會與實際登入信箱不同，造成誤判「沒登入過」。
  const authIdSet = new Set(users.map(u => u.id))

  const entries = (profiles ?? []).map(p => ({
    ...p,
    logged_in: authIdSet.has(p.id),
  }))

  return <WhitelistClient entries={entries} isSuperAdmin={isSuperAdmin} />
}
