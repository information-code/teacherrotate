import { getAdminClient } from '@/lib/supabase/admin'
import WhitelistClient from './WhitelistClient'

export const dynamic = 'force-dynamic'

export default async function WhitelistPage() {
  const admin = getAdminClient()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, name, email, created_at')
    .eq('role', 'teacher')
    .order('name')

  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const authEmailSet = new Set(users.map(u => u.email))

  const entries = (profiles ?? []).map(p => ({
    ...p,
    logged_in: authEmailSet.has(p.email),
  }))

  return <WhitelistClient entries={entries} />
}
