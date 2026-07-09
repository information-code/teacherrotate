import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { todayStr } from '@/lib/equipment'
import { hasPerms } from '@/lib/staff-server'

/**
 * 設備總覽：每台設備目前的狀態（含整組借用展開到各成員）。
 * 回傳 rows: { id, name, asset_number, location, status（設備狀態）,
 *   shortLoans: [{ id, status, teacher_name, 期間欄位, overdue, is_group, group_name? }],
 *   longLoan:  null | { borrower_name, is_external, start_date, due_date, overdue, is_group, group_name? } }
 * 已預約未取用的可由管理者「釋出」，借用中的可「結案」（整組操作一次即釋放全部成員）。
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['equipment']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const today = todayStr()
  const [{ data: equipment }, { data: groups }, { data: shortLoans }, { data: longLoans }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment').select('id, name, asset_number, location, status, group_id')
      .order('name').order('asset_number'),
    supabaseAdmin.from('equipment_groups').select('id, name'),
    supabaseAdmin.from('equipment_loans')
      .select('id, equipment_id, group_id, teacher_id, status, loan_date, end_date, start_period, end_period, periods')
      .in('status', ['reserved', 'borrowed'])
      .order('loan_date'),
    supabaseAdmin.from('equipment_long_loans').select('*').eq('status', 'active'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email]))
  const groupName = new Map((groups ?? []).map(g => [g.id, g.name]))

  type ShortLoan = NonNullable<typeof shortLoans>[number]
  const shortByEquipment = new Map<string, ShortLoan[]>()
  const shortByGroup = new Map<string, ShortLoan[]>()
  for (const l of shortLoans ?? []) {
    if (l.equipment_id) {
      const list = shortByEquipment.get(l.equipment_id) ?? []
      list.push(l)
      shortByEquipment.set(l.equipment_id, list)
    } else if (l.group_id) {
      const list = shortByGroup.get(l.group_id) ?? []
      list.push(l)
      shortByGroup.set(l.group_id, list)
    }
  }
  const longByEquipment = new Map((longLoans ?? []).filter(l => l.equipment_id).map(l => [l.equipment_id as string, l]))
  const longByGroup = new Map((longLoans ?? []).filter(l => l.group_id).map(l => [l.group_id as string, l]))

  const shortEntry = (l: ShortLoan, isGroup: boolean) => ({
    id: l.id,
    status: l.status,
    teacher_name: profileMap.get(l.teacher_id) ?? '（未知）',
    loan_date: l.loan_date,
    end_date: l.end_date,
    start_period: l.start_period,
    end_period: l.end_period,
    periods: l.periods,
    overdue: l.status === 'borrowed' && (l.end_date ?? l.loan_date) < today,
    is_group: isGroup,
    group_name: isGroup && l.group_id ? groupName.get(l.group_id) ?? '' : '',
  })

  const rows = (equipment ?? []).map(e => {
    const unitLong = longByEquipment.get(e.id)
    const groupLong = e.group_id ? longByGroup.get(e.group_id) : undefined
    const long = unitLong ?? groupLong
    return {
      ...e,
      shortLoans: [
        ...(shortByEquipment.get(e.id) ?? []).map(l => shortEntry(l, false)),
        ...(e.group_id ? (shortByGroup.get(e.group_id) ?? []).map(l => shortEntry(l, true)) : []),
      ],
      longLoan: long ? {
        borrower_name: long.teacher_id
          ? (profileMap.get(long.teacher_id) ?? '（未知）')
          : long.external_name,
        is_external: !long.teacher_id,
        start_date: long.start_date,
        due_date: long.due_date,
        overdue: long.due_date < today,
        is_group: !unitLong,
        group_name: !unitLong && e.group_id ? groupName.get(e.group_id) ?? '' : '',
      } : null,
    }
  })

  return NextResponse.json({ rows, today })
}
