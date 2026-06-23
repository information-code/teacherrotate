import { getAdminClient } from '@/lib/supabase/admin'
import AllocationStatisticsClient from './AllocationStatisticsClient'
import {
  normalizeConfig, allocRole, homeroomGrade, adminKind, ADMIN_KIND_LABEL,
  baseForTeacher, defaultTeacherAllocation, orderSubjectNames, GRADES,
  type AllocRole, type TeacherAllocation,
} from '@/lib/allocation'

export const dynamic = 'force-dynamic'

export interface TeacherStat {
  id: string
  name: string
  role: AllocRole
  roleLabel: string
  work: string
  grade: number | null
  base: number | null
  data: TeacherAllocation
}
export interface GradeMeta {
  subjects: string[]      // 導師可配課科目（表格欄位）
  homeroomBase: number
}

export default async function AllocationStatisticsPage() {
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('key, value').in('key', ['preference_year', 'allocation_phase'])
  const sMap = Object.fromEntries((settingsRows ?? []).map(r => [r.key, r.value]))
  const year = Number(sMap['preference_year'] ?? 115)
  const phase: 'open' | 'closed' = sMap['allocation_phase'] === 'closed' ? 'closed' : 'open'

  const [{ data: cfgRow }, { data: profiles }] = await Promise.all([
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name').neq('status', 'inactive').neq('role', 'superadmin'),
  ])
  const config = normalizeConfig(cfgRow?.config)
  const ids = (profiles ?? []).map(p => p.id)
  const nameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))

  const [{ data: rots }, { data: allocs }] = await Promise.all([
    ids.length ? admin.from('rotations').select('teacher_id, work, grade').eq('year', year).in('teacher_id', ids) : Promise.resolve({ data: [] as { teacher_id: string; work: string; grade: number | null }[] }),
    ids.length ? admin.from('allocation').select('teacher_id, data').eq('year', year).in('teacher_id', ids) : Promise.resolve({ data: [] as { teacher_id: string; data: TeacherAllocation }[] }),
  ])
  const rotMap = Object.fromEntries((rots ?? []).map(r => [r.teacher_id, r]))
  const allocMap = Object.fromEntries((allocs ?? []).map(a => [a.teacher_id, a.data as TeacherAllocation]))

  const teachers: TeacherStat[] = []
  for (const id of ids) {
    const rot = rotMap[id]
    if (!rot) continue
    const work = rot.work
    const role = allocRole(work)
    if (role === 'none') continue
    const grade = role === 'homeroom' ? homeroomGrade(work, rot.grade ?? null) : null
    const roleLabel = role === 'homeroom' ? '導師' : role === 'subject' ? '科任' : `行政（${ADMIN_KIND_LABEL[adminKind(work)]}）`
    teachers.push({
      id, name: nameMap[id] ?? id, role, roleLabel, work, grade,
      base: baseForTeacher(config, work, grade),
      data: allocMap[id] ?? defaultTeacherAllocation(role, work, grade),
    })
  }

  const gradesMeta: Record<number, GradeMeta> = {}
  const demandByGradeSubject: Record<number, Record<string, number>> = {}
  for (const g of GRADES) {
    const gc = config.grades[g]
    gradesMeta[g] = {
      subjects: orderSubjectNames(gc.subjects.filter(s => s.homeroom).map(s => s.name).filter(Boolean)),
      homeroomBase: gc.homeroomBase,
    }
    // 各年級各科目需求 = 班級數 × 每班節數（所有科目，含非導師科目供科任比對）
    const m: Record<string, number> = {}
    for (const s of gc.subjects) { if (s.name) m[s.name] = gc.classCount * s.perClass }
    demandByGradeSubject[g] = m
  }

  return <AllocationStatisticsClient year={year} phase={phase} teachers={teachers} gradesMeta={gradesMeta} demandByGradeSubject={demandByGradeSubject} />
}
