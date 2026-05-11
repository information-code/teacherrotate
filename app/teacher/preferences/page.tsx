import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { PreferencesPage } from '@/components/teacher/PreferencesPage'
import { getRotationTarget } from '@/lib/rotation-target'

export default async function TeacherPreferencesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const [scoresResult, scoremapResult, settingsResult] = await Promise.all([
    admin.from('scores').select('year, score').eq('teacher_id', user.id).order('year'),
    admin.from('scoremap').select('*').order('sort_order'),
    admin.from('settings').select('key, value'),
  ])
  const { data: rotations } = await admin.from('rotations').select('year, work, semester').eq('teacher_id', user.id).order('year')

  const scores = scoresResult.data ?? []
  const scoremap = scoremapResult.data ?? []
  const settingsMap = Object.fromEntries((settingsResult.data ?? []).map(r => [r.key, r.value]))
  const midLowSwitchScore = Number(settingsMap['midlow_switch_score'] ?? 2)
  const targetYear = Number(settingsMap['preference_year'] ?? Math.max(0, ...scores.map(s => s.year)) + 1)

  const { data: prefs } = await admin
    .from('preferences')
    .select('preference1, preference2, preference3, locked, give_up')
    .eq('teacher_id', user.id)
    .eq('year', targetYear)
    .maybeSingle()

  const rotMap: Record<number, { work: string; semester: string }> = {}
  for (const r of rotations ?? []) rotMap[r.year] = { work: r.work, semester: r.semester ?? '全學年' }
  const scoreHistory = scores.map(s => ({
    year: s.year,
    work: rotMap[s.year]?.work,
    semester: rotMap[s.year]?.semester,
    score: s.score,
  }))

  const initialPreferences = {
    preference1: prefs?.preference1 ?? null,
    preference2: prefs?.preference2 ?? null,
    preference3: prefs?.preference3 ?? null,
  }

  const targetType = getRotationTarget((rotations ?? []).map(r => ({ year: r.year, work: r.work })))

  return (
    <PreferencesPage
      targetYear={targetYear}
      targetType={targetType}
      initialScoreHistory={scoreHistory}
      initialPreferences={initialPreferences}
      initialLocked={prefs?.locked ?? false}
      initialGiveUp={prefs?.give_up ?? false}
      initialScoremapRows={scoremap}
      midLowSwitchScore={midLowSwitchScore}
    />
  )
}
