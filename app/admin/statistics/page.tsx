import { getAdminClient } from '@/lib/supabase/admin'
import StatisticsClient from './StatisticsClient'

export const dynamic = 'force-dynamic'

interface StatRow {
  work: string
  pref1: number
  pref2: number
  pref3: number
  total: number
}

export interface TeacherEval {
  id: string
  name: string
  pref1: string | null
  pref2: string | null
  pref3: string | null
  score: number
}

export default async function StatisticsPage() {
  const admin = getAdminClient()

  // 先取在職教師 ID，再用 .in() 過濾志願，排除離校者
  const { data: activeProfiles } = await admin
    .from('profiles').select('id, name').neq('status', 'inactive')

  const activeIds = (activeProfiles ?? []).map(p => p.id)

  const [prefsResult, scoresResult] = await Promise.all([
    activeIds.length > 0
      ? admin.from('preferences').select('teacher_id, preference1, preference2, preference3').in('teacher_id', activeIds)
      : Promise.resolve({ data: [] }),
    admin.from('scores').select('teacher_id, recent_four_year_total').not('recent_four_year_total', 'is', null),
  ])

  const profilesResult = { data: activeProfiles }

  // 統計志願
  const stats: Record<string, { pref1: number; pref2: number; pref3: number }> = {}
  for (const p of prefsResult.data ?? []) {
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

  // 建立教師評估資料（有填志願的教師）
  const profileMap = Object.fromEntries((profilesResult.data ?? []).map(p => [p.id, p.name ?? '']))
  // 每位教師取最新一筆的近四年總分
  const scoreMap: Record<string, number> = {}
  for (const s of scoresResult.data ?? []) {
    const cur = scoreMap[s.teacher_id] ?? -Infinity
    if ((s.recent_four_year_total ?? 0) > cur) {
      scoreMap[s.teacher_id] = s.recent_four_year_total ?? 0
    }
  }

  const teachers: TeacherEval[] = (prefsResult.data ?? [])
    .filter(p => p.preference1 || p.preference2 || p.preference3)
    .map(p => ({
      id: p.teacher_id,
      name: profileMap[p.teacher_id] ?? p.teacher_id,
      pref1: p.preference1 ?? null,
      pref2: p.preference2 ?? null,
      pref3: p.preference3 ?? null,
      score: scoreMap[p.teacher_id] ?? 0,
    }))

  return <StatisticsClient initialStats={result} initialTeachers={teachers} />
}
