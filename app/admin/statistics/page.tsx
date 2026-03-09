import { getAdminClient } from '@/lib/supabase/admin'
import StatisticsClient from './StatisticsClient'

interface StatRow {
  work: string
  pref1: number
  pref2: number
  pref3: number
  total: number
}

export default async function StatisticsPage() {
  const admin = getAdminClient()
  const { data: prefs } = await admin
    .from('preferences')
    .select('preference1, preference2, preference3')

  // Tally preferences per work position (same logic as the API route)
  const stats: Record<string, { pref1: number; pref2: number; pref3: number }> = {}

  for (const p of prefs ?? []) {
    const fields = [
      { value: p.preference1, rank: 'pref1' as const },
      { value: p.preference2, rank: 'pref2' as const },
      { value: p.preference3, rank: 'pref3' as const },
    ]
    for (const { value, rank } of fields) {
      if (!value) continue
      if (!stats[value]) stats[value] = { pref1: 0, pref2: 0, pref3: 0 }
      stats[value][rank]++
    }
  }

  const result: StatRow[] = Object.entries(stats)
    .map(([work, counts]) => ({
      work,
      pref1: counts.pref1,
      pref2: counts.pref2,
      pref3: counts.pref3,
      total: counts.pref1 + counts.pref2 + counts.pref3,
    }))
    .sort((a, b) => b.total - a.total)

  return <StatisticsClient initialStats={result} />
}
