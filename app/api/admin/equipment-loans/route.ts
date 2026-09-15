import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { collectChecklistPhotos, logLoanEvent, markNoShowOnRelease, reserveShortLoan, signPhotoUrls } from '@/lib/equipment-server'
import { loanTimeText } from '@/lib/equipment'
import { hasPerms } from '@/lib/staff-server'

// 每週重複批次建立需要較長執行時間
export const maxDuration = 60

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['equipment']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/**
 * 短期借用列表（管理端）。
 * query: equipment_id? / from? / to?（loan_date 範圍）/ status?
 * 回傳 { loans（含老師與設備名稱）, photoUrls: {path: 簽名網址} }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const params = request.nextUrl.searchParams
  let query = supabaseAdmin.from('equipment_loans').select('*')
    .order('loan_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)

  const equipmentId = params.get('equipment_id')
  const equipmentIds = params.get('equipment_ids') // 逗號分隔，用於同名設備一次查全部
  const from = params.get('from')
  const to = params.get('to')
  const status = params.get('status')
  if (equipmentId) query = query.eq('equipment_id', equipmentId)
  if (equipmentIds) query = query.in('equipment_id', equipmentIds.split(',').filter(Boolean))
  if (from) query = query.gte('loan_date', from)
  if (to) query = query.lte('loan_date', to)
  if (status) query = query.eq('status', status)

  const { data: loans, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const [{ data: equipment }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment').select('id, name, location, asset_number'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  const equipMap = new Map((equipment ?? []).map(e => [e.id, e]))
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const rows = (loans ?? []).map(l => ({
    ...l,
    equipment_name: equipMap.get(l.equipment_id ?? '')?.name ?? '（已刪除設備）',
    equipment_asset_number: equipMap.get(l.equipment_id ?? '')?.asset_number ?? '',
    teacher_name: profileMap.get(l.teacher_id)?.name ?? profileMap.get(l.teacher_id)?.email ?? '（未知）',
  }))

  const photoPaths = rows.flatMap(l => [
    ...collectChecklistPhotos(l.borrow_checklist),
    ...collectChecklistPhotos(l.return_checklist),
  ])
  const photoUrls = await signPhotoUrls(photoPaths)

  return NextResponse.json({ loans: rows, photoUrls })
}

/**
 * 管理者操作。body: { id, action?: 'close' | 'release' }
 * - release：已預約但未取用 → 取消預約並釋出時段
 * - close（預設）：借用中 → 代為結案並釋出時段
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, action = 'close' } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少借用紀錄 id' }, { status: 400 })

  const { data: loan } = await supabaseAdmin
    .from('equipment_loans').select('*').eq('id', id).maybeSingle()
  if (!loan) return NextResponse.json({ error: '找不到借用紀錄' }, { status: 404 })

  const now = new Date().toISOString()

  if (action === 'release') {
    if (loan.status !== 'reserved') {
      return NextResponse.json({ error: '只有「已預約」的紀錄可以釋出' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('equipment_loans').update({
      status: 'cancelled',
      closed_by: auth.user.id,
      updated_at: now,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await supabaseAdmin.from('equipment_loan_slots').delete().eq('loan_id', id)
    // 釋出「已到期」的預約＝預約未借，計次（未到期的提前釋出不算）
    await markNoShowOnRelease(loan)
    await logLoanEvent({
      loanId: id, equipmentId: loan.equipment_id, groupId: loan.group_id, teacherId: loan.teacher_id,
      action: 'released', detail: loanTimeText(loan), actorId: auth.user.id,
    })
    return NextResponse.json({ ok: true })
  }

  if (loan.status !== 'borrowed') {
    return NextResponse.json({ error: '只有「借用中」的紀錄可以結案' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('equipment_loans').update({
    status: 'closed',
    returned_at: now,
    closed_by: auth.user.id,
    updated_at: now,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('equipment_loan_slots').delete().eq('loan_id', id)
  await logLoanEvent({
    loanId: id, equipmentId: loan.equipment_id, groupId: loan.group_id, teacherId: loan.teacher_id,
    action: 'closed', detail: loanTimeText(loan), actorId: auth.user.id,
  })
  return NextResponse.json({ ok: true })
}

/**
 * 建立短期借用（管理者代老師安排；支援每週重複＝多場次批次建立）。
 * body: { equipment_id? | group_id?, teacher_id, start_period, end_period, quantity?,
 *         start_date?, end_date?,                    // 單場
 *         occurrences?: [{ start_date, end_date }] } // 多場（每週重複），同一 series_id 串起
 * 每一場都是普通借用，逐場驗證與防撞；部分失敗回報 failed 清單。
 * 建立後為「已預約」，老師照常完成借用/歸還手續；不受教師端「可預借天數」上限。
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const { equipment_id, group_id, teacher_id, quantity, start_period, end_period } = body ?? {}
  if (!teacher_id) return NextResponse.json({ error: '請選擇借用老師' }, { status: 400 })
  const { data: teacher } = await supabaseAdmin
    .from('profiles').select('id').eq('id', teacher_id).maybeSingle()
  if (!teacher) return NextResponse.json({ error: '找不到這位老師' }, { status: 404 })

  const occurrences: { start_date: string; end_date: string }[] =
    Array.isArray(body?.occurrences) && body.occurrences.length > 0
      ? body.occurrences.slice(0, 30)
      : [{ start_date: body?.start_date, end_date: body?.end_date }]
  const seriesId = occurrences.length > 1 ? crypto.randomUUID() : undefined

  // 各場日期互不重疊，可並行建立（逐場序列 18 場要百餘次 DB 來回，會拖到數十秒）
  const results = await Promise.all(occurrences.map(occ =>
    reserveShortLoan({
      teacherId: teacher_id,
      equipmentId: equipment_id,
      groupId: group_id,
      quantity: typeof quantity === 'number' ? quantity : undefined,
      startDate: occ.start_date,
      endDate: occ.end_date,
      startPeriod: start_period,
      endPeriod: end_period,
      actorId: auth.user.id,
      seriesId,
      enforceMaxAdvance: false,
    })
  ))
  let created = 0
  const failed: { start_date: string; error: string }[] = []
  results.forEach((result, i) => {
    if (result.ok) created++
    else failed.push({ start_date: occurrences[i].start_date, error: result.error })
  })
  if (created === 0) {
    return NextResponse.json({ error: failed[0]?.error ?? '建立失敗', failed }, { status: 409 })
  }
  return NextResponse.json({ ok: true, created, failed, series_id: seriesId ?? null })
}
