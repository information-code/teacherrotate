import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { AllocationPage } from '@/components/teacher/AllocationPage'
import { SubstituteAllocationPage } from '@/components/teacher/SubstituteAllocationPage'
import {
  normalizeConfig, allocRole, homeroomGrade, adminKind, ADMIN_KIND_LABEL,
  baseForTeacher, defaultTeacherAllocation, orderSubjectNames, REDUCTIONS, GRADES,
  type TeacherAllocation, type AllocationPlan,
} from '@/lib/allocation'

export const dynamic = 'force-dynamic'

export interface HomeroomCtx {
  grade: number
  homeroomBase: number
  subjects: string[]
  subjectMax: Record<string, number>   // 各科上限＝配課設定的每班基本節數（perClass）
  scenarios: { reduction: number; plans: AllocationPlan[] }[]
}

export default async function TeacherAllocationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = getAdminClient()

  const { data: settingsRows } = await admin.from('settings').select('key, value').in('key', ['preference_year', 'allocation_phase'])
  const sMap = Object.fromEntries((settingsRows ?? []).map(r => [r.key, r.value]))
  const year = Number(sMap['preference_year'] ?? 115)
  const closed = sMap['allocation_phase'] === 'closed'

  const [{ data: rot }, { data: cfgRow }, { data: allocRow }, { data: prof }] = await Promise.all([
    admin.from('rotations').select('work, grade').eq('teacher_id', user.id).eq('year', year).maybeSingle(),
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('allocation').select('data').eq('teacher_id', user.id).eq('year', year).maybeSingle(),
    admin.from('profiles').select('employment_type').eq('id', user.id).single(),
  ])

  const config = normalizeConfig(cfgRow?.config)
  const allSubjects = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => config.grades[g].subjects.map(s => s.name)))).filter(Boolean))

  // 代理教師：不依 rotation，自行於頁面選身分（導師／科任）
  if (prof?.employment_type === 'substitute') {
    const subGrades: Record<number, HomeroomCtx> = {}
    for (const g of GRADES) {
      const gc = config.grades[g]
      subGrades[g] = {
        grade: g,
        homeroomBase: gc.homeroomBase,
        subjects: gc.subjects.filter(s => s.homeroom).map(s => s.name).filter(Boolean),
        subjectMax: Object.fromEntries(gc.subjects.filter(s => s.homeroom && s.name).map(s => [s.name, s.perClass])),
        scenarios: REDUCTIONS.filter(r => gc.scenarios[r].enabled).map(r => ({ reduction: r, plans: gc.scenarios[r].plans })),
      }
    }
    const subInitial = (allocRow?.data as TeacherAllocation | null) ?? defaultTeacherAllocation('none', '', null)
    return (
      <SubstituteAllocationPage
        year={year} closed={closed} subjectBase={config.subjectBase}
        grades={subGrades} allSubjects={allSubjects} initial={subInitial}
      />
    )
  }
  const work = rot?.work ?? ''
  const role = allocRole(work)
  const grade = role === 'homeroom' ? homeroomGrade(work, rot?.grade ?? null) : null

  const initial = (allocRow?.data as TeacherAllocation | null) ?? defaultTeacherAllocation(role, work, grade)

  let homeroom: HomeroomCtx | null = null
  if (role === 'homeroom' && grade) {
    const gc = config.grades[grade]
    homeroom = {
      grade,
      homeroomBase: gc.homeroomBase,
      subjects: gc.subjects.filter(s => s.homeroom).map(s => s.name).filter(Boolean),
      subjectMax: Object.fromEntries(gc.subjects.filter(s => s.homeroom && s.name).map(s => [s.name, s.perClass])),
      scenarios: REDUCTIONS.filter(r => gc.scenarios[r].enabled).map(r => ({ reduction: r, plans: gc.scenarios[r].plans })),
    }
  }

  const base = baseForTeacher(config, work, grade)
  const roleLabel =
    role === 'homeroom' ? '導師'
    : role === 'subject' ? '科任'
    : role === 'admin' ? `行政（${ADMIN_KIND_LABEL[adminKind(work)]}）`
    : ''

  return (
    <AllocationPage
      year={year} role={role} work={work} grade={grade} roleLabel={roleLabel}
      base={base} homeroom={homeroom} allSubjects={allSubjects} closed={closed} initial={initial}
    />
  )
}
