import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import { VIRTUAL_EMAIL_DOMAIN } from '@/lib/utils'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await checkAdmin(user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 公告列表（含每則已讀人數與全校教師數；虛擬帳號不計） */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [announcements, reads, teachers] = await Promise.all([
    supabaseAdmin.from('announcements').select('*')
      .order('pinned', { ascending: false })
      .order('publish_at', { ascending: false }),
    supabaseAdmin.from('announcement_reads').select('announcement_id'),
    supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true })
      .not('email', 'like', `%${VIRTUAL_EMAIL_DOMAIN}`),
  ])
  const firstError = announcements.error ?? reads.error ?? teachers.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const counts = new Map<string, number>()
  for (const r of reads.data ?? []) {
    counts.set(r.announcement_id, (counts.get(r.announcement_id) ?? 0) + 1)
  }
  return NextResponse.json({
    announcements: (announcements.data ?? []).map(a => ({ ...a, read_count: counts.get(a.id) ?? 0 })),
    totalTeachers: teachers.count ?? 0,
  })
}

/** 新增公告 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const title = String(body?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: '請填寫公告標題' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('announcements').insert({
    title,
    content: String(body?.content ?? ''),
    office: String(body?.office ?? ''),
    pinned: Boolean(body?.pinned),
    requires_action: Boolean(body?.requires_action),
    link_url: String(body?.link_url ?? '').trim(),
    publish_at: body?.publish_at || new Date().toISOString(),
    expire_at: body?.expire_at || null,
    created_by: auth.user.id,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新公告。body: { id, ...欄位 } */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少公告 id' }, { status: 400 })
  if (fields.title !== undefined && !String(fields.title).trim()) {
    return NextResponse.json({ error: '公告標題不可為空' }, { status: 400 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.title !== undefined) payload.title = String(fields.title).trim()
  if (fields.content !== undefined) payload.content = String(fields.content)
  if (fields.office !== undefined) payload.office = String(fields.office)
  if (fields.pinned !== undefined) payload.pinned = Boolean(fields.pinned)
  if (fields.requires_action !== undefined) payload.requires_action = Boolean(fields.requires_action)
  if (fields.link_url !== undefined) payload.link_url = String(fields.link_url).trim()
  if (fields.publish_at !== undefined) payload.publish_at = fields.publish_at
  if (fields.expire_at !== undefined) payload.expire_at = fields.expire_at || null

  const { data, error } = await supabaseAdmin.from('announcements')
    .update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除公告（連帶已讀紀錄；已加入老師代辦的項目保留、僅解除連結） */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少公告 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('announcements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
