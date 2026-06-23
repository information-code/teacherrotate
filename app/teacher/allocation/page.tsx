import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { AllocationPage } from '@/components/teacher/AllocationPage'
import {
  normalizeConfig, allocRole, homeroomGrade, adminKind, ADMIN_KIND_LABEL,
  baseForTeacher, defaultTeacherAllocation, REDUCTIONS,
  type TeacherAllocation, type AllocationPlan,
} from '@/lib/allocation'

export const dynamic = 'force-dynamic'

export interface HomeroomCtx {
  grade: number
  homeroomBase: number
  subjects: string[]
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

  const [{ data: rot }, { data: cfgRow }, { data: allocRow }] = await Promise.all([
    admin.from('rotations').select('work, grade').eq('teacher_id', user.id).eq('year', year).maybeSingle(),
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('allocation').select('data').eq('teacher_id', user.id).eq('year', year).maybeSingle(),
  ])

  const config = normalizeConfig(cfgRow?.config)
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
      subjects: gc.subjects.map(s => s.name).filter(Boolean),
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
      base={base} homeroom={homeroom} closed={closed} initial={initial}
    />
  )
}
