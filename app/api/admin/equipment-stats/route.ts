import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import { overdueDays, todayStr } from '@/lib/equipment'

/**
 * 逾期統計（供政策調整參考）。
 * 統計母體：實際完成借用手續的短期借用（borrowed_at 非空）。
 * 逾期定義：借用日當天結束仍未歸還，逾期時長以天計。
 * 另附長期借用「續借逾期」（active 且 due_date 已過）。
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = todayStr()
  const [{ data: loans, error }, { data: longLoans }, { data: equipment }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_loans')
      .select('id, equipment_id, teacher_id, loan_date, end_date, periods, status, borrowed_at, returned_at')
      .not('borrowed_at', 'is', null),
    supabaseAdmin.from('equipment_long_loans').select('*').eq('status', 'active').lt('due_date', today),
    supabaseAdmin.from('equipment').select('id, name'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const equipName = (id: string) =>
    (equipment ?? []).find(e => e.id === id)?.name ?? '（已刪除設備）'
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email]))
  const teacherName = (id: string) => profileMap.get(id) ?? '（未知）'

  interface Agg { total: number; overdue: number; totalDays: number; maxDays: number }
  const byTeacher = new Map<string, Agg>()
  const byEquipment = new Map<string, Agg>()
  const byMonth = new Map<string, { loans: number; overdue: number }>()

  const bump = (map: Map<string, Agg>, key: string, days: number) => {
    const agg = map.get(key) ?? { total: 0, overdue: 0, totalDays: 0, maxDays: 0 }
    agg.total += 1
    if (days > 0) {
      agg.overdue += 1
      agg.totalDays += days
      agg.maxDays = Math.max(agg.maxDays, days)
    }
    map.set(key, agg)
  }

  for (const l of loans ?? []) {
    // 逾期基準＝借用期間的結束日（跨日借用取 end_date）；
    // 借用中以「今天」計算目前逾期天數，已結束以歸還/結案時間計
    const due = l.end_date ?? l.loan_date
    const days = l.status === 'borrowed'
      ? overdueDays(due, null, today)
      : overdueDays(due, l.returned_at, today)
    bump(byTeacher, l.teacher_id, days)
    bump(byEquipment, l.equipment_id, days)

    const month = l.loan_date.slice(0, 7)
    const m = byMonth.get(month) ?? { loans: 0, overdue: 0 }
    m.loans += 1
    if (days > 0) m.overdue += 1
    byMonth.set(month, m)
  }

  const teacherStats = Array.from(byTeacher.entries())
    .map(([id, a]) => ({
      teacher_id: id,
      name: teacherName(id),
      total: a.total,
      overdue: a.overdue,
      totalDays: a.totalDays,
      avgDays: a.overdue > 0 ? Math.round((a.totalDays / a.overdue) * 10) / 10 : 0,
      maxDays: a.maxDays,
    }))
    .filter(t => t.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue || b.totalDays - a.totalDays)

  const equipmentStats = Array.from(byEquipment.entries())
    .map(([id, a]) => ({
      equipment_id: id,
      name: equipName(id),
      total: a.total,
      overdue: a.overdue,
      rate: a.total > 0 ? Math.round((a.overdue / a.total) * 1000) / 10 : 0,
      maxDays: a.maxDays,
    }))
    .sort((a, b) => b.overdue - a.overdue || b.rate - a.rate)

  const monthly = Array.from(byMonth.entries())
    .map(([month, m]) => ({ month, ...m }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const longOverdue = (longLoans ?? []).map(l => ({
    id: l.id,
    equipment_name: equipName(l.equipment_id),
    teacher_id: l.teacher_id,
    teacher_name: l.teacher_id ? teacherName(l.teacher_id) : `${l.external_name}（系統外）`,
    due_date: l.due_date,
    overdueDays: overdueDays(l.due_date, null, today),
  })).sort((a, b) => b.overdueDays - a.overdueDays)

  return NextResponse.json({ teacherStats, equipmentStats, monthly, longOverdue })
}
