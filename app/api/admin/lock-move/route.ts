import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeScheduleConfig, bandOf, classLabel, DAY_LABEL } from '@/lib/scheduling'
import { hasPerms } from '@/lib/staff-server'
import { createPlanVersion } from '@/lib/schedule-version-server'

/** 移動鎖課：把某班的一格鎖課換到另一格。
 *  目標格若已有科任課，就和鎖課「對調」——鎖課讓出來的那一格正好給那堂課去，
 *  所以不需要另外找空白格。設定與課表一次寫完，中途失敗整個停下，
 *  免得停在「解鎖了但還沒鎖回去」這種沒人看得懂的狀態。 */

type Lesson = {
  id: string; classKey: string; classLabel?: string; subject: string
  teacherId: string; teacherName?: string; day: number; period: number; size: number
  parity?: string; roomId?: string | null; coTeacherId?: string
}
const spans = (q: Lesson) => Array.from({ length: q.size }, (_, k) => `${q.day}-${q.period + k}`)
const zh = (s: string) => `${DAY_LABEL[Number(s.split('-')[0])]}第${s.split('-')[1]}節`

async function guard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await hasPerms(user.id, ['schedule-config', 'schedule-wizard']))) return null
  return user
}

/** 這次移動會遇到什麼：目標格上的課、能不能對調、本土語場次的影響。 */
async function inspect(year: number, ck: string, from: string, to: string) {
  const [{ data: schRow }, { data: planRow }, { data: hrRow }] = await Promise.all([
    supabaseAdmin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    supabaseAdmin.from('schedule_plan').select('plan, generated_at').eq('year', year).maybeSingle(),
    supabaseAdmin.from('schedule_homeroom').select('cells, confirmed_at').eq('year', year).eq('class_key', ck).maybeSingle(),
  ])
  if (!schRow?.config) throw new Error('找不到排課設定')
  const config = normalizeScheduleConfig(schRow.config)
  const plan = (planRow?.plan ?? {}) as { placed?: Lesson[] }
  const placed = plan.placed ?? []
  const [g, i] = ck.split('-').map(Number)
  const grid = config.bands[bandOf(g)]

  const lockId = config.lockCells[ck]?.[from]
  if (!lockId) throw new Error(`${classLabel(g, i)} ${zh(from)} 不是鎖課格`)
  if (config.lockCells[ck]?.[to]) throw new Error(`${classLabel(g, i)} ${zh(to)} 已經是鎖課格`)
  if (!grid.teachable[to]) throw new Error(`${classLabel(g, i)} ${zh(to)} 是不排課時段`)

  const lockType = config.lockTypes.find(t => t.id === lockId)
  const hrCells = (hrRow?.cells ?? {}) as Record<string, string>
  // 導師填在目標格的內容，一樣走「對調」——搬到鎖課讓出來的那一格。
  // 硬擋的話課務組得打電話請導師清格、等他改完再回來，而結果幾乎都是「搬過去就好」。
  // 導師那張沒重新整理的頁面存檔時會被整筆擋下（他的 cells 逐格驗證），
  // 所以不會靜默蓋掉這裡的變更，只是他要重整一次。
  const hrMoved = hrCells[to] ?? null

  // 目標格上的課
  const sitting = placed.find(q => q.classKey === ck && q.day > 0 && spans(q).includes(to))
  const problems: string[] = []
  if (hrMoved && hrCells[from]) problems.push(`${zh(from)} 導師也填了「${hrCells[from]}」，兩格都有內容無法對調`)
  if (hrMoved && sitting) problems.push(`${zh(to)} 同時有科任課與導師課，資料不一致，請先處理`)
  if (sitting && sitting.size > 1) problems.push(`${zh(to)} 是「${sitting.subject}」的連堂，整塊佔兩節，不能和單格鎖課對調`)
  if (sitting && sitting.size === 1) {
    // 那堂課要搬到 from：它的老師、外師、教室在 from 都得有空
    const others = placed.filter(q => q !== sitting && q.day > 0)
    const busyAt = (pred: (q: Lesson) => boolean) => others.find(q => pred(q) && spans(q).includes(from))
    for (const tid of [sitting.teacherId, ...(sitting.coTeacherId ? [sitting.coTeacherId] : [])]) {
      const clash = busyAt(q => q.teacherId === tid || q.coTeacherId === tid)
      if (clash) problems.push(`${sitting.teacherName ?? ''} ${zh(from)} 已在 ${clash.classLabel ?? ''}，${sitting.subject} 搬不過去`)
    }
    if (sitting.roomId) {
      const clash = busyAt(q => q.roomId === sitting.roomId)
      if (clash) problems.push(`${sitting.subject} 用的教室 ${zh(from)} 被 ${clash.classLabel ?? ''} 占用`)
    }
  }
  // 本土語：目標時段是不是該年級既有的場次
  let native: { newSession: boolean; sameGradeSlots: string[] } | null = null
  if (lockType?.isNative) {
    const nativeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
    const slots = new Set<string>()
    for (const [ck2, cells] of Object.entries(config.lockCells)) {
      if (Number(ck2.split('-')[0]) !== g || ck2 === ck) continue
      for (const [s, tid] of Object.entries(cells)) if (nativeIds.has(tid)) slots.add(s)
    }
    native = { newSession: !slots.has(to), sameGradeSlots: [...slots].sort() }
  }
  return {
    classLabel: classLabel(g, i), lockLabel: lockType?.label || lockType?.subject || '鎖課',
    from, to, problems, hrMoved,
    hrConfirmed: Boolean((hrRow as { confirmed_at?: string | null } | null)?.confirmed_at),
    hrCells,
    sitting: sitting ? { id: sitting.id, subject: sitting.subject, teacherName: sitting.teacherName ?? '', size: sitting.size } : null,
    native, generatedAt: planRow?.generated_at ?? null,
    config: schRow.config, plan, lockId,
  }
}

export async function GET(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const p = request.nextUrl.searchParams
  const year = Number(p.get('year')), ck = p.get('classKey') ?? '', from = p.get('from') ?? '', to = p.get('to') ?? ''
  if (!Number.isInteger(year) || !ck || !from || !to) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })
  try {
    const r = await inspect(year, ck, from, to)
    return NextResponse.json({ ...r, config: undefined, plan: undefined, hrCells: undefined })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '檢查失敗' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const user = await guard()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { year, classKey: ck, from, to } = await request.json()
  if (!Number.isInteger(Number(year)) || !ck || !from || !to) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })
  const yr = Number(year)
  let r: Awaited<ReturnType<typeof inspect>>
  try { r = await inspect(yr, ck, from, to) } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '檢查失敗' }, { status: 400 })
  }
  if (r.problems.length) return NextResponse.json({ error: r.problems.join('；'), problems: r.problems }, { status: 409 })

  // ① 課表：目標格上的課搬到鎖課讓出來的那一格（先寫課表——它有樂觀鎖，被搶先就整個不做）
  if (r.sitting) {
    const [d, p] = String(from).split('-').map(Number)
    const plan = r.plan as { placed?: Lesson[]; adjustments?: { at: string; desc: string }[] }
    const next = (plan.placed ?? []).map(q => q.id === r.sitting!.id ? { ...q, day: d, period: p } : q)
    const now = new Date().toISOString()
    const nextPlan = { ...plan, placed: next, adjustments: [...(plan.adjustments ?? []),
      { at: now, desc: `移動鎖課 ${r.classLabel} ${r.lockLabel} ${zh(from)}→${zh(to)}，${r.sitting.subject} 對調到 ${zh(from)}` }] }
    const { data: ok } = await supabaseAdmin.from('schedule_plan')
      .update({ plan: nextPlan, generated_at: now })
      .eq('year', yr).eq('generated_at', r.generatedAt as string).select('generated_at')
    if (!ok?.length) return NextResponse.json({ error: '課表在你操作期間被別人改過了，請重新整理再試一次。' }, { status: 409 })
    // 版本快照：課表變了就要留下一張相片，否則版本紀錄會對不上目前的課表
    await createPlanVersion({
      year: yr, plan: nextPlan as never, userId: user.id, inherit: true, source: 'manual',
      label: `移動鎖課（${r.classLabel} ${r.lockLabel}）`,
    })
  }
  // ② 導師課：填在目標格的內容搬到鎖課讓出來的那一格
  if (r.hrMoved) {
    const cells = { ...(r.hrCells as Record<string, string>) }
    delete cells[to]
    cells[from] = r.hrMoved
    const { error } = await supabaseAdmin.from('schedule_homeroom')
      .update({ cells, updated_at: new Date().toISOString() })
      .eq('year', yr).eq('class_key', ck)
    if (error) return NextResponse.json({ error: `導師課搬移失敗：${error.message}` }, { status: 500 })
  }
  // ③ 設定：鎖課換格
  const raw = r.config as Record<string, unknown>
  const lockCells = { ...((raw.lockCells ?? {}) as Record<string, Record<string, string>>) }
  const cells = { ...(lockCells[ck] ?? {}) }
  delete cells[from]
  cells[to] = r.lockId as string
  lockCells[ck] = cells
  const { error } = await supabaseAdmin.from('schedule_config').update({ config: { ...raw, lockCells } }).eq('year', yr)
  if (error) return NextResponse.json({ error: `設定寫入失敗：${error.message}（課表已改，請重試或手動修正）` }, { status: 500 })
  return NextResponse.json({ ok: true, moved: r.sitting?.subject ?? null, hrMoved: r.hrMoved, hrConfirmed: r.hrConfirmed, native: r.native })
}
