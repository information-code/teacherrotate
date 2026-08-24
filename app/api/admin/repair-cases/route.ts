import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'
import { parseRepairConfig } from '@/lib/repair'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['repair-cases']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 案件報表初始資料：全部案件（含報修人姓名、照片簽名網址）、項目/問題字典、SLA 設定 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [{ data: reports, error: e1 }, { data: items, error: e2 }, { data: issues, error: e3 }, { data: configRow, error: e4 }] = await Promise.all([
    supabaseAdmin.from('repair_reports').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('repair_items').select('id, name, active').order('sort_order').order('name'),
    supabaseAdmin.from('repair_issues').select('id, item_id, name, active'),
    supabaseAdmin.from('repair_config').select('config').eq('id', 1).maybeSingle(),
  ])
  const err = e1 ?? e2 ?? e3 ?? e4
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  // 報修人姓名
  const teacherIds = Array.from(new Set((reports ?? []).map(r => r.teacher_id)))
  const names: Record<string, string> = {}
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles').select('id, name, email').in('id', teacherIds)
    for (const p of profiles ?? []) names[p.id] = p.name || p.email
  }

  const rows = await Promise.all((reports ?? []).map(async r => {
    const paths = Array.isArray(r.photos) ? (r.photos as string[]) : []
    const photoUrls: string[] = []
    for (const p of paths) {
      const { data: signed } = await supabaseAdmin.storage
        .from('equipment-photos').createSignedUrl(p, 60 * 60)
      if (signed?.signedUrl) photoUrls.push(signed.signedUrl)
    }
    return { ...r, photos: undefined, photoUrls, teacher_name: names[r.teacher_id] ?? '（不明）' }
  }))

  return NextResponse.json({
    reports: rows,
    items: items ?? [],
    issues: issues ?? [],
    config: parseRepairConfig(configRow?.config),
  })
}

/**
 * 案件操作。body: { id, action, ... }
 * - accept：接案（通報中→已接案）
 * - process：開始處理（通報中/已接案→處理中，時間戳存 dispatched_at）
 * - close：結案（未結案→已結案，resolved_kind 補 'fixed'）
 * - note：儲存「向報修者說明」{ admin_note }
 * - classify：歸類 { item_id, issue_id }（更新 id 與名稱快照，custom_issue 原文保留）
 * - new-issue：把自由描述升級成新標準問題 { item_id, name } 並歸類本案
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const id = String(body?.id ?? '')
  const action = String(body?.action ?? '')
  if (!id) return NextResponse.json({ error: '缺少案件 id' }, { status: 400 })

  const { data: report } = await supabaseAdmin
    .from('repair_reports').select('*').eq('id', id).maybeSingle()
  if (!report) return NextResponse.json({ error: '找不到案件' }, { status: 404 })

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }

  if (action === 'accept') {
    if (report.status !== 'pending') return NextResponse.json({ error: '案件已接過案' }, { status: 400 })
    patch.status = 'accepted'
    patch.accepted_at = now
  } else if (action === 'process') {
    if (report.status !== 'pending' && report.status !== 'accepted') {
      return NextResponse.json({ error: '案件狀態不可轉為處理中' }, { status: 400 })
    }
    patch.status = 'processing'
    patch.accepted_at = report.accepted_at ?? now
    patch.dispatched_at = now
  } else if (action === 'close') {
    if (report.status === 'closed') return NextResponse.json({ error: '案件已結案' }, { status: 400 })
    patch.status = 'closed'
    patch.resolved_kind = report.resolved_kind ?? 'fixed'
    patch.closed_at = now
    patch.closed_by = auth.user.id
  } else if (action === 'note') {
    patch.admin_note = String(body?.admin_note ?? '')
  } else if (action === 'classify') {
    const itemId = String(body?.item_id ?? '')
    const issueId = String(body?.issue_id ?? '')
    if (!itemId || !issueId) return NextResponse.json({ error: '請選擇設備項目與問題' }, { status: 400 })
    const { data: issue } = await supabaseAdmin
      .from('repair_issues').select('id, item_id, name').eq('id', issueId).maybeSingle()
    if (!issue || issue.item_id !== itemId) return NextResponse.json({ error: '問題選項無效' }, { status: 400 })
    const { data: item } = await supabaseAdmin
      .from('repair_items').select('id, name').eq('id', itemId).maybeSingle()
    if (!item) return NextResponse.json({ error: '設備項目無效' }, { status: 400 })
    patch.item_id = item.id
    patch.item_name = item.name
    patch.issue_id = issue.id
    patch.issue_name = issue.name
  } else if (action === 'new-issue') {
    const itemId = String(body?.item_id ?? '')
    const name = String(body?.name ?? '').trim()
    if (!itemId) return NextResponse.json({ error: '請選擇設備項目' }, { status: 400 })
    if (!name) return NextResponse.json({ error: '請填寫問題名稱' }, { status: 400 })
    const { data: item } = await supabaseAdmin
      .from('repair_items').select('id, name').eq('id', itemId).maybeSingle()
    if (!item) return NextResponse.json({ error: '設備項目無效' }, { status: 400 })
    const { data: created, error: ce } = await supabaseAdmin
      .from('repair_issues').insert({ item_id: item.id, name }).select('id, name').single()
    if (ce) return NextResponse.json({ error: ce.message }, { status: 500 })
    patch.item_id = item.id
    patch.item_name = item.name
    patch.issue_id = created.id
    patch.issue_name = created.name
  } else {
    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('repair_reports').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
