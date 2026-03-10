import { getAdminClient } from '@/lib/supabase/admin'
import AdminsClient from './AdminsClient'

export const dynamic = 'force-dynamic'

export default async function AdminsPage() {
  const admin = getAdminClient()
  const { data } = await admin.from('profiles').select('id, name, email').eq('role', 'admin').order('name')
  return <AdminsClient initialAdmins={data ?? []} />
}
