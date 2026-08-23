import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

const PERMS = ['schedule-config', 'schedule-wizard']
/** 每年度保留的版本數上限（加星號者不計入、不會被自動刪除）。 */
const KEEP = 30
/** seq 欄位由 migration 039 新增；尚未跑 migration 時 select／insert 會因欄位不存在而失敗 → 自動退回沒有 seq 的版本，清單照常可用 */
const isSeqMissing = (e: { message?: string } | null) => Boolean(e?.message && /seq/.test(e.message) && /column|schema cache/i.test(e.message))

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

  const row = {
    year,
    label: typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : null,
    source: body.source === 'manual' ? 'manual' : 'engine',
    base_hash: String(body.baseHash ?? ''),
    summary: body.summary ?? {},
    weights: body.weights ?? {},
    plan: body.plan,
    created_by: g.userId,
  }
  // 流水號：該年度目前最大 seq + 1（刪了舊版本也不重用，課務組講「第 N 版」才對得上）
  // 「先查最大值再寫」中間沒有鎖，兩台電腦同時存會拿到同一個號碼；(year, seq) 有唯一索引，
  // 所以其中一台會插入失敗。撞到就重查一次再寫，最多試三輪——機率很低，重試幾乎必成。
  let seq: number | null = null
  type VerRow = { id: string; created_at: string }
  type Err = { message?: string; code?: string }
  let data: VerRow | null = null
  let error: Err | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: mx, error: e1 } = await supabaseAdmin.from('schedule_plan_version').select('seq').eq('year', year).order('seq', { ascending: false, nullsFirst: false }).limit(1)
    seq = e1 ? null : (Number(mx?.[0]?.seq) || 0) + 1
    const r = await supabaseAdmin.from('schedule_plan_version').insert(seq !== null ? { ...row, seq } : row).select('id, created_at').single()
    data = (r.data as VerRow | null); error = (r.error as Err | null)
    if (!error) break
    if (seq !== null && isSeqMissing(error)) {   // 資料庫還沒有 seq 欄位（migration 未跑）
      const r2 = await supabaseAdmin.from('schedule_plan_version').insert(row).select('id, created_at').single()
      data = (r2.data as VerRow | null); error = (r2.error as Err | null)
      seq = null
      break
    }
    if (error.code !== '23505') break            // 不是唯一鍵衝突就不用重試
  }
  if (error || !data) return NextResponse.json({ error: error?.message ?? '存檔失敗' }, { status: 500 })

  // 保留上限：只刪沒加星號、而且比這一筆更早建立的舊版本。
  // 不加 lt 的話，兩台電腦同時存版本時，慢的那台可能把快的那台剛存好的版本當成「舊的」刪掉。
  const { data: olds } = await supabaseAdmin
    .from('schedule_plan_version')
    .select('id').eq('year', year).eq('starred', false).lt('created_at', data.created_at)
    .order('created_at', { ascending: false })
  const over = (olds ?? []).slice(Math.max(0, KEEP - 1)).map(v => v.id)
  if (over.length) await supabaseAdmin.from('schedule_plan_version').delete().in('id', over)

  return NextResponse.json({ ok: true, id: data.id, seq, created_at: data.created_at, pruned: over.length })
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
