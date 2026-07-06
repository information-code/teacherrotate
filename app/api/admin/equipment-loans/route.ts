import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin, collectChecklistPhotos, signPhotoUrls } from '@/lib/equipment-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await checkAdmin(user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
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
    equipment_name: equipMap.get(l.equipment_id)?.name ?? '（已刪除設備）',
    equipment_asset_number: equipMap.get(l.equipment_id)?.asset_number ?? '',
    teacher_name: profileMap.get(l.teacher_id)?.name ?? profileMap.get(l.teacher_id)?.email ?? '（未知）',
  }))

  const photoPaths = rows.flatMap(l => [
    ...collectChecklistPhotos(l.borrow_checklist),
    ...collectChecklistPhotos(l.return_checklist),
  ])
  const photoUrls = await signPhotoUrls(photoPaths)

  return NextResponse.json({ loans: rows, photoUrls })
}

/** 管理者代為結案。body: { id } — 借用中/已預約的紀錄結案並釋出時段 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少借用紀錄 id' }, { status: 400 })

  const { data: loan } = await supabaseAdmin
    .from('equipment_loans').select('id, status').eq('id', id).maybeSingle()
  if (!loan) return NextResponse.json({ error: '找不到借用紀錄' }, { status: 404 })
  if (loan.status !== 'borrowed' && loan.status !== 'reserved') {
    return NextResponse.json({ error: '此紀錄已結束，無需結案' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('equipment_loans').update({
    status: 'closed',
    returned_at: new Date().toISOString(),
    closed_by: auth.user.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('equipment_loan_slots').delete().eq('loan_id', id)
  return NextResponse.json({ ok: true })
}
