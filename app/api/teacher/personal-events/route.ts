import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * 時間欄位驗證：整天＝兩者皆空；指定時間＝兩者皆填且結束晚於開始。
 * 回傳錯誤訊息或正規化後的值（null＝整天）。
 */
function parseTimes(body: Record<string, unknown>):
  { error: string } | { start_time: string | null; end_time: string | null } {
  const start = String(body?.start_time ?? '').trim()
  const end = String(body?.end_time ?? '').trim()
  if (!start && !end) return { start_time: null, end_time: null }
  if (!start || !end) return { error: '請同時填寫開始與結束時間，或改為整天。' }
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { error: '時間格式無效（24 小時制 HH:MM）' }
  if (end <= start) return { error: '結束時間須晚於開始時間。' }
  return { start_time: start, end_time: end }
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { user }
}

/** 新增個人事項。body: { date, title, note?, start_time?, end_time? }（時間空＝整天） */
export async function POST(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const date = String(body?.date ?? '')
  const title = String(body?.title ?? '').trim()
  if (!DATE_RE.test(date)) return NextResponse.json({ error: '日期格式無效' }, { status: 400 })
  if (!title) return NextResponse.json({ error: '請填寫事項名稱' }, { status: 400 })
  const times = parseTimes(body)
  if ('error' in times) return NextResponse.json({ error: times.error }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('personal_events').insert({
    user_id: auth.user.id,
    date,
    title,
    note: String(body?.note ?? ''),
    start_time: times.start_time,
    end_time: times.end_time,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新個人事項（僅本人）。body: { id, date?, title?, note?, start_time?, end_time? } */
export async function PUT(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少事項 id' }, { status: 400 })
  if (fields.date !== undefined && !DATE_RE.test(String(fields.date))) {
    return NextResponse.json({ error: '日期格式無效' }, { status: 400 })
  }
  if (fields.title !== undefined && !String(fields.title).trim()) {
    return NextResponse.json({ error: '事項名稱不可為空' }, { status: 400 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.date !== undefined) payload.date = fields.date
  if (fields.title !== undefined) payload.title = String(fields.title).trim()
  if (fields.note !== undefined) payload.note = String(fields.note)
  if (fields.start_time !== undefined || fields.end_time !== undefined) {
    const times = parseTimes(fields)
    if ('error' in times) return NextResponse.json({ error: times.error }, { status: 400 })
    payload.start_time = times.start_time
    payload.end_time = times.end_time
  }

  const { data, error } = await supabaseAdmin.from('personal_events')
    .update(payload).eq('id', id).eq('user_id', auth.user.id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到事項' }, { status: 404 })
  return NextResponse.json(data)
}

/** 刪除個人事項（僅本人）。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少事項 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('personal_events')
    .delete().eq('id', id).eq('user_id', auth.user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
