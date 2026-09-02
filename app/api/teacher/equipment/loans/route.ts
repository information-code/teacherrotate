import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig, logLoanEvent, reserveShortLoan, validateChecklistResult } from '@/lib/equipment-server'
import { loanTimeText, type ChecklistItem } from '@/lib/equipment'

/**
 * 預約借用（訂房式，支援跨日；單台或整組）。
 * body: { equipment_id? | group_id?, start_date, end_date, start_period, end_period }
 * 驗證、防撞與日誌在 reserveShortLoan（與管理端代訂共用）；教師自訂受可預借天數上限。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { equipment_id, group_id, start_date, end_date, start_period, end_period } = await request.json()
  const result = await reserveShortLoan({
    teacherId: user.id,
    equipmentId: equipment_id,
    groupId: group_id,
    startDate: start_date,
    endDate: end_date,
    startPeriod: start_period,
    endPeriod: end_period,
    enforceMaxAdvance: true,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, id: result.id })
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
