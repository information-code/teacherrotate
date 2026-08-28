import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import OvertimeClient from './OvertimeClient'

export const dynamic = 'force-dynamic'

export default async function OvertimePage() {
  await guardPage(['overtime'])
  const admin = getAdminClient()
  const [
    { data: plans },
    { data: teachers },
    { data: slots },
    { data: skips },
    { data: holidays },
    { data: profiles },
  ] = await Promise.all([
    admin.from('overtime_plans').select('*').order('start_date'),
    admin.from('overtime_teachers').select('*').order('created_at'),
    admin.from('overtime_slots').select('*').order('weekday').order('period'),
    admin.from('overtime_skip_dates').select('*').order('date'),
    admin.from('holidays').select('date, name, is_holiday').order('date'),
    admin.from('profiles').select('id, name, employment_type').neq('status', 'inactive').order('name'),
  ])
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
    />
  )
}
