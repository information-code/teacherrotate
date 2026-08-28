import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import { isDateStr } from '@/lib/overtime'

function parsePlan(body: Record<string, unknown>) {
  const name = String(body?.name ?? '').trim()
  const start_date = String(body?.start_date ?? '')
  const end_date = String(body?.end_date ?? '')
  const rate = Math.round(Number(body?.rate ?? 0))
  const budget = Math.round(Number(body?.budget ?? 0))
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

  const { data, error } = await supabaseAdmin.from('overtime_plans')
    .insert(parsed.row).select().single()
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

  const { error } = await supabaseAdmin.from('overtime_plans').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
