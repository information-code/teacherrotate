import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { user }
}

/** 報修頁初始資料：開放的設備項目/問題（含被報修次數）、維護人員、我的案件（含照片簽名網址） */
export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const [{ data: items, error: e1 }, { data: issues, error: e2 }, { data: contacts, error: e3 }, { data: reports, error: e4 }] = await Promise.all([
    supabaseAdmin.from('repair_items').select('id, name').eq('active', true).order('sort_order').order('name'),
    supabaseAdmin.from('repair_issues').select('id, item_id, name').eq('active', true),
    supabaseAdmin.from('repair_contacts').select('name, role, contact, note').eq('active', true).order('sort_order').order('name'),
    supabaseAdmin.from('repair_reports')
      .select('id, item_id, item_name, issue_id, issue_name, custom_issue, location, photos, status, resolved_kind, created_at, accepted_at, dispatched_at, vendor_at, closed_at')
      .eq('teacher_id', auth.user.id)
      .order('created_at', { ascending: false }),
  ])
  const err = e1 ?? e2 ?? e3 ?? e4
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  // 各標準問題被報修次數（全校、不限自己），教師端依次數排序並顯示
  const { data: counted, error: e5 } = await supabaseAdmin
    .from('repair_reports').select('issue_id').not('issue_id', 'is', null)
  if (e5) return NextResponse.json({ error: e5.message }, { status: 500 })
  const issueCounts: Record<string, number> = {}
  for (const r of counted ?? []) {
    if (r.issue_id) issueCounts[r.issue_id] = (issueCounts[r.issue_id] ?? 0) + 1
  }

  // 我的案件照片轉簽名網址（1 小時）
  const myReports = await Promise.all((reports ?? []).map(async r => {
    const paths = Array.isArray(r.photos) ? (r.photos as string[]) : []
    const photoUrls: string[] = []
    for (const p of paths) {
      const { data: signed } = await supabaseAdmin.storage
        .from('equipment-photos').createSignedUrl(p, 60 * 60)
      if (signed?.signedUrl) photoUrls.push(signed.signedUrl)
    }
    return { ...r, photos: undefined, photoUrls }
  }))

  return NextResponse.json({
    items: items ?? [],
    issues: (issues ?? []).map(s => ({ ...s, count: issueCounts[s.id] ?? 0 })),
    contacts: contacts ?? [],
    reports: myReports,
  })
}

/**
 * 送出報修。body: { item_id?, other_item_name?, issue_id?, custom_issue?, location, photos: string[] }
 * item_id 為空＝「其他設備」：other_item_name 必填、問題只能自由描述。
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const itemId = body?.item_id ? String(body.item_id) : null
  const customIssue = String(body?.custom_issue ?? '').trim()
  let itemName = ''
  let issueId: string | null = null
  let issueName = ''

  if (itemId) {
    const { data: item } = await supabaseAdmin
      .from('repair_items').select('id, name, active').eq('id', itemId).maybeSingle()
    if (!item || !item.active) return NextResponse.json({ error: '此設備項目目前不開放報修' }, { status: 400 })
    itemName = item.name

    issueId = body?.issue_id ? String(body.issue_id) : null
    if (issueId) {
      const { data: issue } = await supabaseAdmin
        .from('repair_issues').select('id, item_id, name, active').eq('id', issueId).maybeSingle()
      if (!issue || !issue.active || issue.item_id !== itemId) {
        return NextResponse.json({ error: '問題選項無效，請重新選擇' }, { status: 400 })
      }
      issueName = issue.name
    } else if (!customIssue) {
      return NextResponse.json({ error: '請選擇問題或自行描述' }, { status: 400 })
    }
  } else {
    itemName = String(body?.other_item_name ?? '').trim()
    if (!itemName) return NextResponse.json({ error: '請填寫設備名稱' }, { status: 400 })
    if (!customIssue) return NextResponse.json({ error: '請描述遇到的問題' }, { status: 400 })
  }

  const photos = Array.isArray(body?.photos)
    ? (body.photos as unknown[]).filter((p): p is string => typeof p === 'string')
    : []

  const { data, error } = await supabaseAdmin.from('repair_reports').insert({
    teacher_id: auth.user.id,
    item_id: itemId,
    item_name: itemName,
    issue_id: issueId,
    issue_name: issueName,
    custom_issue: customIssue,
    location: String(body?.location ?? '').trim(),
    photos: photos as never,
  }).select('id, created_at').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 回報已解決（輕量結案）。body: { id, resolved_kind: 'self' | 'vanished' } */
export async function PUT(request: NextRequest) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const id = String(body?.id ?? '')
  const kind = body?.resolved_kind
  if (!id) return NextResponse.json({ error: '缺少案件 id' }, { status: 400 })
  if (kind !== 'self' && kind !== 'vanished') {
    return NextResponse.json({ error: '解決方式無效' }, { status: 400 })
  }

  const { data: report } = await supabaseAdmin
    .from('repair_reports').select('id, teacher_id, status').eq('id', id).maybeSingle()
  if (!report || report.teacher_id !== auth.user.id) {
    return NextResponse.json({ error: '找不到案件' }, { status: 404 })
  }
  if (report.status === 'closed') {
    return NextResponse.json({ error: '案件已結案' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('repair_reports').update({
    status: 'closed',
    resolved_kind: kind,
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
