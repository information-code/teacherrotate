import { getAdminClient } from '@/lib/supabase/admin'
import { getRotationTarget, type RotationTarget } from '@/lib/rotation-target'
import ConfirmationsClient from './ConfirmationsClient'

export const dynamic = 'force-dynamic'

export default async function ConfirmationsPage() {
  const admin = getAdminClient()
  const [{ data: profiles }, { data: rotations }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, name, email, score_confirmed, score_confirmed_at')
      .not('role', 'eq', 'superadmin')
      .neq('status', 'inactive')
      .order('name'),
    admin.from('rotations').select('teacher_id, year, work'),
  ])

  const rotByTeacher: Record<string, { year: number; work: string }[]> = {}
  for (const r of rotations ?? []) {
    if (!rotByTeacher[r.teacher_id]) rotByTeacher[r.teacher_id] = []
    rotByTeacher[r.teacher_id].push({ year: r.year, work: r.work })
  }

  const teachers = (profiles ?? []).map(p => ({
    ...p,
    targetType: getRotationTarget(rotByTeacher[p.id] ?? []),
  }))

  return <ConfirmationsClient initialTeachers={teachers} />
}
