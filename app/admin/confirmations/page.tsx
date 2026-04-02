import { getAdminClient } from '@/lib/supabase/admin'
import ConfirmationsClient from './ConfirmationsClient'

export const dynamic = 'force-dynamic'

export default async function ConfirmationsPage() {
  const admin = getAdminClient()
  const { data: teachers } = await admin
    .from('profiles')
    .select('id, name, email, score_confirmed, score_confirmed_at')
    .not('role', 'eq', 'superadmin')
    .neq('status', 'inactive')
    .order('name')

  return <ConfirmationsClient initialTeachers={teachers ?? []} />
}
