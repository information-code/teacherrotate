import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import { todayStr } from '@/lib/equipment'

/**
 * 設備總覽：每台設備目前的狀態。
 * 回傳 rows: { id, name, asset_number, location, status（設備狀態）,
 *   shortLoans: [{ id, status(reserved|borrowed), teacher_name, 期間欄位, overdue }],
 *   longLoan:  null | { borrower_name, is_external, start_date, due_date, overdue } }
 * 已預約未取用的可由管理者「釋出」，借用中的可「結案」。
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
      .select('id, equipment_id, teacher_id, status, loan_date, end_date, start_period, end_period, periods')
      .in('status', ['reserved', 'borrowed'])
      .order('loan_date'),
    supabaseAdmin.from('equipment_long_loans').select('*').eq('status', 'active'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email]))
  const shortByEquipment = new Map<string, NonNullable<typeof shortLoans>>()
  for (const l of shortLoans ?? []) {
    const list = shortByEquipment.get(l.equipment_id) ?? []
    list.push(l)
    shortByEquipment.set(l.equipment_id, list)
  }
  const longByEquipment = new Map((longLoans ?? []).map(l => [l.equipment_id, l]))

  const rows = (equipment ?? []).map(e => {
    const long = longByEquipment.get(e.id)
    return {
      ...e,
      shortLoans: (shortByEquipment.get(e.id) ?? []).map(l => ({
        id: l.id,
        status: l.status,
        teacher_name: profileMap.get(l.teacher_id) ?? '（未知）',
        loan_date: l.loan_date,
        end_date: l.end_date,
        start_period: l.start_period,
        end_period: l.end_period,
        periods: l.periods,
        overdue: l.status === 'borrowed' && (l.end_date ?? l.loan_date) < today,
      })),
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
