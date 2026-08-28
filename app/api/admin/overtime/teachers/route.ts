import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import { OT_CATEGORIES, normalizeRanges } from '@/lib/overtime'

const parseFee = (v: unknown) => {
  const cleaned = String(v ?? 0)
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '')
  const n = Math.round(Number(cleaned || 0))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * 新增清冊教師。body: { plan_id, teacher_id?, name }
 * 身分不由前端指定：系統帳號依帳號資料的聘任別（formal／substitute）、
 * 手動輸入＝鐘點人員（hourly）。
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const plan_id = String(body?.plan_id ?? '')
  const teacher_id = body?.teacher_id ? String(body.teacher_id) : null
  const name = String(body?.name ?? '').trim()
  if (!plan_id) return NextResponse.json({ error: '缺少計畫' }, { status: 400 })
  if (!name) return NextResponse.json({ error: '請填寫教師姓名' }, { status: 400 })

  let category = 'hourly'
  if (teacher_id) {
    const { data: profile } = await supabaseAdmin.from('profiles')
      .select('employment_type').eq('id', teacher_id).single()
    if (!profile) return NextResponse.json({ error: '找不到教師帳號' }, { status: 404 })
    // 聘任別直接沿用（formal／substitute／hourly／foreign），未知值視為正式
    category = OT_CATEGORIES.some(c => c.value === profile.employment_type)
      ? profile.employment_type : 'formal'
  }

  // 同計畫同人不重複（系統帳號比對 id、手動比對姓名）
  let dup = supabaseAdmin.from('overtime_teachers').select('id').eq('plan_id', plan_id)
  dup = teacher_id ? dup.eq('teacher_id', teacher_id) : dup.eq('name', name).is('teacher_id', null)
  const { data: exists } = await dup.limit(1)
  if (exists && exists.length > 0) {
    return NextResponse.json({ error: '這位教師已在此計畫清冊中' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('overtime_teachers')
    .insert({ plan_id, teacher_id, name, category }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/**
 * 修改教師（代扣款、備註、超鐘點區間；身分跟著帳號資料走，不在這裡改）。
 * body: { id, labor_fee, health_fee, lunch_fee, other_fee, note, ranges? }
 * ranges 有帶才更新（[{start,end}]，空陣列＝整個計畫期程）。
 */
export async function PUT(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const update: Record<string, unknown> = {
    labor_fee: parseFee(body?.labor_fee),
    health_fee: parseFee(body?.health_fee),
    lunch_fee: parseFee(body?.lunch_fee),
    other_fee: parseFee(body?.other_fee),
    note: String(body?.note ?? ''),
  }
  if (body?.ranges !== undefined) update.ranges = normalizeRanges(body.ranges)

  const { data, error } = await supabaseAdmin.from('overtime_teachers')
    .update(update)
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 從清冊移除教師（其時段一併刪除）。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('overtime_teachers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
