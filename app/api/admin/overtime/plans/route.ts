import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import { forbidIfNotPlanOwner } from '@/lib/overtime-server'
import { isDateStr } from '@/lib/overtime'

/** 金額容錯：全形數字轉半形、去逗號與空白（前端已清過，這裡再保險一次） */
function parseMoney(v: unknown): number {
  const cleaned = String(v ?? 0)
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '')
  return Math.round(Number(cleaned || 0))
}

function parsePlan(body: Record<string, unknown>) {
  const name = String(body?.name ?? '').trim()
  const start_date = String(body?.start_date ?? '')
  const end_date = String(body?.end_date ?? '')
  const rate = parseMoney(body?.rate)
  const budget = parseMoney(body?.budget)
  if (!name) return { error: '請填寫計畫經費名稱' }
  if (!isDateStr(start_date) || !isDateStr(end_date)) return { error: '期程日期格式無效' }
  if (end_date < start_date) return { error: '期程結束日不可早於開始日' }
  if (!Number.isFinite(rate) || rate < 0) return { error: '節薪無效' }
  if (!Number.isFinite(budget) || budget < 0) return { error: '總經費無效' }
  return { row: { name, start_date, end_date, rate, budget } }
}

/** 新增計畫。body: { name, start_date, end_date, rate, budget } */
export async function POST(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const parsed = parsePlan(await request.json())
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 計畫歸屬建立者：其他管理者互不可改（superadmin 例外）
  const { data: me } = await supabaseAdmin.from('profiles')
    .select('name').eq('id', auth.access.userId).maybeSingle()
  const { data, error } = await supabaseAdmin.from('overtime_plans')
    .insert({ ...parsed.row, created_by: auth.access.userId, created_by_name: me?.name ?? '' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 修改計畫。body: { id, name, start_date, end_date, rate, budget } */
export async function PUT(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })
  const parsed = parsePlan(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const forbidden = await forbidIfNotPlanOwner(auth.access, id)
  if (forbidden) return forbidden

  const { data, error } = await supabaseAdmin.from('overtime_plans')
    .update({ ...parsed.row, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除計畫（清冊、時段一併刪除）。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const forbidden = await forbidIfNotPlanOwner(auth.access, id)
  if (forbidden) return forbidden

  const { error } = await supabaseAdmin.from('overtime_plans').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
