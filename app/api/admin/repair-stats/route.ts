import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

/** 平均小時數（一位小數）；空陣列回 null */
function avgHours(list: number[]): number | null {
  if (list.length === 0) return null
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length / 3600000) * 10) / 10
}

/** 報修統計：問題/設備/地點排行、月趨勢、解決方式占比、處理時長 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['repair-stats']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: reports, error } = await supabaseAdmin
    .from('repair_reports')
    .select('item_id, item_name, issue_id, issue_name, custom_issue, location, status, resolved_kind, created_at, accepted_at, closed_at')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = reports ?? []
  const total = rows.length
  const open = rows.filter(r => r.status !== 'closed').length
  const unclassified = rows.filter(r => !r.issue_id).length

  // 解決方式占比
  const resolved = { self: 0, vanished: 0, fixed: 0 }
  for (const r of rows) {
    if (r.status === 'closed' && r.resolved_kind && r.resolved_kind in resolved) {
      resolved[r.resolved_kind as keyof typeof resolved]++
    }
  }

  // 問題排行（issue_id 聚合；未歸類不列入，另行提醒）
  const issueMap = new Map<string, { name: string; item_name: string; total: number; open: number; selfSolved: number }>()
  for (const r of rows) {
    if (!r.issue_id) continue
    const cur = issueMap.get(r.issue_id) ?? { name: r.issue_name, item_name: r.item_name, total: 0, open: 0, selfSolved: 0 }
    cur.total++
    cur.name = r.issue_name || cur.name
    cur.item_name = r.item_name || cur.item_name
    if (r.status !== 'closed') cur.open++
    if (r.resolved_kind === 'self' || r.resolved_kind === 'vanished') cur.selfSolved++
    issueMap.set(r.issue_id, cur)
  }
  const issueStats = Array.from(issueMap.values()).sort((a, b) => b.total - a.total)

  // 設備排行（含「其他設備」自填名稱，以名稱聚合）
  const itemMap = new Map<string, { name: string; total: number; open: number; fixed: number; selfSolved: number }>()
  for (const r of rows) {
    const key = r.item_id ?? `name:${r.item_name}`
    const cur = itemMap.get(key) ?? { name: r.item_name, total: 0, open: 0, fixed: 0, selfSolved: 0 }
    cur.total++
    cur.name = r.item_name || cur.name
    if (r.status !== 'closed') cur.open++
    if (r.resolved_kind === 'fixed') cur.fixed++
    if (r.resolved_kind === 'self' || r.resolved_kind === 'vanished') cur.selfSolved++
    itemMap.set(key, cur)
  }
  const itemStats = Array.from(itemMap.values()).sort((a, b) => b.total - a.total)

  // 地點排行
  const locMap = new Map<string, number>()
  for (const r of rows) {
    const loc = (r.location || '').trim()
    if (!loc) continue
    locMap.set(loc, (locMap.get(loc) ?? 0) + 1)
  }
  const locationStats = Array.from(locMap.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  // 月趨勢
  const monthMap = new Map<string, { reported: number; closed: number; selfSolved: number }>()
  const monthKey = (iso: string) => {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  for (const r of rows) {
    const m = monthKey(r.created_at)
    const cur = monthMap.get(m) ?? { reported: 0, closed: 0, selfSolved: 0 }
    cur.reported++
    monthMap.set(m, cur)
    if (r.closed_at) {
      const cm = monthKey(r.closed_at)
      const cc = monthMap.get(cm) ?? { reported: 0, closed: 0, selfSolved: 0 }
      cc.closed++
      if (r.resolved_kind === 'self' || r.resolved_kind === 'vanished') cc.selfSolved++
      monthMap.set(cm, cc)
    }
  }
  const monthly = Array.from(monthMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // 處理時長（小時）
  const acceptDurations: number[] = []
  const closeDurations: number[] = []
  for (const r of rows) {
    const created = new Date(r.created_at).getTime()
    if (r.accepted_at) acceptDurations.push(new Date(r.accepted_at).getTime() - created)
    if (r.closed_at && r.resolved_kind === 'fixed') closeDurations.push(new Date(r.closed_at).getTime() - created)
  }

  return NextResponse.json({
    total,
    open,
    unclassified,
    resolved,
    avgAcceptHours: avgHours(acceptDurations),
    avgCloseHours: avgHours(closeDurations),
    issueStats,
    itemStats,
    locationStats,
    monthly,
  })
}
