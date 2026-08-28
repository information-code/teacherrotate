import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import { isDateStr } from '@/lib/overtime'

/** 新增／修改特殊不上課日。body: { date, name } */
export async function POST(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const date = String(body?.date ?? '')
  const name = String(body?.name ?? '').trim()
  if (!isDateStr(date)) return NextResponse.json({ error: '日期格式無效' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('overtime_skip_dates')
    .upsert({ date, name }, { onConflict: 'date' }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除特殊不上課日。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('overtime_skip_dates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
