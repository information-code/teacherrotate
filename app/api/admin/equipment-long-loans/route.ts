import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { signPhotoUrls } from '@/lib/equipment-server'
import { hasPerms } from '@/lib/staff-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['equipment']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 長期借用列表（含續借紀錄、老師與設備名稱、續借照片簽名網址） */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [{ data: loans, error }, { data: renewals }, { data: equipment }, { data: groups }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_long_loans').select('*')
      .order('status').order('due_date'),
    supabaseAdmin.from('equipment_renewals').select('*').order('agreed_at', { ascending: false }),
    supabaseAdmin.from('equipment').select('id, name, location, asset_number'),
    supabaseAdmin.from('equipment_groups').select('id, name'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const equipMap = new Map((equipment ?? []).map(e => [e.id, e]))
  const groupMap = new Map((groups ?? []).map(g => [g.id, g]))
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))
  const renewalsByLoan = new Map<string, typeof renewals>()
  for (const r of renewals ?? []) {
    const list = renewalsByLoan.get(r.long_loan_id) ?? []
    list.push(r)
    renewalsByLoan.set(r.long_loan_id, list)
  }

  const rows = (loans ?? []).map(l => ({
    ...l,
    equipment_name: l.group_id
      ? `${groupMap.get(l.group_id)?.name ?? '（已刪除群組）'}（整組）`
      : equipMap.get(l.equipment_id ?? '')?.name ?? '（已刪除設備）',
    equipment_asset_number: l.equipment_id ? (equipMap.get(l.equipment_id)?.asset_number ?? '') : '',
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
 * 建立長期借用（單台或整組）。
 * body: { equipment_id? | group_id?, teacher_id?, external_name?, start_date, due_date, notes? }
 * teacher_id＝系統帳號；external_name＝系統外人員（沒有帳號、不登入系統），兩者擇一。
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const { equipment_id, group_id, teacher_id, start_date, due_date } = body ?? {}
  const externalName = String(body?.external_name ?? '').trim()
  if ((!equipment_id && !group_id) || !start_date || !due_date) {
    return NextResponse.json({ error: '請完整填寫設備與起訖日期' }, { status: 400 })
  }
  if (!teacher_id && !externalName) {
    return NextResponse.json({ error: '請選擇老師，或填寫系統外人員姓名' }, { status: 400 })
  }
  if (due_date < start_date) return NextResponse.json({ error: '到期日不可早於起始日' }, { status: 400 })

  // 需檢查短借占用的設備範圍：單台＝自己；整組＝全部成員
  let slotEquipmentIds: string[]
  if (group_id) {
    // 整組：群組不可已有使用中長借；任一成員不可有單台長借
    const { data: members } = await supabaseAdmin
      .from('equipment').select('id').eq('group_id', group_id)
    if (!members || members.length === 0) {
      return NextResponse.json({ error: '此群組沒有成員設備' }, { status: 400 })
    }
    slotEquipmentIds = members.map(m => m.id)

    const [{ data: groupExisting }, { data: memberExisting }] = await Promise.all([
      supabaseAdmin.from('equipment_long_loans').select('id')
        .eq('group_id', group_id).eq('status', 'active').limit(1),
      supabaseAdmin.from('equipment_long_loans').select('id')
        .in('equipment_id', slotEquipmentIds).eq('status', 'active').limit(1),
    ])
    if ((groupExisting?.length ?? 0) > 0) {
      return NextResponse.json({ error: '這個群組已有使用中的整組長期借用，請先結束原借用。' }, { status: 400 })
    }
    if ((memberExisting?.length ?? 0) > 0) {
      return NextResponse.json({ error: '群組內有設備正被單台長期借用，請先結束該借用。' }, { status: 400 })
    }
  } else {
    slotEquipmentIds = [equipment_id]
    // 同一台設備同時只能有一筆使用中的長期借用；所屬群組整組被長借也不可
    const { data: equip } = await supabaseAdmin
      .from('equipment').select('id, group_id').eq('id', equipment_id).maybeSingle()
    if (!equip) return NextResponse.json({ error: '找不到設備' }, { status: 404 })

    const [{ data: existing }, { data: groupExisting }] = await Promise.all([
      supabaseAdmin.from('equipment_long_loans').select('id')
        .eq('equipment_id', equipment_id).eq('status', 'active').limit(1),
      equip.group_id
        ? supabaseAdmin.from('equipment_long_loans').select('id')
            .eq('group_id', equip.group_id).eq('status', 'active').limit(1)
        : Promise.resolve({ data: [] as { id: string }[] }),
    ])
    if ((existing?.length ?? 0) > 0) {
      return NextResponse.json({ error: '這台設備已有使用中的長期借用，請先結束原借用。' }, { status: 400 })
    }
    if ((groupExisting?.length ?? 0) > 0) {
      return NextResponse.json({ error: '這台設備所屬群組正被整組長期借用，請先結束該借用。' }, { status: 400 })
    }
  }

  // 期間內已有短期借用（預約中/借用中的占用格）→ 不可建立長期借用
  const { data: conflicts } = await supabaseAdmin
    .from('equipment_loan_slots')
    .select('loan_date')
    .in('equipment_id', slotEquipmentIds)
    .gte('loan_date', start_date)
    .lte('loan_date', due_date)
    .order('loan_date')
    .limit(1)
  if (conflicts && conflicts.length > 0) {
    return NextResponse.json(
      { error: `長期借用期間內已有短期借用（${conflicts[0].loan_date}），請先取消/結案該短期借用，或調整長期借用日期。` },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin.from('equipment_long_loans').insert({
    equipment_id: group_id ? null : equipment_id,
    group_id: group_id || null,
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
