import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await checkAdmin(user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

function validateRange(start: unknown, end: unknown): string | null {
  if (!DATE_RE.test(String(start)) || !DATE_RE.test(String(end))) return '日期格式無效'
  if (String(end) < String(start)) return '結束日期不可早於開始日期'
  return null
}

/** 活動列表。query（選填）: start, end 篩選範圍 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const start = request.nextUrl.searchParams.get('start')
  const end = request.nextUrl.searchParams.get('end')
  let query = supabaseAdmin.from('school_events').select('*').order('start_date')
  if (start && DATE_RE.test(start)) query = query.gte('end_date', start)
  if (end && DATE_RE.test(end)) query = query.lte('start_date', end)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** 新增活動。body: { title, description?, start_date, end_date } */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const title = String(body?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: '請填寫活動名稱' }, { status: 400 })
  const rangeError = validateRange(body?.start_date, body?.end_date)
  if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('school_events').insert({
    title,
    description: String(body?.description ?? ''),
    start_date: body.start_date,
    end_date: body.end_date,
    created_by: auth.user.id,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新活動。body: { id, ...欄位 } */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少活動 id' }, { status: 400 })
  if (fields.title !== undefined && !String(fields.title).trim()) {
    return NextResponse.json({ error: '活動名稱不可為空' }, { status: 400 })
  }
  if (fields.start_date !== undefined || fields.end_date !== undefined) {
    const { data: current } = await supabaseAdmin
      .from('school_events').select('start_date, end_date').eq('id', id).maybeSingle()
    if (!current) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
    const rangeError = validateRange(
      fields.start_date ?? current.start_date,
      fields.end_date ?? current.end_date,
    )
    if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.title !== undefined) payload.title = String(fields.title).trim()
  if (fields.description !== undefined) payload.description = String(fields.description)
  if (fields.start_date !== undefined) payload.start_date = fields.start_date
  if (fields.end_date !== undefined) payload.end_date = fields.end_date

  const { data, error } = await supabaseAdmin.from('school_events')
    .update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除活動。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少活動 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('school_events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
