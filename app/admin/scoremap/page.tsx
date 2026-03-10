import { getAdminClient } from '@/lib/supabase/admin'
import ScoremapClient from './ScoremapClient'

export const dynamic = 'force-dynamic'

export default async function ScoremapPage() {
  const admin = getAdminClient()
  const { data } = await admin.from('scoremap').select('*').order('sort_order')
  return <ScoremapClient initialRows={data ?? []} />
}
