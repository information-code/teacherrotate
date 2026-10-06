import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeEquipmentConfig } from '@/lib/equipment'
import LendingOverviewClient from '@/components/admin/equipment/LendingOverviewClient'

export const dynamic = 'force-dynamic'

export default async function EquipmentOverviewPage() {
  await guardPage(['equipment'])
  const { data: configRow } = await getAdminClient()
    .from('equipment_config').select('config').eq('id', 1).maybeSingle()
  const config = normalizeEquipmentConfig(configRow?.config)
  return (
    <LendingOverviewClient
      overdueTemplate={config.overdueMessageTemplate}
      pickupTemplate={config.pickupMessageTemplate}
    />
  )
}
