import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePublisher, canEditContent } from '@/lib/staff-server'
import { ADMIN_TITLE, SUPERADMIN_OFFICE, SUPERADMIN_TITLE } from '@/lib/staff'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validateRange(start: unknown, end: unknown): string | null {
  if (!DATE_RE.test(String(start)) || !DATE_RE.test(String(end))) return '日期格式無效'
  if (String(end) < String(start)) return '結束日期不可早於開始日期'
  return null
}

/** 活動列表。query（選填）: start, end 篩選範圍。附 can_edit 與呼叫者資訊 */
export async function GET(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error

  const start = request.nextUrl.searchParams.get('start')
  const end = request.nextUrl.searchParams.get('end')
  let query = supabaseAdmin.from('school_events').select('*').order('start_date')
  if (start && DATE_RE.test(start)) query = query.gte('end_date', start)
  if (end && DATE_RE.test(end)) query = query.lte('start_date', end)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    events: (data ?? []).map(ev => ({ ...ev, can_edit: canEditContent(auth.access, ev) })),
    viewer: {
      role: auth.access.role,
      duty: auth.access.duty,
      office: auth.access.office,
    },
  })
}

/** 新增活動。行政人員：處室依職務自動帶入 */
export async function POST(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error
  const { access } = auth

  const body = await request.json()
  const title = String(body?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: '請填寫活動名稱' }, { status: 400 })
  const rangeError = validateRange(body?.start_date, body?.end_date)
  if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 })

  // 有行政職務者（含兼任的管理員）一律依職務標記；無兼任的管理者才用管理者標籤
  const office = access.duty ? access.office ?? ''
    : access.role === 'superadmin' ? SUPERADMIN_OFFICE
    : String(body?.office ?? '')
  const publisherTitle = access.duty
    ?? (access.role === 'superadmin' ? SUPERADMIN_TITLE : ADMIN_TITLE)

  const { data, error } = await supabaseAdmin.from('school_events').insert({
    title,
    description: String(body?.description ?? ''),
    start_date: body.start_date,
    end_date: body.end_date,
    office,
    publisher_title: publisherTitle,
    created_by: access.userId,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新活動。body: { id, ...欄位 }。主任可編本處室全部；組長僅能編自己發布的 */
export async function PUT(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error
  const { access } = auth

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少活動 id' }, { status: 400 })
  if (fields.title !== undefined && !String(fields.title).trim()) {
    return NextResponse.json({ error: '活動名稱不可為空' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('school_events').select('created_by, office, start_date, end_date')
    .eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  if (!canEditContent(access, current)) {
    return NextResponse.json({ error: '您沒有編輯這個活動的權限' }, { status: 403 })
  }
  if (fields.start_date !== undefined || fields.end_date !== undefined) {
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
  if (fields.office !== undefined && access.role !== 'staff') payload.office = String(fields.office)

  const { data, error } = await supabaseAdmin.from('school_events')
    .update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除活動（編輯權同上）。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少活動 id' }, { status: 400 })

  const { data: current } = await supabaseAdmin
    .from('school_events').select('created_by, office').eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: '找不到活動' }, { status: 404 })
  if (!canEditContent(auth.access, current)) {
    return NextResponse.json({ error: '您沒有刪除這個活動的權限' }, { status: 403 })
  }

  const { error } = await supabaseAdmin.from('school_events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
