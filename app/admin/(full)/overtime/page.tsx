import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import { normalizeScheduleConfig, homeroomLockSlots, deriveNativeSessions } from '@/lib/scheduling'
import { normalizeConfig as normalizeAllocConfig, GRADES, adoptedReduction, type TeacherAllocation } from '@/lib/allocation'
import { buildTeacherCourses, type TeacherCourse } from '@/lib/overtime-courses'
import type { PlacedResult } from '@/lib/schedule-engine'
import OvertimeClient from './OvertimeClient'

export const dynamic = 'force-dynamic'

export default async function OvertimePage() {
  await guardPage(['overtime'])
  const admin = getAdminClient()

  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [
    { data: plans },
    { data: teachers },
    { data: slots },
    { data: skips },
    { data: holidays },
    { data: profiles },
    { data: schRow },
    { data: planRow },
    { data: hrRows },
    { data: allocCfgRow },
    { data: allocRows },
  ] = await Promise.all([
    admin.from('overtime_plans').select('*').order('start_date'),
    admin.from('overtime_teachers').select('*').order('created_at'),
    admin.from('overtime_slots').select('*').order('weekday').order('period'),
    admin.from('overtime_skip_dates').select('*').order('date'),
    admin.from('holidays').select('date, name, is_holiday').order('date'),
    admin.from('profiles').select('id, name, employment_type').neq('status', 'inactive').order('name'),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_plan').select('plan').eq('year', year).maybeSingle(),
    admin.from('schedule_homeroom').select('class_key, cells').eq('year', year),
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('allocation').select('teacher_id, data').eq('year', year),
  ])

  // ── 由已發布課表組出各教師的週課務（供點選減課時段；未發布則為空，改用手動輸入）──
  let teacherCourses: Record<string, TeacherCourse[]> = {}
  const schedulePlan = (planRow?.plan ?? null) as { status?: string; placed?: PlacedResult[] } | null
  if (schedulePlan && (schedulePlan.status === 'final' || schedulePlan.status === 'published')) {
    const config = normalizeScheduleConfig(schRow?.config)
    const allocConfig = normalizeAllocConfig(allocCfgRow?.config)
    // 本土語場次：配課推導（比照教師課表頁）
    const extraNames = new Set(allocConfig.extraCourses.map(c => c.lang).filter(Boolean))
    const hoursByTeacher: Record<string, Record<string, Record<string, number>>> = {}
    for (const row of allocRows ?? []) {
      const sgh = (row.data as TeacherAllocation | null)?.subjectGradeHours ?? {}
      for (const [subj, byGrade] of Object.entries(sgh)) {
        if (!extraNames.has(subj)) continue
        ;(hoursByTeacher[row.teacher_id] ??= {})[subj] = byGrade as Record<string, number>
      }
    }
    const derived = deriveNativeSessions({ config, extraCourses: allocConfig.extraCourses, hoursByTeacher })
    // 導師自上的鎖課格（依配課 breakdown 判斷）
    const allocById = Object.fromEntries((allocRows ?? []).map(a => [a.teacher_id, a.data as TeacherAllocation | null]))
    const homeroomLocks: Record<string, string[]> = {}
    for (const g of GRADES) {
      const rk = String(adoptedReduction(allocConfig.grades[g]))
      for (let i = 0; i < allocConfig.grades[g].classCount; i++) {
        const ck = `${g}-${i}`
        const d = allocById[config.classTeacher[ck] ?? '']
        const bd = d?.scenarios?.[rk]?.breakdown ?? d?.scenarios?.['0']?.breakdown
        homeroomLocks[ck] = homeroomLockSlots(config, g, i, bd as Record<string, number> | undefined)
      }
    }
    teacherCourses = buildTeacherCourses({
      placed: schedulePlan.placed ?? [],
      config,
      homeroomCells: Object.fromEntries((hrRows ?? []).map(r => [r.class_key, (r.cells ?? {}) as Record<string, string>])),
      homeroomLocks,
      nativeSessions: derived.sessions,
    })
  }

  return (
    <OvertimeClient
      initialPlans={(plans ?? []).map(p => ({
        id: p.id, name: p.name, start_date: p.start_date, end_date: p.end_date,
        rate: p.rate, budget: p.budget,
      }))}
      initialTeachers={(teachers ?? []).map(t => ({
        id: t.id, plan_id: t.plan_id, teacher_id: t.teacher_id, name: t.name,
        category: t.category, labor_fee: t.labor_fee, health_fee: t.health_fee,
        lunch_fee: t.lunch_fee, other_fee: t.other_fee, note: t.note,
      }))}
      initialSlots={(slots ?? []).map(s => ({
        id: s.id, teacher_row_id: s.teacher_row_id, weekday: s.weekday,
        period: s.period, class_name: s.class_name, domain: s.domain,
      }))}
      initialSkips={(skips ?? []).map(s => ({ id: s.id, date: s.date, name: s.name }))}
      holidays={(holidays ?? []).map(h => ({ date: h.date, name: h.name, is_holiday: h.is_holiday }))}
      profileOptions={(profiles ?? [])
        .filter(p => p.name)
        .map(p => ({ id: p.id, name: p.name as string, employment_type: p.employment_type }))}
      teacherCourses={teacherCourses}
    />
  )
}
