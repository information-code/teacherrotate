import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { addDays, loanDueDate, todayStr } from '@/lib/equipment'
import { hasPerms } from '@/lib/staff-server'

/**
 * 設備儀表板：指定日期（預設今天）的短期借用動態。
 * - notPickedUp：預約日已到/已過但仍是「已預約」（老師拿了沒按借用、或根本沒來拿）
 * - notReturned：借用中且到期日已到/已過（今天到期或已逾期）
 * - reservedOn / borrowedOn / returnedOn：當天有預約占用 / 當天按了借用 / 當天按了歸還
 * 未取用與未歸還都附老師與設備資訊，前端套通知模板複製到 LINE。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['equipment']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = todayStr()
  const q = request.nextUrl.searchParams.get('date') ?? ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : today
  // 以台灣時間切當天（Vercel 伺服器是 UTC）
  const dayStart = `${date}T00:00:00+08:00`
  const dayEnd = `${addDays(date, 1)}T00:00:00+08:00`
  const select = 'id, equipment_id, group_id, teacher_id, status, loan_date, end_date, start_period, end_period, periods, borrowed_at, returned_at'

  const [{ data: active, error: e1 }, { data: borrowedOn, error: e2 }, { data: returnedOn, error: e3 }, { data: around, error: e4 },
    { data: equipment }, { data: groups }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_loans').select(select).in('status', ['reserved', 'borrowed']),
    supabaseAdmin.from('equipment_loans').select(select).gte('borrowed_at', dayStart).lt('borrowed_at', dayEnd).neq('status', 'cancelled'),
    supabaseAdmin.from('equipment_loans').select(select).gte('returned_at', dayStart).lt('returned_at', dayEnd),
    // 當天有占用的預約：借用日在 62 天內且 ≤ 當天，再用到期日在 JS 過濾（跨日借用最長 62 天）
    supabaseAdmin.from('equipment_loans').select(select).gte('loan_date', addDays(date, -62)).lte('loan_date', date).neq('status', 'cancelled'),
    supabaseAdmin.from('equipment').select('id, name, asset_number'),
    supabaseAdmin.from('equipment_groups').select('id, name'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  const err = e1 ?? e2 ?? e3 ?? e4
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email]))
  const equipMap = new Map((equipment ?? []).map(e => [e.id, e]))
  const groupMap = new Map((groups ?? []).map(g => [g.id, g.name]))

  type Loan = NonNullable<typeof active>[number]
  const enrich = (l: Loan) => {
    const e = l.equipment_id ? equipMap.get(l.equipment_id) : null
    const label = e
      ? `${e.name}${e.asset_number ? ` ${e.asset_number}` : ''}`
      : `${(l.group_id && groupMap.get(l.group_id)) || '群組'}（整組）`
    return {
      id: l.id,
      status: l.status,
      teacher_name: profileMap.get(l.teacher_id) ?? '（未知）',
      equipment_label: label,
      loan_date: l.loan_date,
      end_date: l.end_date,
      start_period: l.start_period,
      end_period: l.end_period,
      periods: l.periods,
      borrowed_at: l.borrowed_at,
      returned_at: l.returned_at,
    }
  }
  const byDate = (a: Loan, b: Loan) => a.loan_date.localeCompare(b.loan_date)

  const notPickedUp = (active ?? []).filter(l => l.status === 'reserved' && l.loan_date <= date).sort(byDate).map(enrich)
  const notReturned = (active ?? []).filter(l => l.status === 'borrowed' && loanDueDate(l) <= date).sort(byDate).map(enrich)
  const reservedOn = (around ?? []).filter(l => loanDueDate(l) >= date).sort(byDate).map(enrich)

  return NextResponse.json({
    date,
    today,
    notPickedUp,
    notReturned,
    reservedOn,
    borrowedOn: (borrowedOn ?? []).map(enrich),
    returnedOn: (returnedOn ?? []).map(enrich),
  })
}
