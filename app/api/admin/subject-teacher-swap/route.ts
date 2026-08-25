import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  normalizeScheduleConfig, deriveNativeSessions, subjectClassKey, classKey, classLabel,
  DAY_LABEL, HOMEROOM_SELF,
} from '@/lib/scheduling'
import { normalizeConfig, type TeacherAllocation } from '@/lib/allocation'
import { hasPerms } from '@/lib/staff-server'
import { createPlanVersion } from '@/lib/schedule-version-server'

/** 換授課老師：把某班某科在課表上的課，整批換成另一位老師。
 *  上課時間、班級、教室都不動，只換人——所以不必重跑排課。
 *  設定（科任配班）和課表一次寫完：只改設定的話，課表還是印著舊老師，
 *  而課表才是全校在看的那一份。 */

type Lesson = {
  id: string; classKey: string; classLabel?: string; subject: string
  teacherId: string; teacherName?: string; day: number; period: number; size: number
  parity?: string; roomId?: string | null; coTeacherId?: string
}
const spans = (q: { day: number; period: number; size: number }) =>
  Array.from({ length: Math.max(1, q.size) }, (_, k) => `${q.day}-${q.period + k}`)
const zh = (s: string) => `${DAY_LABEL[Number(s.split('-')[0])]}第${s.split('-')[1]}節`
/** 只有「單週 vs 雙週」錯得開；其餘（含一般課的 'weekly'）都算撞在一起。
 *  parity 的值域是 'weekly' | 'odd' | 'even'——weekly 是每週都上，會和單週、雙週都撞。 */
const overlaps = (a?: string, b?: string) =>
  !((a === 'odd' && b === 'even') || (a === 'even' && b === 'odd'))

async function guard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await hasPerms(user.id, ['schedule-config', 'schedule-wizard']))) return null
  return user
}

async function inspect(year: number, grade: number, index: number, subject: string, toId: string) {
  const [{ data: schRow }, { data: planRow }, { data: cfgRow }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    supabaseAdmin.from('schedule_plan').select('plan, generated_at').eq('year', year).maybeSingle(),
    supabaseAdmin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    supabaseAdmin.from('profiles').select('id, name').neq('status', 'inactive'),
  ])
  if (!schRow?.config) throw new Error('找不到排課設定')
  const config = normalizeScheduleConfig(schRow.config)
  const nameOf = (id: string) => (profiles ?? []).find(p => p.id === id)?.name ?? '？'
  const plan = (planRow?.plan ?? {}) as { placed?: Lesson[]; adjustments?: { at: string; desc: string }[] }
  const placed = plan.placed ?? []
  const ck = classKey(grade, index)

  // 這一班這一科在課表上的課
  const mine = placed.filter(q => q.classKey === ck && q.subject === subject && q.day > 0)
    .sort((a, b) => a.day - b.day || a.period - b.period)
  const fromIds = Array.from(new Set(mine.map(q => q.teacherId)))
  const problems: string[] = []
  const notes: string[] = []

  if (mine.length && toId && toId !== HOMEROOM_SELF) {
    // ── 新老師在這些時段有沒有空 ──
    const busy = new Map<string, { what: string; parity?: string }>()
    const mark = (slot: string, what: string, parity?: string) => { if (!busy.has(slot)) busy.set(slot, { what, parity }) }

    // (1) 課表上的其他課（含掛外師）
    const mineIds = new Set(mine.map(q => q.id))
    for (const q of placed) {
      if (mineIds.has(q.id) || q.day <= 0) continue
      if (q.teacherId !== toId && q.coTeacherId !== toId) continue
      for (const s of spans(q)) mark(s, `${q.classLabel ?? ''} ${q.subject}`, q.parity)
    }
    // (2) 本土語：原班（該班本土語指派給他）
    const nativeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
    for (const [ck2, cells] of Object.entries(config.lockCells)) {
      const [g2, i2] = ck2.split('-').map(Number)
      if (config.subjectClassTeacher[subjectClassKey(g2, i2, '本土語')] !== toId) continue
      for (const [s, tid] of Object.entries(cells)) if (nativeIds.has(tid)) mark(s, `${classLabel(g2, i2)} 本土語`)
    }
    // (3) 本土語：語別課推導場次
    try {
      const alloc = normalizeConfig(cfgRow?.config)
      const extraNames = new Set(alloc.extraCourses.map(c => c.lang).filter(Boolean))
      const ids = (profiles ?? []).map(p => p.id)
      const { data: allocs } = ids.length
        ? await supabaseAdmin.from('allocation').select('teacher_id, data').eq('year', year).in('teacher_id', ids)
        : { data: [] as { teacher_id: string; data: TeacherAllocation }[] }
      const hoursByTeacher: Record<string, Record<string, Record<string, number>>> = {}
      for (const a of allocs ?? []) {
        const sgh = (a.data as TeacherAllocation | null)?.subjectGradeHours ?? {}
        for (const [subj, byGrade] of Object.entries(sgh)) {
          if (!extraNames.has(subj)) continue
          ;(hoursByTeacher[a.teacher_id] ??= {})[subj] = byGrade as Record<string, number>
        }
      }
      const { sessions } = deriveNativeSessions({ config, extraCourses: alloc.extraCourses, hoursByTeacher })
      for (const sn of sessions) if (sn.teacherId === toId) mark(sn.slot, `本土語（${sn.lang}）`)
    } catch { /* 語別課推不出來就算了，不擋主流程 */ }
    // (4) 個人不排課
    const off: string[] = [], only: string[] = []
    for (const p of config.personalOff) {
      if (p.teacherId !== toId) continue
      ;(p.mode === 'on' ? only : off).push(...p.slots)
    }

    for (const q of mine) for (const s of spans(q)) {
      const b = busy.get(s)
      if (b && overlaps(q.parity, b.parity)) problems.push(`${nameOf(toId)} ${zh(s)} 已在 ${b.what}`)
      else if (off.includes(s)) problems.push(`${nameOf(toId)} ${zh(s)} 是他的不排課時段`)
      else if (only.length && !only.includes(s)) problems.push(`${nameOf(toId)} ${zh(s)} 不在他可排課的時段內`)
    }
  }
  if (toId === HOMEROOM_SELF && mine.length) {
    notes.push('改成「導師自上」不會刪掉課表上這幾堂——請到排課精靈的人工調課處理。')
  }
  if (!toId && mine.length) {
    notes.push('改成「隨機」只影響下次重跑排課，課表上這幾堂維持原老師。')
  }

  return {
    classLabel: classLabel(grade, index), subject,
    fromNames: fromIds.map(nameOf), toName: toId && toId !== HOMEROOM_SELF ? nameOf(toId) : '',
    lessons: mine.map(q => ({ id: q.id, slots: spans(q), size: q.size, parity: q.parity ?? '', teacherName: q.teacherName ?? nameOf(q.teacherId) })),
    problems: Array.from(new Set(problems)), notes,
    canSync: Boolean(mine.length && toId && toId !== HOMEROOM_SELF && !fromIds.every(x => x === toId)),
    generatedAt: planRow?.generated_at ?? null,
    _config: schRow.config, _plan: plan, _toName: toId ? nameOf(toId) : '',
  }
}

export async function GET(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const p = request.nextUrl.searchParams
  const year = Number(p.get('year')), grade = Number(p.get('grade')), index = Number(p.get('index'))
  const subject = p.get('subject') ?? '', to = p.get('to') ?? ''
  if (!Number.isInteger(year) || !Number.isInteger(grade) || !Number.isInteger(index) || !subject)
    return NextResponse.json({ error: '參數錯誤' }, { status: 400 })
  try {
    const r = await inspect(year, grade, index, subject, to)
    return NextResponse.json({ ...r, _config: undefined, _plan: undefined, _toName: undefined })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '檢查失敗' }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const user = await guard()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { year, grade, index, subject, to } = await request.json()
  const yr = Number(year), g = Number(grade), i = Number(index)
  if (!Number.isInteger(yr) || !Number.isInteger(g) || !Number.isInteger(i) || !subject || !to)
    return NextResponse.json({ error: '參數錯誤' }, { status: 400 })

  let r: Awaited<ReturnType<typeof inspect>>
  try { r = await inspect(yr, g, i, String(subject), String(to)) } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '檢查失敗' }, { status: 400 })
  }
  if (r.problems.length) return NextResponse.json({ error: r.problems.join('；'), problems: r.problems }, { status: 409 })
  if (!r.canSync) return NextResponse.json({ error: '這一班這一科在課表上沒有要換的課' }, { status: 400 })

  // ① 課表（有樂觀鎖，被搶先就整個不做）
  const ids = new Set(r.lessons.map(l => l.id))
  const plan = r._plan
  const now = new Date().toISOString()
  const next = (plan.placed ?? []).map(q => ids.has(q.id) ? { ...q, teacherId: String(to), teacherName: r._toName } : q)
  const nextPlan = {
    ...plan, placed: next,
    adjustments: [...(plan.adjustments ?? []),
      { at: now, desc: `換授課老師 ${r.classLabel} ${r.subject} ${r.fromNames.join('、')}→${r._toName}（${r.lessons.length} 堂）` }],
  }
  const { data: ok } = await supabaseAdmin.from('schedule_plan')
    .update({ plan: nextPlan, generated_at: now })
    .eq('year', yr).eq('generated_at', r.generatedAt as string).select('generated_at')
  if (!ok?.length) return NextResponse.json({ error: '課表在你操作期間被別人改過了，請重新整理再試一次。' }, { status: 409 })

  // 版本快照：課表變了就要留下一張相片，否則版本紀錄會對不上目前的課表
  const ver = await createPlanVersion({
    year: yr, plan: nextPlan as never, userId: user.id, inherit: true, source: 'manual',
    label: `換授課老師（${r.classLabel} ${r.subject}）`,
  })

  // ② 設定：科任配班
  const raw = r._config as Record<string, unknown>
  const map = { ...((raw.subjectClassTeacher ?? {}) as Record<string, string>) }
  map[subjectClassKey(g, i, String(subject))] = String(to)
  const { error } = await supabaseAdmin.from('schedule_config')
    .update({ config: { ...raw, subjectClassTeacher: map } }).eq('year', yr)
  if (error) return NextResponse.json({ error: `設定寫入失敗：${error.message}（課表已改，請重試）`, planAt: now }, { status: 500 })

  return NextResponse.json({ ok: true, count: r.lessons.length, toName: r._toName, planAt: now, version: 'error' in ver ? null : ver.seq })
}
