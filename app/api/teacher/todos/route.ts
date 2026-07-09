import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { user }
}

/**
 * 新增代辦。body: { title, note?, due_date?, announcement_id? }
 * 帶 announcement_id 表示從公告加入（同一公告不重複加入）。
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const title = String(body?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: '請填寫代辦內容' }, { status: 400 })
  if (body?.due_date && !DATE_RE.test(String(body.due_date))) {
    return NextResponse.json({ error: '日期格式無效' }, { status: 400 })
  }

  const announcementId = body?.announcement_id ? String(body.announcement_id) : null
  if (announcementId) {
    const { data: existing } = await supabaseAdmin.from('todos')
      .select('id').eq('user_id', auth.user.id)
      .eq('announcement_id', announcementId).limit(1).maybeSingle()
    if (existing) return NextResponse.json({ error: '這則公告已加入代辦。' }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin.from('todos').insert({
    user_id: auth.user.id,
    title,
    note: String(body?.note ?? ''),
    due_date: body?.due_date || null,
    source: announcementId ? 'announcement' : 'self',
    announcement_id: announcementId,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新代辦（僅本人）。body: { id, title?, note?, due_date?, status? } */
export async function PUT(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少代辦 id' }, { status: 400 })
  if (fields.title !== undefined && !String(fields.title).trim()) {
    return NextResponse.json({ error: '代辦內容不可為空' }, { status: 400 })
  }
  if (fields.due_date !== undefined && fields.due_date !== null && fields.due_date !== ''
      && !DATE_RE.test(String(fields.due_date))) {
    return NextResponse.json({ error: '日期格式無效' }, { status: 400 })
  }
  if (fields.status !== undefined && !['todo', 'done'].includes(String(fields.status))) {
    return NextResponse.json({ error: '狀態無效' }, { status: 400 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.title !== undefined) payload.title = String(fields.title).trim()
  if (fields.note !== undefined) payload.note = String(fields.note)
  if (fields.due_date !== undefined) payload.due_date = fields.due_date || null
  if (fields.status !== undefined) {
    payload.status = fields.status
    payload.completed_at = fields.status === 'done' ? new Date().toISOString() : null
  }

  const { data, error } = await supabaseAdmin.from('todos')
    .update(payload).eq('id', id).eq('user_id', auth.user.id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到代辦事項' }, { status: 404 })
  return NextResponse.json(data)
}

/** 刪除代辦（僅本人）。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少代辦 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('todos')
    .delete().eq('id', id).eq('user_id', auth.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
