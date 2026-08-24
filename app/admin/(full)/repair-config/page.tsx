import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import { parseGuide, parseRepairConfig } from '@/lib/repair'
import RepairConfigClient from './RepairConfigClient'

export const dynamic = 'force-dynamic'

export default async function RepairConfigPage() {
  await guardPage(['repair-config'])
  const admin = getAdminClient()
  const [{ data: items }, { data: issues }, { data: contacts }, { data: configRow }] = await Promise.all([
    admin.from('repair_items').select('*').order('sort_order').order('name'),
    admin.from('repair_issues').select('*').order('sort_order').order('name'),
    admin.from('repair_contacts').select('*').order('sort_order').order('name'),
    admin.from('repair_config').select('config').eq('id', 1).maybeSingle(),
  ])
  return (
    <RepairConfigClient
      initialItems={(items ?? []).map(i => ({
        id: i.id, name: i.name, fallback_guide: parseGuide(i.fallback_guide),
        active: i.active, sort_order: i.sort_order,
      }))}
      initialIssues={(issues ?? []).map(s => ({
        id: s.id, item_id: s.item_id, name: s.name,
        aliases: Array.isArray(s.aliases) ? (s.aliases as string[]) : [],
        guide: parseGuide(s.guide), active: s.active, sort_order: s.sort_order,
      }))}
      initialContacts={(contacts ?? []).map(c => ({
        id: c.id, name: c.name, role: c.role, contact: c.contact,
        note: c.note, active: c.active, sort_order: c.sort_order,
      }))}
      initialConfig={parseRepairConfig(configRow?.config)}
    />
  )
}
