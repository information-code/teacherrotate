import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig } from '@/lib/equipment-server'
import { addDays, todayStr } from '@/lib/equipment'

/**
 * 教師端短期借用總覽。
 * query: from? / to?（借用起訖日，預設今天）
 * 回傳 { config, from, to, equipment（僅可借用狀態）, groups（可整組借用）,
 *        occupied: {日期: {設備id: 節次[]}}, myLoans }
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = await loadEquipmentConfig()
  const today = todayStr()
  const maxDate = addDays(today, config.maxAdvanceDays)

  const clamp = (raw: string | null): string => {
    let d = raw ?? today
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = today
    if (d < today) d = today
    if (d > maxDate) d = maxDate
    return d
  }
  const from = clamp(request.nextUrl.searchParams.get('from'))
  let to = clamp(request.nextUrl.searchParams.get('to'))
  if (to < from) to = from

  const [{ data: allEquipment }, { data: allGroups }, { data: slots }, { data: longLoans }, { data: myLoans }] = await Promise.all([
    supabaseAdmin.from('equipment').select('*')
      .eq('status', 'available').order('name').order('asset_number'),
    supabaseAdmin.from('equipment_groups').select('*').eq('status', 'available').order('name'),
    supabaseAdmin.from('equipment_loan_slots').select('equipment_id, loan_date, period')
      .gte('loan_date', from).lte('loan_date', to),
    supabaseAdmin.from('equipment_long_loans').select('equipment_id, group_id, start_date')
      .eq('status', 'active'),
    supabaseAdmin.from('equipment_loans').select('*')
      .eq('teacher_id', user.id)
      .in('status', ['reserved', 'borrowed', 'returned', 'closed'])
      .order('loan_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  // 長期借用（單台或整組）中的設備不開放短期借用
  const longLoanedGroupIds = new Set(
    (longLoans ?? []).filter(l => l.group_id && l.start_date <= to).map(l => l.group_id as string)
  )
  const longLoanedIds = new Set(
    (longLoans ?? []).filter(l => l.equipment_id && l.start_date <= to).map(l => l.equipment_id as string)
  )
  const equipment = (allEquipment ?? []).filter(e =>
    !longLoanedIds.has(e.id) && !(e.group_id && longLoanedGroupIds.has(e.group_id))
  )

  // 可整組借用的群組（排除整組被長借的；成員取「目前可短借」的設備）
  const membersByGroup = new Map<string, string[]>()
  for (const e of equipment) {
    if (!e.group_id) continue
    const list = membersByGroup.get(e.group_id) ?? []
    list.push(e.id)
    membersByGroup.set(e.group_id, list)
  }
  const groups = (allGroups ?? [])
    .filter(g => !longLoanedGroupIds.has(g.id) && (membersByGroup.get(g.id)?.length ?? 0) > 0)
    .map(g => ({
      id: g.id,
      name: g.name,
      borrow_checklist: g.borrow_checklist,
      return_checklist: g.return_checklist,
      member_ids: membersByGroup.get(g.id) ?? [],
    }))

  // 占用格：日期 → 設備 → 節次
  const occupied: Record<string, Record<string, string[]>> = {}
  for (const s of slots ?? []) {
    const day = (occupied[s.loan_date] ??= {})
    ;(day[s.equipment_id] ??= []).push(s.period)
  }

  const equipMap = new Map((allEquipment ?? []).map(e => [e.id, e.name]))
  const groupMap = new Map((allGroups ?? []).map(g => [g.id, g.name]))
  // 歷史紀錄的設備/群組可能已停用或刪除，補查名稱
  const missingIds = Array.from(new Set(
    (myLoans ?? []).map(l => l.equipment_id).filter((id): id is string => Boolean(id) && !equipMap.has(id as string))
  ))
  if (missingIds.length > 0) {
    const { data: extra } = await supabaseAdmin.from('equipment').select('id, name').in('id', missingIds)
    for (const e of extra ?? []) equipMap.set(e.id, e.name)
  }
  const missingGroupIds = Array.from(new Set(
    (myLoans ?? []).map(l => l.group_id).filter((id): id is string => Boolean(id) && !groupMap.has(id as string))
  ))
  if (missingGroupIds.length > 0) {
    const { data: extra } = await supabaseAdmin.from('equipment_groups').select('id, name').in('id', missingGroupIds)
    for (const g of extra ?? []) groupMap.set(g.id, g.name)
  }

  return NextResponse.json({
    config: { ...config, today, maxDate },
    from,
    to,
    equipment,
    groups,
    occupied,
    myLoans: (myLoans ?? []).map(l => ({
      ...l,
      equipment_name: l.group_id
        ? `${groupMap.get(l.group_id) ?? '（已刪除群組）'}（整組）`
        : equipMap.get(l.equipment_id ?? '') ?? '（已刪除設備）',
    })),
  })
}
