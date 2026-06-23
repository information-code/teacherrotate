import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ScoresPage } from '@/components/teacher/ScoresPage'
import { getRotationTarget } from '@/lib/rotation-target'

export default async function TeacherScoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const [scoresResult, profileResult, settingsResult] = await Promise.all([
    admin.from('scores').select('year, score, recent_four_year_total').eq('teacher_id', user.id).order('year'),
    admin.from('profiles').select('score_confirmed, score_confirmed_at').eq('id', user.id).single(),
    admin.from('settings').select('key, value').in('key', ['preference_phase', 'preference_year']),
  ])
  const settingsMap = Object.fromEntries((settingsResult.data ?? []).map(r => [r.key, r.value]))
  const closed = settingsMap['preference_phase'] === 'closed'
  const { data: rotations } = await admin.from('rotations').select('year, work, semester, grade').eq('teacher_id', user.id).order('year')

  const allScores = scoresResult.data ?? []
  // 在「選填目標年度（preference_year）」開放前，老師端只看得到該年度之前的分數與工作，
  // 不因管理者已套用撕榜（提前寫入當年度 rotation/score）而提前看到。
  const targetYear = Number(settingsMap['preference_year'] ?? Math.max(0, ...allScores.map(s => s.year)) + 1)
  const scores = allScores.filter(s => s.year < targetYear)
  const cappedRotations = (rotations ?? []).filter(r => r.year < targetYear)

  const rotMap: Record<number, { work: string; semester: string }> = {}
  for (const r of cappedRotations) rotMap[r.year] = { work: r.work, semester: r.semester ?? '全學年' }
  const scoreHistory = scores.map(s => ({
    year: s.year,
    work: rotMap[s.year]?.work,
    semester: rotMap[s.year]?.semester,
    score: s.score,
  }))
  // 近四年總分當場由（已上限過濾的）分數重算，不依賴僅存在最大年度列的 recent_four_year_total
  const recentTotal = scores.length
    ? Number(scores.slice(-4).reduce((acc, s) => acc + (s.score ?? 0), 0).toFixed(2))
    : null
  const targetType = getRotationTarget(cappedRotations.map(r => ({ year: r.year, work: r.work, grade: r.grade ?? null })))

  return (
    <ScoresPage
      targetType={targetType}
      initialScoreHistory={scoreHistory}
      initialRecentTotal={recentTotal}
      initialConfirmed={profileResult.data?.score_confirmed ?? false}
      initialConfirmedAt={profileResult.data?.score_confirmed_at ?? null}
      closed={closed}
    />
  )
}
