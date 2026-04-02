import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ScoresPage } from '@/components/teacher/ScoresPage'

export default async function TeacherScoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const [scoresResult, prefsResult, scoremapResult, settingsResult, profileResult] = await Promise.all([
    admin.from('scores').select('year, score, recent_four_year_total').eq('teacher_id', user.id).order('year'),
    admin.from('preferences').select('preference1, preference2, preference3').eq('teacher_id', user.id).single(),
    admin.from('scoremap').select('*').order('sort_order'),
    admin.from('settings').select('key, value'),
    admin.from('profiles').select('score_confirmed, score_confirmed_at').eq('id', user.id).single(),
  ])
  // also need rotations to compute work per year
  const { data: rotations } = await admin.from('rotations').select('year, work, semester').eq('teacher_id', user.id).order('year')

  const scores = scoresResult.data ?? []
  const prefs = prefsResult.data
  const scoremap = scoremapResult.data ?? []
  const settingsMap = Object.fromEntries((settingsResult.data ?? []).map(r => [r.key, r.value]))
  const midLowSwitchScore = Number(settingsMap['midlow_switch_score'] ?? 2)

  // Build scoreHistory (merge scores + rotations)
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

  const initialPreferences = {
    preference1: prefs?.preference1 ?? null,
    preference2: prefs?.preference2 ?? null,
    preference3: prefs?.preference3 ?? null,
  }

  return (
    <ScoresPage
      initialScoreHistory={scoreHistory}
      initialRecentTotal={recentTotal}
      initialPreferences={initialPreferences}
      initialScoremapRows={scoremap}
      midLowSwitchScore={midLowSwitchScore}
      initialConfirmed={profileResult.data?.score_confirmed ?? false}
      initialConfirmedAt={profileResult.data?.score_confirmed_at ?? null}
    />
  )
}
