import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeEquipmentConfig } from '@/lib/equipment'
import EquipmentConfigClient from './EquipmentConfigClient'

export const dynamic = 'force-dynamic'

export default async function EquipmentConfigPage() {
  const admin = getAdminClient()
  const [{ data: equipment }, { data: configRow }] = await Promise.all([
    admin.from('equipment').select('*').order('sort_order').order('created_at'),
    admin.from('equipment_config').select('config').eq('id', 1).maybeSingle(),
  ])
  return (
    <EquipmentConfigClient
      initialEquipment={(equipment ?? []) as never}
      initialConfig={normalizeEquipmentConfig(configRow?.config)}
    />
  )
}
