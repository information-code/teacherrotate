import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeEquipmentConfig } from '@/lib/equipment'
import EquipmentConfigClient from './EquipmentConfigClient'

export const dynamic = 'force-dynamic'

export default async function EquipmentConfigPage() {
  await guardPage(['equipment-config'])
  const admin = getAdminClient()
  const [{ data: equipment }, { data: groups }, { data: configRow }] = await Promise.all([
    admin.from('equipment').select('*').order('name').order('asset_number'),
    admin.from('equipment_groups').select('*').order('name'),
    admin.from('equipment_config').select('config').eq('id', 1).maybeSingle(),
  ])
  const membersByGroup = new Map<string, string[]>()
  for (const e of equipment ?? []) {
    if (!e.group_id) continue
    const list = membersByGroup.get(e.group_id) ?? []
    list.push(e.id)
    membersByGroup.set(e.group_id, list)
  }
  return (
    <EquipmentConfigClient
      initialEquipment={(equipment ?? []) as never}
      initialGroups={(groups ?? []).map(g => ({ ...g, member_ids: membersByGroup.get(g.id) ?? [] })) as never}
      initialConfig={normalizeEquipmentConfig(configRow?.config)}
    />
  )
}
