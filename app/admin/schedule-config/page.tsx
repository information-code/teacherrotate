import { getAdminClient } from '@/lib/supabase/admin'
import ScheduleConfigClient from './ScheduleConfigClient'
import { normalizeConfig, allocRole, homeroomGrade, GRADES, type TeacherAllocation } from '@/lib/allocation'
import { normalizeScheduleConfig } from '@/lib/scheduling'

export const dynamic = 'force-dynamic'

export interface HomeroomTeacher { id: string; name: string; grade: number }

export default async function ScheduleConfigPage() {
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: cfgRow }, { data: schRow }, { data: profiles }] = await Promise.all([
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name, employment_type').neq('status', 'inactive').neq('role', 'superadmin'),
  ])
  const config = normalizeConfig(cfgRow?.config)
  const scheduleConfig = normalizeScheduleConfig(schRow?.config)

  const ids = (profiles ?? []).map(p => p.id)
  const nameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))
  const empMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.employment_type]))

  const [{ data: rots }, { data: allocs }] = await Promise.all([
    ids.length ? admin.from('rotations').select('teacher_id, work, grade').eq('year', year).in('teacher_id', ids) : Promise.resolve({ data: [] as { teacher_id: string; work: string; grade: number | null }[] }),
    ids.length ? admin.from('allocation').select('teacher_id, data').eq('year', year).in('teacher_id', ids) : Promise.resolve({ data: [] as { teacher_id: string; data: TeacherAllocation }[] }),
  ])
  const rotMap = Object.fromEntries((rots ?? []).map(r => [r.teacher_id, r]))
  const allocMap = Object.fromEntries((allocs ?? []).map(a => [a.teacher_id, a.data as TeacherAllocation]))

  const homerooms: HomeroomTeacher[] = []
  for (const id of ids) {
    if (empMap[id] === 'substitute') {
      const d = allocMap[id]
      if (d?.role === 'homeroom' && d.grade) homerooms.push({ id, name: nameMap[id] ?? id, grade: d.grade })
      continue
    }
    const rot = rotMap[id]
    if (!rot || allocRole(rot.work) !== 'homeroom') continue
    const grade = homeroomGrade(rot.work, rot.grade ?? null)
    if (grade) homerooms.push({ id, name: nameMap[id] ?? id, grade })
  }

  const classCounts: Record<number, number> = {}
  for (const g of GRADES) classCounts[g] = config.grades[g].classCount

  return (
    <ScheduleConfigClient
      year={year}
      initialConfig={scheduleConfig}
      classCounts={classCounts}
      homerooms={homerooms}
    />
  )
}
