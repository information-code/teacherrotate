import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePublisher, canEditContent } from '@/lib/staff-server'
import { ADMIN_TITLE, SUPERADMIN_OFFICE, SUPERADMIN_TITLE } from '@/lib/staff'
import { VIRTUAL_EMAIL_DOMAIN } from '@/lib/utils'

/**
 * 公告列表（含每則已讀人數與全校教師數；虛擬帳號不計）。
 * 另回傳呼叫者權限資訊，前端據此顯示可編輯範圍。
 */
export async function GET() {
  const auth = await requirePublisher()
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
    announcements: (announcements.data ?? []).map(a => ({
      ...a,
      read_count: counts.get(a.id) ?? 0,
      can_edit: canEditContent(auth.access, a),
    })),
    totalTeachers: teachers.count ?? 0,
    viewer: {
      role: auth.access.role,
      duty: auth.access.duty,
      office: auth.access.office,
    },
  })
}

/** 新增公告。行政人員：處室依職務自動帶入；superadmin：最高管理者／教務處 */
export async function POST(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error
  const { access } = auth

  const body = await request.json()
  const title = String(body?.title ?? '').trim()
  if (!title) return NextResponse.json({ error: '請填寫公告標題' }, { status: 400 })

  // 有行政職務者（含兼任的管理員）一律依職務標記；無兼任的管理者才用管理者標籤
  const office = access.duty ? access.office ?? ''
    : access.role === 'superadmin' ? SUPERADMIN_OFFICE
    : String(body?.office ?? '')
  const publisherTitle = access.duty
    ?? (access.role === 'superadmin' ? SUPERADMIN_TITLE : ADMIN_TITLE)

  const { data, error } = await supabaseAdmin.from('announcements').insert({
    title,
    content: String(body?.content ?? ''),
    office,
    publisher_title: publisherTitle,
    pinned: Boolean(body?.pinned),
    requires_action: Boolean(body?.requires_action),
    link_url: String(body?.link_url ?? '').trim(),
    publish_at: body?.publish_at || new Date().toISOString(),
    expire_at: body?.expire_at || null,
    created_by: access.userId,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新公告。body: { id, ...欄位 }。主任可編本處室全部；組長僅能編自己發布的 */
export async function PUT(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error
  const { access } = auth

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少公告 id' }, { status: 400 })
  if (fields.title !== undefined && !String(fields.title).trim()) {
    return NextResponse.json({ error: '公告標題不可為空' }, { status: 400 })
  }

  const { data: current } = await supabaseAdmin
    .from('announcements').select('created_by, office').eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: '找不到公告' }, { status: 404 })
  if (!canEditContent(access, current)) {
    return NextResponse.json({ error: '您沒有編輯這則公告的權限' }, { status: 403 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.title !== undefined) payload.title = String(fields.title).trim()
  if (fields.content !== undefined) payload.content = String(fields.content)
  // 處室標籤：行政人員不可改（依職務綁定）；管理員可調整
  if (fields.office !== undefined && access.role !== 'staff') payload.office = String(fields.office)
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

/** 刪除公告（編輯權同上；連帶已讀紀錄，已加入代辦的僅解除連結） */
export async function DELETE(request: NextRequest) {
  const auth = await requirePublisher()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少公告 id' }, { status: 400 })

  const { data: current } = await supabaseAdmin
    .from('announcements').select('created_by, office').eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: '找不到公告' }, { status: 404 })
  if (!canEditContent(auth.access, current)) {
    return NextResponse.json({ error: '您沒有刪除這則公告的權限' }, { status: 403 })
  }

  const { error } = await supabaseAdmin.from('announcements').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
