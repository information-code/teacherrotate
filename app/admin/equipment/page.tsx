import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeEquipmentConfig } from '@/lib/equipment'
import EquipmentManageClient from './EquipmentManageClient'

export const dynamic = 'force-dynamic'

export default async function EquipmentManagePage() {
  const admin = getAdminClient()
  const [{ data: equipment }, { data: profiles }, { data: configRow }] = await Promise.all([
    admin.from('equipment').select('id, name, status, asset_number').order('name').order('asset_number'),
    admin.from('profiles').select('id, name, email').order('name'),
    admin.from('equipment_config').select('config').eq('id', 1).maybeSingle(),
  ])
  const config = normalizeEquipmentConfig(configRow?.config)
  return (
    <EquipmentManageClient
      equipment={equipment ?? []}
      teachers={(profiles ?? []).map(p => ({ id: p.id, name: p.name ?? p.email }))}
      overdueTemplate={config.overdueMessageTemplate}
      renewalWeeks={config.renewalWeeks}
    />
  )
}
