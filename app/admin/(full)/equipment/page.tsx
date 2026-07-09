import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeEquipmentConfig } from '@/lib/equipment'
import EquipmentManageClient from './EquipmentManageClient'

export const dynamic = 'force-dynamic'

export default async function EquipmentManagePage() {
  await guardPage(['equipment'])
  const admin = getAdminClient()
  const [{ data: equipment }, { data: groups }, { data: profiles }, { data: configRow }] = await Promise.all([
    admin.from('equipment').select('id, name, status, asset_number, group_id').order('name').order('asset_number'),
    admin.from('equipment_groups').select('id, name, status').order('name'),
    // 借用人選單排除離校教師
    admin.from('profiles').select('id, name, email').neq('status', 'inactive').order('name'),
    admin.from('equipment_config').select('config').eq('id', 1).maybeSingle(),
  ])
  const config = normalizeEquipmentConfig(configRow?.config)
  const memberCount = new Map<string, number>()
  for (const e of equipment ?? []) {
    if (e.group_id) memberCount.set(e.group_id, (memberCount.get(e.group_id) ?? 0) + 1)
  }
  return (
    <EquipmentManageClient
      equipment={equipment ?? []}
      groups={(groups ?? []).map(g => ({ ...g, member_count: memberCount.get(g.id) ?? 0 }))}
      teachers={(profiles ?? []).map(p => ({ id: p.id, name: p.name ?? p.email }))}
      overdueTemplate={config.overdueMessageTemplate}
      renewalWeeks={config.renewalWeeks}
    />
  )
}
