import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { calculateTeacherScores, calcRecentFourYearTotal, buildScoreMaps } from '@/lib/score-engine'

async function getMidLowSwitchScore(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'midlow_switch_score')
    .single()
  return data ? Number(data.value) : 2
}

/** 重新計算指定教師列表的分數並寫入 scores 表 */
export async function recalcTeacherScores(teacherIds: string[]): Promise<void> {
  const [{ data: scoremapRows }, midLowSwitchScore] = await Promise.all([
    supabaseAdmin.from('scoremap').select('*'),
    getMidLowSwitchScore(),
  ])
  const { scoreMap, groupMap } = buildScoreMaps(scoremapRows ?? [])

  for (const teacherId of teacherIds) {
    const { data: rotData } = await supabaseAdmin
      .from('rotations')
      .select('year, work, semester')
      .eq('teacher_id', teacherId)
      .order('year', { ascending: true })

    if (!rotData || rotData.length === 0) continue

    const yearScores = calculateTeacherScores(rotData, scoreMap, groupMap, midLowSwitchScore)
    const total = calcRecentFourYearTotal(yearScores)
    const maxYear = Math.max(...Object.keys(yearScores).map(Number))

    const upserts = Object.entries(yearScores).map(([y, score]) => ({
      teacher_id: teacherId,
      year: Number(y),
      score,
      recent_four_year_total: Number(y) === maxYear ? total : null,
    }))

    if (upserts.length > 0) {
      await supabaseAdmin
        .from('scores')
        .upsert(upserts, { onConflict: 'teacher_id,year' })
    }
  }
}

/** 重新計算所有教師的分數 */
export async function recalcAllScores(): Promise<number> {
  const { data: teachers } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .neq('status', 'inactive')
    .neq('role', 'superadmin')

  const ids = (teachers ?? []).map((t: { id: string }) => t.id)
  await recalcTeacherScores(ids)
  return ids.length
}
