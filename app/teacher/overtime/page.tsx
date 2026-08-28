import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { normalizeRanges } from '@/lib/overtime'
import OvertimeTeacherClient from './OvertimeTeacherClient'

export const dynamic = 'force-dynamic'

/** 教師端超鐘簽到：只看得到自己參與的計畫與時段，下載個人簽到表 PDF（無清冊） */
export default async function TeacherOvertimePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = getAdminClient()

  const { data: myRows } = await admin.from('overtime_teachers')
    .select('*').eq('teacher_id', user.id)
  const rows = myRows ?? []
  const planIds = Array.from(new Set(rows.map(r => r.plan_id)))
  const rowIds = rows.map(r => r.id)

  const [{ data: plans }, { data: slots }, { data: skips }, { data: holidays }] = await Promise.all([
    planIds.length
      ? admin.from('overtime_plans').select('*').in('id', planIds).order('start_date')
      : Promise.resolve({ data: [] as never[] }),
    rowIds.length
      ? admin.from('overtime_slots').select('*').in('teacher_row_id', rowIds).order('weekday').order('period')
      : Promise.resolve({ data: [] as never[] }),
    admin.from('overtime_skip_dates').select('*').order('date'),
    admin.from('holidays').select('date, name, is_holiday').order('date'),
  ])

  return (
    <OvertimeTeacherClient
      myRows={rows.map(t => ({
        id: t.id, plan_id: t.plan_id, teacher_id: t.teacher_id, name: t.name,
        category: t.category, labor_fee: t.labor_fee, health_fee: t.health_fee,
        lunch_fee: t.lunch_fee, other_fee: t.other_fee, note: t.note,
        ranges: normalizeRanges(t.ranges),
      }))}
      plans={(plans ?? []).map(p => ({
        id: p.id, name: p.name, start_date: p.start_date, end_date: p.end_date,
        rate: p.rate, budget: p.budget,
      }))}
      slots={(slots ?? []).map(s => ({
        id: s.id, teacher_row_id: s.teacher_row_id, weekday: s.weekday,
        period: s.period, class_name: s.class_name, domain: s.domain,
      }))}
      skips={(skips ?? []).map(s => ({ id: s.id, date: s.date, name: s.name }))}
      holidays={(holidays ?? []).map(h => ({ date: h.date, name: h.name, is_holiday: h.is_holiday }))}
    />
  )
}
