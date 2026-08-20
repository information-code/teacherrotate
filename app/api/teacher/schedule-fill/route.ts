import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeScheduleConfig, bandOf, SCHEDULE_DAYS } from '@/lib/scheduling'
import { homeroomBreakdown, normalizeConfig, adoptedReduction, type TeacherAllocation } from '@/lib/allocation'

/** 導師儲存／確認排課選填。body: { year, cells, confirm? }
 *  伺服器端驗證：本人是該班導師、已發布、未確認、格子合法（可排、非鎖課、非科任課）、
 *  科目與節數不超過配課；confirm 時需全數填滿。 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { year, cells, confirm, unconfirm } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  if (!cells || typeof cells !== 'object') return NextResponse.json({ error: '格式錯誤' }, { status: 400 })

  const [{ data: schRow }, { data: planRow }, { data: allocRow }, { data: cfgRow }] = await Promise.all([
    supabaseAdmin.from('schedule_config').select('config').eq('year', Number(year)).maybeSingle(),
    supabaseAdmin.from('schedule_plan').select('plan').eq('year', Number(year)).maybeSingle(),
    supabaseAdmin.from('allocation').select('data').eq('teacher_id', user.id).eq('year', Number(year)).maybeSingle(),
    supabaseAdmin.from('allocation_config').select('config').eq('year', Number(year)).maybeSingle(),
  ])
  const config = normalizeScheduleConfig(schRow?.config)
  const plan = (planRow?.plan ?? null) as { status?: string; fillOpen?: boolean; placed?: { classKey: string; day: number; period: number; size: number; parity?: string }[] } | null

  const classKey = Object.entries(config.classTeacher).find(([, tid]) => tid === user.id)?.[0]
  if (!classKey) return NextResponse.json({ error: '您不是任何班級的導師' }, { status: 403 })
  if (!plan || plan.status !== 'published') {
    return NextResponse.json({ error: plan?.status === 'final' ? '課表已定案，如需調整請洽教務處' : '導師排課尚未發布' }, { status: 403 })
  }
  if (plan.fillOpen === false) {
    return NextResponse.json({ error: '課務組已收回填課權限（正在調課），如需調整請洽教務處' }, { status: 403 })
  }

  // 取消確認：填課還開著就讓導師自己解鎖繼續改，不必為了改一格去麻煩教務處
  if (unconfirm === true) {
    const { error } = await supabaseAdmin
      .from('schedule_homeroom')
      .update({ confirmed_at: null, updated_at: new Date().toISOString() })
      .eq('year', Number(year)).eq('class_key', classKey)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, confirmed: false })
  }

  const { data: existing } = await supabaseAdmin
    .from('schedule_homeroom').select('confirmed_at')
    .eq('year', Number(year)).eq('class_key', classKey).maybeSingle()
  if (existing?.confirmed_at) {
    return NextResponse.json({ error: '已確認送出，如需修改請先按「取消確認」' }, { status: 403 })
  }

  // 固定格集合：鎖課＋科任課。
  // 單雙週課只鎖顯示格（單週＝起始節、雙週＝次節）；配對格開放導師填課、每格計 2 節（整塊兩節同科）
  const blocked = new Set<string>(Object.keys(config.lockCells[classKey] ?? {}))
  const pairCells = new Set<string>()
  for (const p of plan.placed ?? []) {
    if (p.classKey !== classKey) continue
    if ((p.parity === 'odd' || p.parity === 'even') && p.size === 2) {
      const disp = p.parity === 'odd' ? p.period : p.period + 1
      const other = p.parity === 'odd' ? p.period + 1 : p.period
      blocked.add(`${p.day}-${disp}`)
      pairCells.add(`${p.day}-${other}`)
      continue
    }
    blocked.add(`${p.day}-${p.period}`)
    if (p.size === 2) blocked.add(`${p.day}-${p.period + 1}`)
  }
  const [g] = classKey.split('-').map(Number)
  const grid = config.bands[bandOf(g)]
  const teachable = new Set<string>()
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) {
    if (grid.teachable[`${d}-${p}`]) teachable.add(`${d}-${p}`)
  }

  // 配課節數依「本班年級的採用情境」計（各年級可不同）
  const breakdown = homeroomBreakdown(
    allocRow?.data as TeacherAllocation | null,
    adoptedReduction(normalizeConfig(cfgRow?.config).grades[g]),
  )
  const clean: Record<string, string> = {}
  const counts: Record<string, number> = {}
  for (const [slot, subj] of Object.entries(cells as Record<string, unknown>)) {
    const s = String(subj)
    if (!teachable.has(slot)) return NextResponse.json({ error: `${slot} 不是可排課時段` }, { status: 400 })
    if (blocked.has(slot)) return NextResponse.json({ error: `${slot} 已有科任課或鎖課` }, { status: 400 })
    if (!(s in breakdown)) return NextResponse.json({ error: `「${s}」不在您的配課科目中` }, { status: 400 })
    clean[slot] = s
    counts[s] = (counts[s] ?? 0) + (pairCells.has(slot) ? 2 : 1)   // 配對格＝整塊兩節
  }
  for (const [s, n] of Object.entries(counts)) {
    if (n > (breakdown[s] ?? 0)) return NextResponse.json({ error: `「${s}」排了 ${n} 節，超過配課 ${breakdown[s]} 節` }, { status: 400 })
  }
  if (confirm === true) {
    for (const [s, need] of Object.entries(breakdown)) {
      if ((counts[s] ?? 0) !== need) return NextResponse.json({ error: `「${s}」尚未填滿（${counts[s] ?? 0}/${need}），全部填完才能確認` }, { status: 400 })
    }
  }

  const { error } = await supabaseAdmin.from('schedule_homeroom').upsert({
    year: Number(year),
    class_key: classKey,
    teacher_id: user.id,
    cells: clean,
    confirmed_at: confirm === true ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'year,class_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, confirmed: confirm === true })
}
