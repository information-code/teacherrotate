import { getAdminClient } from '@/lib/supabase/admin'
import { getRotationTarget } from '@/lib/rotation-target'
import ConfirmationsClient from './ConfirmationsClient'

export const dynamic = 'force-dynamic'

export default async function ConfirmationsPage() {
  const admin = getAdminClient()
  const [{ data: profiles }, { data: rotations }, { data: settingsRows }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, name, email, score_confirmed, score_confirmed_at')
      .not('role', 'eq', 'superadmin')
      .neq('status', 'inactive')
      .order('name'),
    admin.from('rotations').select('teacher_id, year, work, grade'),
    admin.from('settings').select('key, value').eq('key', 'preference_year'),
  ])

  const preferenceYear = Number(settingsRows?.[0]?.value ?? 115)

  const { data: prefs } = await admin
    .from('preferences')
    .select('teacher_id, locked, give_up, preference1, preference2, preference3')
    .eq('year', preferenceYear)

  const prefByTeacher = Object.fromEntries(
    (prefs ?? []).map(p => [p.teacher_id, p])
  )

  const rotByTeacher: Record<string, { year: number; work: string; grade: number | null }[]> = {}
  for (const r of rotations ?? []) {
    if (!rotByTeacher[r.teacher_id]) rotByTeacher[r.teacher_id] = []
    rotByTeacher[r.teacher_id].push({ year: r.year, work: r.work, grade: r.grade ?? null })
  }

  const teachers = (profiles ?? []).map(p => {
    const pref = prefByTeacher[p.id]
    return {
      ...p,
      targetType: getRotationTarget(rotByTeacher[p.id] ?? []),
      prefLocked: pref?.locked ?? false,
      prefGiveUp: pref?.give_up ?? false,
      prefFilled: !!(pref?.preference1 || pref?.preference2 || pref?.preference3),
    }
  })

  return <ConfirmationsClient initialTeachers={teachers} preferenceYear={preferenceYear} />
}
