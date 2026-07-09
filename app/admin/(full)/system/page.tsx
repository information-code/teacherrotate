import { guardPage } from '@/lib/staff-server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import SystemClient from './SystemClient'

export const dynamic = 'force-dynamic'

export default async function SystemPage() {
  await guardPage([])
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = getAdminClient()
  let isSuperAdmin = false
  if (user) {
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single()
    isSuperAdmin = me?.role === 'superadmin'
  }

  const { data } = await admin
    .from('settings').select('value').eq('key', 'school_name').maybeSingle()
  return <SystemClient initialSchoolName={data?.value ?? ''} isSuperAdmin={isSuperAdmin} />
}
