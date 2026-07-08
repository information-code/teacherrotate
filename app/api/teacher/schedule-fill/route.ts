import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeScheduleConfig, bandOf, SCHEDULE_DAYS } from '@/lib/scheduling'
import { homeroomBreakdown, type TeacherAllocation } from '@/lib/allocation'

/** 導師儲存／確認排課選填。body: { year, cells, confirm? }
 *  伺服器端驗證：本人是該班導師、已發布、未確認、格子合法（可排、非鎖課、非科任課）、
 *  科目與節數不超過配課；confirm 時需全數填滿。 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { year, cells, confirm } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  if (!cells || typeof cells !== 'object') return NextResponse.json({ error: '格式錯誤' }, { status: 400 })

  const [{ data: schRow }, { data: planRow }, { data: allocRow }] = await Promise.all([
    supabaseAdmin.from('schedule_config').select('config').eq('year', Number(year)).maybeSingle(),
    supabaseAdmin.from('schedule_plan').select('plan').eq('year', Number(year)).maybeSingle(),
    supabaseAdmin.from('allocation').select('data').eq('teacher_id', user.id).eq('year', Number(year)).maybeSingle(),
  ])
  const config = normalizeScheduleConfig(schRow?.config)
  const plan = (planRow?.plan ?? null) as { status?: string; placed?: { classKey: string; day: number; period: number; size: number }[] } | null

  const classKey = Object.entries(config.classTeacher).find(([, tid]) => tid === user.id)?.[0]
  if (!classKey) return NextResponse.json({ error: '您不是任何班級的導師' }, { status: 403 })
  if (!plan || plan.status !== 'published') {
    return NextResponse.json({ error: plan?.status === 'final' ? '課表已定案，如需調整請洽教務處' : '導師排課尚未發布' }, { status: 403 })
  }

  const { data: existing } = await supabaseAdmin
    .from('schedule_homeroom').select('confirmed_at')
    .eq('year', Number(year)).eq('class_key', classKey).maybeSingle()
  if (existing?.confirmed_at) {
    return NextResponse.json({ error: '已確認送出，如需修改請洽教務處退回' }, { status: 403 })
  }

  // 固定格集合：鎖課＋科任課
  const blocked = new Set<string>(Object.keys(config.lockCells[classKey] ?? {}))
  for (const p of plan.placed ?? []) {
    if (p.classKey !== classKey) continue
    blocked.add(`${p.day}-${p.period}`)
    if (p.size === 2) blocked.add(`${p.day}-${p.period + 1}`)
  }
  const [g] = classKey.split('-').map(Number)
  const grid = config.bands[bandOf(g)]
  const teachable = new Set<string>()
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) {
    if (grid.teachable[`${d}-${p}`]) teachable.add(`${d}-${p}`)
  }

  const breakdown = homeroomBreakdown(allocRow?.data as TeacherAllocation | null)
  const clean: Record<string, string> = {}
  const counts: Record<string, number> = {}
  for (const [slot, subj] of Object.entries(cells as Record<string, unknown>)) {
    const s = String(subj)
    if (!teachable.has(slot)) return NextResponse.json({ error: `${slot} 不是可排課時段` }, { status: 400 })
    if (blocked.has(slot)) return NextResponse.json({ error: `${slot} 已有科任課或鎖課` }, { status: 400 })
    if (!(s in breakdown)) return NextResponse.json({ error: `「${s}」不在您的配課科目中` }, { status: 400 })
    clean[slot] = s
    counts[s] = (counts[s] ?? 0) + 1
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
