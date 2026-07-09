import { getAdminClient } from '@/lib/supabase/admin'
import ScoremapClient from './ScoremapClient'

export const dynamic = 'force-dynamic'

export default async function ScoremapPage() {
  const admin = getAdminClient()
  const [{ data: scoremap }, { data: settings }] = await Promise.all([
    admin.from('scoremap').select('*').order('sort_order'),
    admin.from('settings').select('key, value'),
  ])
  const settingsMap = Object.fromEntries((settings ?? []).map(r => [r.key, r.value]))
  const midLowSwitchScore = Number(settingsMap['midlow_switch_score'] ?? 2)
  return <ScoremapClient initialRows={scoremap ?? []} initialMidLowSwitchScore={midLowSwitchScore} />
}
