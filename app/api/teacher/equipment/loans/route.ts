import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig, logLoanEvent, validateChecklistResult } from '@/lib/equipment-server'
import { addDays, dateRangeList, daySlotPeriods, loanTimeText, todayStr, type ChecklistItem } from '@/lib/equipment'

/**
 * 預約借用（訂房式，支援跨日；單台或整組）。
 * body: { equipment_id? | group_id?, start_date, end_date, start_period, end_period }
 * 首日從開始時段起、末日到結束時段止、中間日整天保留。
 * 整組借用會占用群組內全部設備的時段格，與單台借用天然互斥。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { equipment_id, group_id, start_date, end_date, start_period, end_period } = await request.json()
  if ((!equipment_id && !group_id) || !start_date || !end_date || !start_period || !end_period) {
    return NextResponse.json({ error: '請選擇設備、起訖日期與時段' }, { status: 400 })
  }

  const config = await loadEquipmentConfig()
  const today = todayStr()
  const maxDate = addDays(today, config.maxAdvanceDays)
  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && d <= maxDate
  if (!dateOk(start_date) || !dateOk(end_date)) {
    return NextResponse.json({ error: `借用日期須在今天起 ${config.maxAdvanceDays} 天內` }, { status: 400 })
  }
  if (end_date < start_date) {
    return NextResponse.json({ error: '結束日期不可早於開始日期' }, { status: 400 })
  }
  if (!config.openPeriods.includes(start_period) || !config.openPeriods.includes(end_period)) {
    return NextResponse.json({ error: '包含未開放借用的時段' }, { status: 400 })
  }

  // 每一天實際占用的節次；同日借用須開始不晚於結束
  const slots = dateRangeList(start_date, end_date).map(date => ({
    date,
    periods: daySlotPeriods(config.openPeriods, date, start_date, end_date, start_period, end_period),
  }))
  if (slots.some(s => s.periods.length === 0)) {
    return NextResponse.json({ error: '時段範圍無效，結束時段不可早於開始時段' }, { status: 400 })
  }

  if (group_id) {
    // ---- 整組借用 ----
    const { data: group } = await supabaseAdmin
      .from('equipment_groups').select('id, status').eq('id', group_id).maybeSingle()
    if (!group || group.status !== 'available') {
      return NextResponse.json({ error: '此群組目前無法整組借用' }, { status: 400 })
    }
    const { data: members } = await supabaseAdmin
      .from('equipment').select('id, status').eq('group_id', group_id)
    if (!members || members.length === 0) {
      return NextResponse.json({ error: '此群組沒有成員設備' }, { status: 400 })
    }
    if (members.some(m => m.status !== 'available')) {
      return NextResponse.json({ error: '群組內有設備維修中或停用，暫不開放整組借用。' }, { status: 400 })
    }
    // 整組或任一成員被長期借用 → 不可整組借
    const memberIds = members.map(m => m.id)
    const [{ data: groupLong }, { data: memberLong }] = await Promise.all([
      supabaseAdmin.from('equipment_long_loans').select('id')
        .eq('group_id', group_id).eq('status', 'active').lte('start_date', end_date).limit(1),
      supabaseAdmin.from('equipment_long_loans').select('id')
        .in('equipment_id', memberIds).eq('status', 'active').lte('start_date', end_date).limit(1),
    ])
    if ((groupLong?.length ?? 0) > 0 || (memberLong?.length ?? 0) > 0) {
      return NextResponse.json({ error: '此群組或其中設備為長期借用中，無法整組借用。' }, { status: 400 })
    }

    const { data: loanId, error } = await supabaseAdmin.rpc('reserve_equipment_group_loan', {
      p_group_id: group_id,
      p_teacher_id: user.id,
      p_start_date: start_date,
      p_end_date: end_date,
      p_start_period: start_period,
      p_end_period: end_period,
      p_slots: slots as never,
    })
    if (error) {
      if (error.message.includes('slot_taken')) {
        return NextResponse.json({ error: '群組內部分設備該時段已被借走，整組不可借，請換其他時段。' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await logLoanEvent({
      loanId: String(loanId),
      groupId: group_id,
      teacherId: user.id,
      action: 'reserved',
      detail: loanTimeText({
        loan_date: start_date, end_date, periods: slots[0].periods, start_period, end_period,
      }),
    })
    return NextResponse.json({ ok: true, id: loanId })
  }

  // ---- 單台借用 ----
  const { data: equip } = await supabaseAdmin
    .from('equipment').select('id, status, group_id').eq('id', equipment_id).maybeSingle()
  if (!equip || equip.status !== 'available') {
    return NextResponse.json({ error: '此設備目前無法借用' }, { status: 400 })
  }

  // 長期借用中（單台，或所屬群組整組被長借）的設備不可短期借用
  const { data: longLoan } = await supabaseAdmin
    .from('equipment_long_loans').select('id, start_date')
    .eq('equipment_id', equipment_id).eq('status', 'active')
    .lte('start_date', end_date)
    .limit(1).maybeSingle()
  if (longLoan) {
    return NextResponse.json({ error: '此設備目前為長期借用中，無法短期借用。' }, { status: 400 })
  }
  if (equip.group_id) {
    const { data: groupLong } = await supabaseAdmin
      .from('equipment_long_loans').select('id')
      .eq('group_id', equip.group_id).eq('status', 'active').lte('start_date', end_date)
      .limit(1).maybeSingle()
    if (groupLong) {
      return NextResponse.json({ error: '此設備所屬群組為長期借用中，無法短期借用。' }, { status: 400 })
    }
  }

  // 交易式寫入：期間內任一格已被占用則整筆回滾（DB unique 防撞）
  const { data: loanId, error } = await supabaseAdmin.rpc('reserve_equipment_loan_range', {
    p_equipment_id: equipment_id,
    p_teacher_id: user.id,
    p_start_date: start_date,
    p_end_date: end_date,
    p_start_period: start_period,
    p_end_period: end_period,
    p_slots: slots as never,
  })

  if (error) {
    if (error.message.includes('slot_taken')) {
      return NextResponse.json({ error: '部分時段剛被其他老師借走，請重新選擇。' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logLoanEvent({
    loanId: String(loanId),
    equipmentId: equipment_id,
    teacherId: user.id,
    action: 'reserved',
    detail: loanTimeText({
      loan_date: start_date, end_date, periods: slots[0].periods, start_period, end_period,
    }),
  })
  return NextResponse.json({ ok: true, id: loanId })
}

/**
 * 借用紀錄操作。body: { id, action: 'cancel' | 'borrow' | 'return', checklist?, agree? }
 * - cancel：僅「已預約」可自行取消（完成借用手續後不得取消）
 * - borrow：完成借用手續（同意書＋檢查拍照）→ 借用中
 * - return：完成歸還手續 → 已歸還，釋出時段
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, action, checklist, agree } = await request.json()
  if (!id || !action) return NextResponse.json({ error: '缺少參數' }, { status: 400 })

  const { data: loan } = await supabaseAdmin
    .from('equipment_loans').select('*').eq('id', id).maybeSingle()
  if (!loan || loan.teacher_id !== user.id) {
    return NextResponse.json({ error: '找不到借用紀錄' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const timeText = loanTimeText(loan)

  if (action === 'cancel') {
    if (loan.status !== 'reserved') {
      return NextResponse.json({ error: '已完成借用手續，無法自行取消，請改辦理歸還。' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('equipment_loans')
      .update({ status: 'cancelled', updated_at: now }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await supabaseAdmin.from('equipment_loan_slots').delete().eq('loan_id', id)
    await logLoanEvent({ loanId: id, equipmentId: loan.equipment_id, groupId: loan.group_id, teacherId: user.id, action: 'cancelled', detail: timeText })
    return NextResponse.json({ ok: true })
  }

  if (action !== 'borrow' && action !== 'return') {
    return NextResponse.json({ error: '不支援的操作' }, { status: 400 })
  }
  if (!agree) return NextResponse.json({ error: '請先閱讀並勾選同意書' }, { status: 400 })

  // 檢查清單來源：整組借用用群組的清單，單台用設備自己的
  const { data: equip } = loan.group_id
    ? await supabaseAdmin
        .from('equipment_groups').select('borrow_checklist, return_checklist').eq('id', loan.group_id).maybeSingle()
    : await supabaseAdmin
        .from('equipment').select('borrow_checklist, return_checklist').eq('id', loan.equipment_id ?? '').maybeSingle()
  if (!equip) return NextResponse.json({ error: '找不到設備資料' }, { status: 404 })

  const config = await loadEquipmentConfig()

  if (action === 'borrow') {
    if (loan.status !== 'reserved') return NextResponse.json({ error: '此紀錄不在可借用狀態' }, { status: 400 })
    const check = validateChecklistResult(
      (equip.borrow_checklist ?? []) as unknown as ChecklistItem[], checklist, config.maxPhotos)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

    const { error } = await supabaseAdmin.from('equipment_loans').update({
      status: 'borrowed',
      borrow_agreed_at: now,
      borrow_checklist: check.result as never,
      borrowed_at: now,
      updated_at: now,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await logLoanEvent({ loanId: id, equipmentId: loan.equipment_id, groupId: loan.group_id, teacherId: user.id, action: 'borrowed', detail: timeText })
    return NextResponse.json({ ok: true })
  }

  // return
  if (loan.status !== 'borrowed') return NextResponse.json({ error: '此紀錄不在借用中狀態' }, { status: 400 })
  const check = validateChecklistResult(
    (equip.return_checklist ?? []) as unknown as ChecklistItem[], checklist, config.maxPhotos)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const { error } = await supabaseAdmin.from('equipment_loans').update({
    status: 'returned',
    return_agreed_at: now,
    return_checklist: check.result as never,
    returned_at: now,
    updated_at: now,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('equipment_loan_slots').delete().eq('loan_id', id)
  await logLoanEvent({ loanId: id, equipmentId: loan.equipment_id, groupId: loan.group_id, teacherId: user.id, action: 'returned', detail: timeText })
  return NextResponse.json({ ok: true })
}
