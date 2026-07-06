import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig, validateChecklistResult } from '@/lib/equipment-server'
import { addDays, todayStr, type ChecklistItem } from '@/lib/equipment'

/** 預約借用。body: { equipment_id, date, periods: string[] } */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { equipment_id, date, periods } = await request.json()
  if (!equipment_id || !date || !Array.isArray(periods) || periods.length === 0) {
    return NextResponse.json({ error: '請選擇設備、日期與時段' }, { status: 400 })
  }

  const config = await loadEquipmentConfig()
  const today = todayStr()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, config.maxAdvanceDays)) {
    return NextResponse.json({ error: `借用日期須在今天起 ${config.maxAdvanceDays} 天內` }, { status: 400 })
  }

  const uniquePeriods = Array.from(new Set(periods.map(String)))
  if (uniquePeriods.some(p => !config.openPeriods.includes(p))) {
    return NextResponse.json({ error: '包含未開放借用的時段' }, { status: 400 })
  }

  const { data: equip } = await supabaseAdmin
    .from('equipment').select('id, status').eq('id', equipment_id).maybeSingle()
  if (!equip || equip.status !== 'available') {
    return NextResponse.json({ error: '此設備目前無法借用' }, { status: 400 })
  }

  // 交易式寫入：任一節次已被占用則整筆回滾（DB unique 防撞）
  const { data: loanId, error } = await supabaseAdmin.rpc('reserve_equipment_loan', {
    p_equipment_id: equipment_id,
    p_teacher_id: user.id,
    p_loan_date: date,
    p_periods: uniquePeriods,
  })

  if (error) {
    if (error.message.includes('slot_taken')) {
      return NextResponse.json({ error: '部分時段剛被其他老師借走，請重新選擇。' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
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

  if (action === 'cancel') {
    if (loan.status !== 'reserved') {
      return NextResponse.json({ error: '已完成借用手續，無法自行取消，請改辦理歸還。' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('equipment_loans')
      .update({ status: 'cancelled', updated_at: now }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await supabaseAdmin.from('equipment_loan_slots').delete().eq('loan_id', id)
    return NextResponse.json({ ok: true })
  }

  if (action !== 'borrow' && action !== 'return') {
    return NextResponse.json({ error: '不支援的操作' }, { status: 400 })
  }
  if (!agree) return NextResponse.json({ error: '請先閱讀並勾選同意書' }, { status: 400 })

  const { data: equip } = await supabaseAdmin
    .from('equipment').select('borrow_checklist, return_checklist').eq('id', loan.equipment_id).maybeSingle()
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
  return NextResponse.json({ ok: true })
}
