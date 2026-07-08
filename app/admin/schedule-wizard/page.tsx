import { getAdminClient } from '@/lib/supabase/admin'
import ScheduleWizardClient from './ScheduleWizardClient'
import { normalizeConfig, GRADES } from '@/lib/allocation'
import { normalizeScheduleConfig } from '@/lib/scheduling'
import type { GradeSubject } from '../schedule-config/page'

export const dynamic = 'force-dynamic'

export default async function ScheduleWizardPage() {
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: cfgRow }, { data: schRow }, { data: profiles }, { data: planRow }, { data: allocs }, { data: hrRows }] = await Promise.all([
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name').neq('status', 'inactive').neq('role', 'superadmin'),
    admin.from('schedule_plan').select('generated_at, plan').eq('year', year).maybeSingle(),
    admin.from('allocation').select('teacher_id, data').eq('year', year),
    admin.from('schedule_homeroom').select('class_key, teacher_id, cells, confirmed_at').eq('year', year),
  ])
  const allocConfig = normalizeConfig(cfgRow?.config)
  const scheduleConfig = normalizeScheduleConfig(schRow?.config)
  const teacherNames = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))

  // 導師自上節數（同科分擔）：由導師配班對應的配課 breakdown 帶出（無減課鏡射，退而求其次取第一個方案）
  const allocMap = Object.fromEntries((allocs ?? []).map(a => [a.teacher_id, a.data as {
    scenarios?: Record<string, { breakdown?: Record<string, number> }>
    plans?: Record<string, { breakdown?: Record<string, number> }>
  }]))
  const homeroomHours: Record<string, Record<string, number>> = {}
  for (const [ck, tid] of Object.entries(scheduleConfig.classTeacher)) {
    if (!tid) continue
    const d = allocMap[tid]
    const bd = d?.scenarios?.['0']?.breakdown ?? Object.values(d?.plans ?? {})[0]?.breakdown
    if (bd && Object.values(bd).some(v => Number(v) > 0)) homeroomHours[ck] = bd
  }

  const classCounts: Record<number, number> = {}
  const gradeSubjects: Record<number, GradeSubject[]> = {}
  const gradeHomeroomBase: Record<number, number> = {}
  for (const g of GRADES) {
    classCounts[g] = allocConfig.grades[g].classCount
    gradeSubjects[g] = allocConfig.grades[g].subjects.map(s => ({ name: s.name, perClass: s.perClass, homeroom: s.homeroom }))
    gradeHomeroomBase[g] = allocConfig.grades[g].homeroomBase
  }

  return (
    <ScheduleWizardClient
      year={year}
      scheduleConfig={scheduleConfig}
      classCounts={classCounts}
      gradeSubjects={gradeSubjects}
      gradeHomeroomBase={gradeHomeroomBase}
      teacherNames={teacherNames}
      homeroomHours={homeroomHours}
      lastGeneratedAt={planRow?.generated_at ?? null}
      initialPlanStatus={String((planRow?.plan as { status?: string } | null)?.status ?? '') || null}
      savedPlan={(planRow?.plan ?? null) as Record<string, unknown> | null}
      homeroomRows={(hrRows ?? []) as { class_key: string; teacher_id: string; cells: Record<string, string>; confirmed_at: string | null }[]}
    />
  )
}
