import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import { todayStr } from '@/lib/equipment'

/**
 * 設備總覽：每台設備目前的狀態。
 * 回傳 rows: { id, name, asset_number, location, status（設備狀態）,
 *   shortLoan: null | { teacher_name, loan_date, periods, overdue },
 *   longLoan:  null | { borrower_name, is_external, start_date, due_date, overdue } }
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = todayStr()
  const [{ data: equipment }, { data: shortLoans }, { data: longLoans }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment').select('id, name, asset_number, location, status')
      .order('name').order('asset_number'),
    supabaseAdmin.from('equipment_loans')
      .select('equipment_id, teacher_id, loan_date, end_date, start_period, end_period, periods')
      .eq('status', 'borrowed'),
    supabaseAdmin.from('equipment_long_loans').select('*').eq('status', 'active'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email]))
  const shortByEquipment = new Map((shortLoans ?? []).map(l => [l.equipment_id, l]))
  const longByEquipment = new Map((longLoans ?? []).map(l => [l.equipment_id, l]))

  const rows = (equipment ?? []).map(e => {
    const short = shortByEquipment.get(e.id)
    const long = longByEquipment.get(e.id)
    return {
      ...e,
      shortLoan: short ? {
        teacher_name: profileMap.get(short.teacher_id) ?? '（未知）',
        loan_date: short.loan_date,
        end_date: short.end_date,
        start_period: short.start_period,
        end_period: short.end_period,
        periods: short.periods,
        overdue: (short.end_date ?? short.loan_date) < today,
      } : null,
      longLoan: long ? {
        borrower_name: long.teacher_id
          ? (profileMap.get(long.teacher_id) ?? '（未知）')
          : long.external_name,
        is_external: !long.teacher_id,
        start_date: long.start_date,
        due_date: long.due_date,
        overdue: long.due_date < today,
      } : null,
    }
  })

  return NextResponse.json({ rows, today })
}
