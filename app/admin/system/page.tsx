import { getAdminClient } from '@/lib/supabase/admin'
import SystemClient from './SystemClient'

export const dynamic = 'force-dynamic'

export default async function SystemPage() {
  const admin = getAdminClient()
  const { data } = await admin
    .from('settings').select('value').eq('key', 'school_name').maybeSingle()
  return <SystemClient initialSchoolName={data?.value ?? ''} />
}
