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
  const [scoresResult, profileResult, phaseResult] = await Promise.all([
    admin.from('scores').select('year, score, recent_four_year_total').eq('teacher_id', user.id).order('year'),
    admin.from('profiles').select('score_confirmed, score_confirmed_at').eq('id', user.id).single(),
    admin.from('settings').select('value').eq('key', 'preference_phase').maybeSingle(),
  ])
  const closed = phaseResult.data?.value === 'closed'
  const { data: rotations } = await admin.from('rotations').select('year, work, semester, grade').eq('teacher_id', user.id).order('year')

  const scores = scoresResult.data ?? []

  const rotMap: Record<number, { work: string; semester: string }> = {}
  for (const r of rotations ?? []) rotMap[r.year] = { work: r.work, semester: r.semester ?? '全學年' }
  const scoreHistory = scores.map(s => ({
    year: s.year,
    work: rotMap[s.year]?.work,
    semester: rotMap[s.year]?.semester,
    score: s.score,
  }))
  const latest = scores[scores.length - 1]
  const recentTotal = latest?.recent_four_year_total ?? null
  const targetType = getRotationTarget((rotations ?? []).map(r => ({ year: r.year, work: r.work, grade: r.grade ?? null })))

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
