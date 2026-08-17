import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

const PERMS = ['schedule-config', 'schedule-wizard']
/** 每年度保留的版本數上限（加星號者不計入、不會被自動刪除）。 */
const KEEP = 20

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
    const { data, error } = await supabaseAdmin
      .from('schedule_plan_version')
      .select('id, year, label, starred, source, base_hash, summary, weights, plan, created_at, created_by')
      .eq('id', id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: '找不到此版本' }, { status: 404 })
    return NextResponse.json(data)
  }

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  // 清單刻意不 select plan：整份約 150～250KB，20 份會讓頁面載入變得很慢
  const { data, error } = await supabaseAdmin
    .from('schedule_plan_version')
    .select('id, year, label, starred, source, base_hash, summary, created_at, created_by')
    .eq('year', year).order('created_at', { ascending: false })
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

  const { data, error } = await supabaseAdmin
    .from('schedule_plan_version')
    .insert({
      year,
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : null,
      source: body.source === 'manual' ? 'manual' : 'engine',
      base_hash: String(body.baseHash ?? ''),
      summary: body.summary ?? {},
      weights: body.weights ?? {},
      plan: body.plan,
      created_by: g.userId,
    })
    .select('id, created_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 保留上限：只刪沒加星號的舊版本
  const { data: olds } = await supabaseAdmin
    .from('schedule_plan_version')
    .select('id').eq('year', year).eq('starred', false)
    .order('created_at', { ascending: false })
  const over = (olds ?? []).slice(KEEP).map(v => v.id)
  if (over.length) await supabaseAdmin.from('schedule_plan_version').delete().in('id', over)

  return NextResponse.json({ ok: true, id: data.id, created_at: data.created_at, pruned: over.length })
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
