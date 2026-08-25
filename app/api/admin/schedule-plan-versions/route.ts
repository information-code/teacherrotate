import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { withCurrentNames } from '@/lib/scheduling'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'
import { createPlanVersion, isSeqMissing } from '@/lib/schedule-version-server'

const PERMS = ['schedule-config', 'schedule-wizard']

async function guard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, PERMS))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { userId: user.id }
}

/** 版本清單（不含 plan 本體）：?year=115
 *  單一版本完整內容（含 plan）：?id=<uuid> */
export async function GET(request: NextRequest) {
  const g = await guard()
  if (g.error) return g.error

  const id = request.nextUrl.searchParams.get('id')
  if (id) {
    let { data, error } = await supabaseAdmin
      .from('schedule_plan_version')
      .select('id, year, seq, label, starred, source, base_hash, summary, weights, plan, created_at, created_by')
      .eq('id', id).maybeSingle()
    if (error && isSeqMissing(error)) ({ data, error } = await supabaseAdmin.from('schedule_plan_version').select('id, year, label, starred, source, base_hash, summary, weights, plan, created_at, created_by').eq('id', id).maybeSingle() as never)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: '找不到此版本' }, { status: 404 })
    // 版本裡的老師名字是存檔當下的快照；待聘帳號轉正後要以現在的名字顯示
    const { data: profs } = await supabaseAdmin.from('profiles').select('id, name')
    const nameOf = Object.fromEntries((profs ?? []).map(x => [x.id, x.name ?? '']))
    const plan = (data as { plan?: { placed?: unknown[] } }).plan
    if (plan && Array.isArray(plan.placed)) plan.placed = withCurrentNames(plan.placed as never, nameOf)
    return NextResponse.json(data)
  }

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  // 清單刻意不 select plan：整份約 150～250KB，20 份會讓頁面載入變得很慢
  let { data, error } = await supabaseAdmin
    .from('schedule_plan_version')
    .select('id, year, seq, label, starred, source, base_hash, summary, created_at, created_by')
    .eq('year', year).order('created_at', { ascending: false })
  if (error && isSeqMissing(error)) ({ data, error } = await supabaseAdmin.from('schedule_plan_version').select('id, year, label, starred, source, base_hash, summary, created_at, created_by').eq('year', year).order('created_at', { ascending: false }) as never)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 建立者姓名（清單要顯示「誰跑的」）
  const ids = Array.from(new Set((data ?? []).map(v => v.created_by).filter(Boolean))) as string[]
  const names: Record<string, string> = {}
  if (ids.length) {
    const { data: ps } = await supabaseAdmin.from('profiles').select('id, name').in('id', ids)
    for (const p of ps ?? []) names[p.id] = p.name ?? ''
  }
  return NextResponse.json({ versions: data ?? [], names })
}

/** 新增一個版本快照。body: { year, plan, weights, summary, baseHash, source?, label? } */
export async function POST(request: NextRequest) {
  const g = await guard()
  if (g.error) return g.error

  const body = await request.json()
  const year = Number(body.year)
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  if (!body.plan || !Array.isArray(body.plan.placed)) return NextResponse.json({ error: '缺少排課結果' }, { status: 400 })

  const r = await createPlanVersion({
    year, plan: body.plan as never, userId: g.userId as string,
    label: body.label, source: body.source === 'manual' ? 'manual' : 'engine',
    summary: (body.summary ?? {}) as never, weights: (body.weights ?? {}) as never, baseHash: String(body.baseHash ?? ''),
  })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ ok: true, id: r.id, seq: r.seq, pruned: r.pruned })
}

/** 改名／加星號。body: { id, label?, starred? } */
export async function PATCH(request: NextRequest) {
  const g = await guard()
  if (g.error) return g.error

  const { id, label, starred } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少版本 id' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (label !== undefined) patch.label = typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : null
  if (starred !== undefined) patch.starred = Boolean(starred)
  if (!Object.keys(patch).length) return NextResponse.json({ error: '沒有要更新的欄位' }, { status: 400 })

  const { error } = await supabaseAdmin.from('schedule_plan_version').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** 刪除一個版本。?id=<uuid> */
export async function DELETE(request: NextRequest) {
  const g = await guard()
  if (g.error) return g.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少版本 id' }, { status: 400 })
  const { error } = await supabaseAdmin.from('schedule_plan_version').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
