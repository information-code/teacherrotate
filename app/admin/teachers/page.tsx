import { getAdminClient } from '@/lib/supabase/admin'
import TeachersClient from './TeachersClient'

export default async function TeachersPage() {
  const admin = getAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('*')
    .eq('role', 'teacher')
    .order('name')
  return <TeachersClient profiles={data ?? []} />
}
