import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin, signPhotoUrls } from '@/lib/equipment-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await checkAdmin(user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 長期借用列表（含續借紀錄、老師與設備名稱、續借照片簽名網址） */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [{ data: loans, error }, { data: renewals }, { data: equipment }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_long_loans').select('*')
      .order('status').order('due_date'),
    supabaseAdmin.from('equipment_renewals').select('*').order('agreed_at', { ascending: false }),
    supabaseAdmin.from('equipment').select('id, name, location'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const equipMap = new Map((equipment ?? []).map(e => [e.id, e]))
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))
  const renewalsByLoan = new Map<string, typeof renewals>()
  for (const r of renewals ?? []) {
    const list = renewalsByLoan.get(r.long_loan_id) ?? []
    list.push(r)
    renewalsByLoan.set(r.long_loan_id, list)
  }

  const rows = (loans ?? []).map(l => ({
    ...l,
    equipment_name: equipMap.get(l.equipment_id)?.name ?? '（已刪除設備）',
    teacher_name: l.teacher_id
      ? (profileMap.get(l.teacher_id)?.name ?? profileMap.get(l.teacher_id)?.email ?? '（未知）')
      : l.external_name,
    is_external: !l.teacher_id,
    renewals: renewalsByLoan.get(l.id) ?? [],
  }))

  const photoPaths = (renewals ?? []).flatMap(r => (Array.isArray(r.photos) ? (r.photos as string[]) : []))
  const photoUrls = await signPhotoUrls(photoPaths)

  return NextResponse.json({ loans: rows, photoUrls })
}

/**
 * 建立長期借用。body: { equipment_id, teacher_id? , external_name?, start_date, due_date, notes? }
 * teacher_id＝系統帳號；external_name＝系統外人員（沒有帳號、不登入系統），兩者擇一。
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const { equipment_id, teacher_id, start_date, due_date } = body ?? {}
  const externalName = String(body?.external_name ?? '').trim()
  if (!equipment_id || !start_date || !due_date) {
    return NextResponse.json({ error: '請完整填寫設備與起訖日期' }, { status: 400 })
  }
  if (!teacher_id && !externalName) {
    return NextResponse.json({ error: '請選擇老師，或填寫系統外人員姓名' }, { status: 400 })
  }
  if (due_date < start_date) return NextResponse.json({ error: '到期日不可早於起始日' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('equipment_long_loans').insert({
    equipment_id,
    teacher_id: teacher_id || null,
    external_name: teacher_id ? '' : externalName,
    start_date, due_date,
    notes: String(body.notes ?? ''),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新長期借用。body: { id, action: 'end' } 或 { id, due_date?, notes? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, action, due_date, notes } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少紀錄 id' }, { status: 400 })

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (action === 'end') payload.status = 'ended'
  if (due_date !== undefined) payload.due_date = due_date
  if (notes !== undefined) payload.notes = String(notes)

  const { error } = await supabaseAdmin.from('equipment_long_loans').update(payload).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
