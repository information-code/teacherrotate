import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import ScheduleWizardClient from './ScheduleWizardClient'
import { normalizeConfig, GRADES, adoptedReduction } from '@/lib/allocation'
import { normalizeScheduleConfig } from '@/lib/scheduling'
import type { GradeSubject } from '../schedule-config/page'

export const dynamic = 'force-dynamic'

export default async function ScheduleWizardPage() {
  await guardPage(['schedule-wizard'])
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: cfgRow }, { data: schRow }, { data: profiles }, { data: planRow }, { data: allocs }, { data: hrRows }] = await Promise.all([
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name, employment_type').neq('status', 'inactive'),
    admin.from('schedule_plan').select('generated_at, plan').eq('year', year).maybeSingle(),
    admin.from('allocation').select('teacher_id, data').eq('year', year),
    admin.from('schedule_homeroom').select('class_key, teacher_id, cells, confirmed_at').eq('year', year),
  ])
  const allocConfig = normalizeConfig(cfgRow?.config)
  const scheduleConfig = normalizeScheduleConfig(schRow?.config)
  const teacherNames = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))
  // 鐘點教師 id：引擎的「鐘點每週分布」需要辨識身分（其餘規則三種身分共用）
  const hourlyTeacherIds = (profiles ?? []).filter(p => p.employment_type === 'hourly').map(p => p.id)

  // 導師自上節數（同科分擔）：由導師配班對應的配課 breakdown 帶出。
  // 情境依「該班年級的採用情境」（各年級可不同，如一年級減1、二～四減2）；退而求其次情境0、第一個方案。
  const allocMap = Object.fromEntries((allocs ?? []).map(a => [a.teacher_id, a.data as {
    scenarios?: Record<string, { breakdown?: Record<string, number> }>
    plans?: Record<string, { breakdown?: Record<string, number> }>
    subjectGradeHours?: Record<string, Record<string, number>>
  }]))
  const homeroomHours: Record<string, Record<string, number>> = {}
  for (const [ck, tid] of Object.entries(scheduleConfig.classTeacher)) {
    if (!tid) continue
    const d = allocMap[tid]
    const g = Number(ck.split('-')[0])
    const rk = String(adoptedReduction(allocConfig.grades[g]))
    const bd = d?.scenarios?.[rk]?.breakdown ?? d?.scenarios?.['0']?.breakdown ?? Object.values(d?.plans ?? {})[0]?.breakdown
    if (bd && Object.values(bd).some(v => Number(v) > 0)) homeroomHours[ck] = bd
  }

  // 本土語額外授課（語別×年級）：老師配課節數（tid → 語別 → 年級 → 節數），供場次自動推導
  const extraCourses = allocConfig.extraCourses
  const extraNames = new Set(extraCourses.map(c => c.lang).filter(Boolean))
  const hoursByTeacher: Record<string, Record<string, Record<string, number>>> = {}
  // 全體科任/行政/鐘點配課節數：未手動配班的班級由引擎自動分配
  const supplyByTeacher: Record<string, Record<string, Record<string, number>>> = {}
  for (const a of allocs ?? []) {
    const sgh = allocMap[a.teacher_id]?.subjectGradeHours ?? {}
    if (Object.keys(sgh).length) supplyByTeacher[a.teacher_id] = sgh
    for (const [subj, byGrade] of Object.entries(sgh)) {
      if (!extraNames.has(subj)) continue
      ;(hoursByTeacher[a.teacher_id] ??= {})[subj] = byGrade
    }
  }

  const classCounts: Record<number, number> = {}
  const gradeSubjects: Record<number, GradeSubject[]> = {}
  const gradeHomeroomBase: Record<number, number> = {}
  for (const g of GRADES) {
    classCounts[g] = allocConfig.grades[g].classCount
    gradeSubjects[g] = allocConfig.grades[g].subjects.map(s => ({ name: s.name, perClass: s.perClass, homeroom: s.homeroom }))
    // 留白檢核用的導師節數＝基本 − 該年級採用情境減課（否則減課年級全數誤報「留白少於基本」）
    gradeHomeroomBase[g] = allocConfig.grades[g].homeroomBase - adoptedReduction(allocConfig.grades[g])
  }

  return (
    <ScheduleWizardClient
      year={year}
      scheduleConfig={scheduleConfig}
      classCounts={classCounts}
      gradeSubjects={gradeSubjects}
      gradeHomeroomBase={gradeHomeroomBase}
      teacherNames={teacherNames}
      hourlyTeacherIds={hourlyTeacherIds}
      homeroomHours={homeroomHours}
      extraCourses={extraCourses}
      hoursByTeacher={hoursByTeacher}
      supplyByTeacher={supplyByTeacher}
      lastGeneratedAt={planRow?.generated_at ?? null}
      initialPlanStatus={String((planRow?.plan as { status?: string } | null)?.status ?? '') || null}
      savedPlan={(planRow?.plan ?? null) as Record<string, unknown> | null}
      homeroomRows={(hrRows ?? []) as { class_key: string; teacher_id: string; cells: Record<string, string>; confirmed_at: string | null }[]}
    />
  )
}
