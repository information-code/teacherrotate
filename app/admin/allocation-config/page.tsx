import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeConfig } from '@/lib/allocation'
import AllocationConfigClient from './AllocationConfigClient'

export const dynamic = 'force-dynamic'

export default async function AllocationConfigPage() {
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const { data: row } = await admin
    .from('allocation_config').select('config').eq('year', year).maybeSingle()
  const config = normalizeConfig(row?.config)

  return <AllocationConfigClient year={year} initialConfig={config} />
}
