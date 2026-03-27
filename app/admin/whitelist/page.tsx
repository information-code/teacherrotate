import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import WhitelistClient from './WhitelistClient'

export const dynamic = 'force-dynamic'

export default async function WhitelistPage() {
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
    .select('id, name, email, role, created_at')
    .in('role', ['teacher', 'admin'])
    .order('name')

  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const authEmailSet = new Set(users.map(u => u.email))

  const entries = (profiles ?? []).map(p => ({
    ...p,
    logged_in: authEmailSet.has(p.email),
  }))

  return <WhitelistClient entries={entries} isSuperAdmin={isSuperAdmin} />
}
