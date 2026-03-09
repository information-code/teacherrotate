import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { ScoresPage } from '@/components/teacher/ScoresPage'

export default async function TeacherScoresPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const [scoresResult, prefsResult, scoremapResult] = await Promise.all([
    admin.from('scores').select('year, score, recent_four_year_total').eq('teacher_id', user.id).order('year'),
    admin.from('preferences').select('preference1, preference2, preference3').eq('teacher_id', user.id).single(),
    admin.from('scoremap').select('*').order('sort_order'),
  ])
  // also need rotations to compute work per year
  const { data: rotations } = await admin.from('rotations').select('year, work').eq('teacher_id', user.id).order('year')

  const scores = scoresResult.data ?? []
  const prefs = prefsResult.data
  const scoremap = scoremapResult.data ?? []

  // Build scoreHistory (merge scores + rotations)
  const rotMap: Record<number, string> = {}
  for (const r of rotations ?? []) rotMap[r.year] = r.work
  const scoreHistory = scores.map(s => ({ year: s.year, work: rotMap[s.year], score: s.score }))
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
    />
  )
}
