import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import AdminsClient from './AdminsClient'

export const dynamic = 'force-dynamic'

export default async function AdminsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = getAdminClient()

  // 取得目前登入者的 role，判斷是否為 superadmin
  let isSuperAdmin = false
  if (user) {
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    isSuperAdmin = me?.role === 'superadmin'
  }

  const { data } = await admin.from('profiles').select('id, name, email').eq('role', 'admin').order('name')
  return <AdminsClient initialAdmins={data ?? []} isSuperAdmin={isSuperAdmin} />
}
