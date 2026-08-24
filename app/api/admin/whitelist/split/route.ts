import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'
import { VIRTUAL_EMAIL_DOMAIN } from '@/lib/utils'
import { defaultTeacherAllocation, normalizeConfig, GRADES, type TeacherAllocation } from '@/lib/allocation'
import { normalizeScheduleConfig, HOMEROOM_SELF, classLabel, subjectClassKey } from '@/lib/scheduling'
import { hasPerms } from '@/lib/staff-server'

type Hours = Record<string, Record<string, number>>

async function guard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await hasPerms(user.id, ['whitelist']))) return null
  return getAdminClient()
}

/** 這個待聘帳號有沒有「拆分處理不了」的東西：課表上已排的課、被指到的班。
 *  拆分只分配課；一旦有這些引用，系統無從得知哪幾堂／哪幾班該歸誰，只能請人先處理掉。 */
async function blockersOf(admin: ReturnType<typeof getAdminClient>, id: string, year: number) {
  const [{ data: planRow }, { data: schRow }] = await Promise.all([
    admin.from('schedule_plan').select('plan').eq('year', year).maybeSingle(),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
  ])
  const placed = ((planRow?.plan as { placed?: { teacherId?: string; coTeacherId?: string; classLabel?: string; subject?: string; size?: number }[] } | null)?.placed ?? [])
  const mine = placed.filter(p => p.teacherId === id || p.coTeacherId === id)
  const classes: string[] = []
  if (schRow?.config) {
    const cfg = normalizeScheduleConfig(schRow.config)
    for (const [k, v] of Object.entries(cfg.subjectClassTeacher)) {
      if (v !== id || v === HOMEROOM_SELF) continue
      const [ck, subject] = k.split('|')
      const [g, i] = ck.split('-').map(Number)
      classes.push(`${classLabel(g, i)} ${subject}`)
    }
    for (const [ck, tid] of Object.entries(cfg.classTeacher)) {
      if (tid !== id) continue
      const [g, i] = ck.split('-').map(Number)
      classes.push(`${classLabel(g, i)} 導師`)
    }
  }
  return {
    lessonHours: mine.reduce((s, p) => s + (p.size ?? 1), 0),
    lessons: Array.from(new Set(mine.map(p => `${p.classLabel ?? ''} ${p.subject ?? ''}`))).slice(0, 12),
    classes: Array.from(new Set(classes)).slice(0, 12),
  }
}

/** GET ?id=&year=：拆分對話框要的資料。 */
export async function GET(request: NextRequest) {
  const admin = await guard()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = request.nextUrl.searchParams.get('id') ?? ''
  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!id || !Number.isInteger(year)) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })

  const { data: me } = await admin.from('profiles').select('id, name, email, employment_type').eq('id', id).maybeSingle()
  if (!me) return NextResponse.json({ error: '帳號不存在' }, { status: 404 })
  if (!me.email?.endsWith(VIRTUAL_EMAIL_DOMAIN)) return NextResponse.json({ error: '只有待聘帳號可以拆分' }, { status: 400 })

  const [{ data: alloc }, { data: others }, blockers, { data: schRow }, { data: acRow }] = await Promise.all([
    admin.from('allocation').select('data').eq('teacher_id', id).eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name, email').in('role', ['teacher', 'admin']).order('name'),
    blockersOf(admin, id, year),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
  ])
  const d = (alloc?.data ?? null) as TeacherAllocation | null
  const hours = (d?.subjectGradeHours ?? {}) as Hours
  // 拆出去的節數要對應到「哪幾個班」——把各年級還沒指派老師的班列出來給人挑。
  // 每班節數（perClass）決定 N 節等於幾個班：本土語每班 1 節，所以 2 節＝2 班。
  const cfg = schRow?.config ? normalizeScheduleConfig(schRow.config) : null
  const alc = acRow?.config ? normalizeConfig(acRow.config) : null
  const perClass: Record<string, number> = {}
  const openClasses: Record<string, { ck: string; label: string }[]> = {}   // `科目|年級` → 可指派的班
  if (cfg && alc) {
    for (const subj of Object.keys(hours)) {
      for (const g of GRADES) {
        const def = alc.grades[g].subjects.find(x => x.name === subj)
        if (!def) continue
        perClass[subj] = def.perClass
        const list: { ck: string; label: string }[] = []
        for (let i = 0; i < alc.grades[g].classCount; i++) {
          const cur = cfg.subjectClassTeacher[subjectClassKey(g, i, subj)]
          if (!cur || cur === HOMEROOM_SELF || cur === id) list.push({ ck: `${g}-${i}`, label: classLabel(g, i) })
        }
        openClasses[`${subj}|${g}`] = list
      }
    }
  }
  return NextResponse.json({
    id, name: me.name, email: me.email,
    hours, perClass, openClasses,
    blockers,
    candidates: (others ?? [])
      .filter(p => p.id !== id && !String(p.email ?? '').endsWith(VIRTUAL_EMAIL_DOMAIN))
      .map(p => ({ id: p.id, name: p.name, email: p.email })),
  })
}

const sumOf = (h: Hours) => Object.values(h ?? {}).reduce((s, byG) => s + Object.values(byG ?? {}).reduce((t, v) => t + (Number(v) || 0), 0), 0)

/** POST：從待聘帳號拆一塊配課出去給某位老師，其餘留在待聘帳號繼續找人。
 *  找到人是陸續發生的，所以這個動作可以重複做——每找到一位就拆一次。
 *  body: { id, year, to: {mode:'create'|'merge', email, name?}, hours: {科目:{年級:節數}} } */
export async function POST(request: NextRequest) {
  const admin = await guard()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, year, to, hours, classes } = await request.json()
  if (!id || !Number.isInteger(Number(year))) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })
  const yr = Number(year)

  const { data: me } = await admin.from('profiles').select('id, name, email, employment_type').eq('id', id).maybeSingle()
  if (!me) return NextResponse.json({ error: '帳號不存在' }, { status: 404 })
  if (!me.email?.endsWith(VIRTUAL_EMAIL_DOMAIN)) return NextResponse.json({ error: '只有待聘帳號可以拆分' }, { status: 400 })

  // 有課表引用就擋下：拆分只分配課，分不了「哪幾堂歸誰」
  const blockers = await blockersOf(admin, id, yr)
  if (blockers.lessonHours > 0 || blockers.classes.length > 0) {
    return NextResponse.json({
      error: '這個帳號在課表上已經有排定的課或指派的班，不能拆分——系統無從得知哪幾堂該歸誰。請先在排課工具處理掉再回來。',
      blockers,
    }, { status: 409 })
  }

  const { data: allocRow } = await admin.from('allocation').select('data').eq('teacher_id', id).eq('year', yr).maybeSingle()
  const src = (allocRow?.data ?? null) as TeacherAllocation | null
  const orig = (src?.subjectGradeHours ?? {}) as Hours
  const take = (hours ?? {}) as Hours
  if (sumOf(take) <= 0) return NextResponse.json({ error: '沒有要拆出去的節數' }, { status: 400 })

  for (const [subj, byG] of Object.entries(take)) {
    for (const [g, n] of Object.entries(byG)) {
      const have = Number(orig[subj]?.[g]) || 0
      if (Number(n) > have) return NextResponse.json({ error: `「${subj}」${g} 年級只有 ${have} 節，拆不出 ${n} 節` }, { status: 400 })
    }
  }

  const email = String(to?.email ?? '').trim().toLowerCase()
  const name = String(to?.name ?? '').trim()
  if (!email) return NextResponse.json({ error: '請填真實老師的 Email' }, { status: 400 })
  const template = (src ?? defaultTeacherAllocation('subject', '', null)) as TeacherAllocation

  try {
    // ── 收下這一塊的老師 ──
    let targetId: string
    if (to?.mode === 'merge') {
      const { data: t } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
      if (!t) throw new Error(`找不到 Email 為 ${email} 的既有帳號`)
      if (t.id === id) throw new Error('不可併回待聘帳號自己')
      targetId = t.id
    } else {
      const { data: dup } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
      if (dup) throw new Error(`Email ${email} 已存在，請改選「併到既有帳號」`)
      targetId = randomUUID()
      const { error } = await admin.from('profiles').insert({
        id: targetId, email, name: name || email.split('@')[0],
        role: 'teacher', employment_type: me.employment_type ?? 'substitute',
      })
      if (error) throw new Error(`建立帳號失敗：${error.message}`)
    }
    // 併到既有帳號時是「把節數加進去」，不是整份覆蓋——對方本來就有的課不能被蓋掉
    const { data: cur } = await admin.from('allocation').select('data').eq('teacher_id', targetId).eq('year', yr).maybeSingle()
    const base = (cur?.data ?? null) as TeacherAllocation | null
    const next: TeacherAllocation = base ? { ...base } : { ...template, subjectGradeHours: {} }
    const sgh: Hours = { ...(next.subjectGradeHours ?? {}) }
    for (const [subj, byG] of Object.entries(take)) {
      const row: Record<string, number> = { ...(sgh[subj] ?? {}) }
      for (const [g, n] of Object.entries(byG)) if (Number(n) > 0) row[g] = (Number(row[g]) || 0) + Number(n)
      if (Object.keys(row).length) sgh[subj] = row
    }
    next.subjectGradeHours = sgh
    const { error: e1 } = await admin.from('allocation').upsert({ year: yr, teacher_id: targetId, data: next as never }, { onConflict: 'year,teacher_id' })
    if (e1) throw new Error(`老師的配課寫入失敗：${e1.message}`)

    // ── 待聘帳號扣掉拆出去的部分，其餘原地保留 ──
    const restH: Hours = {}
    for (const [subj, byG] of Object.entries(orig)) {
      const row: Record<string, number> = {}
      for (const [g, n] of Object.entries(byG)) {
        const left = Number(n) - (Number(take[subj]?.[g]) || 0)
        if (left > 0) row[g] = left
      }
      if (Object.keys(row).length) restH[subj] = row
    }
    const rest: TeacherAllocation = { ...(src ?? template), subjectGradeHours: restH }
    const { error: e2 } = await admin.from('allocation').upsert({ year: yr, teacher_id: id, data: rest as never }, { onConflict: 'year,teacher_id' })
    if (e2) throw new Error(`待聘帳號的配課更新失敗：${e2.message}`)

    // ── 科任配班：把挑好的班指給這位老師 ──
    // 節數只說「他上幾節」，沒說「上哪幾班」。不一起寫的話那幾節是懸空的，
    // 課表上那些班仍然顯示「直播共學」，而且配課與配班會對不起來。
    let assigned = 0
    const picks = (classes ?? {}) as Record<string, string[]>
    if (Object.keys(picks).length) {
      const { data: schRow } = await admin.from('schedule_config').select('config').eq('year', yr).maybeSingle()
      if (!schRow?.config) throw new Error('找不到排課設定')
      const raw = schRow.config as Record<string, unknown>
      const map: Record<string, string> = { ...((raw.subjectClassTeacher ?? {}) as Record<string, string>) }
      for (const [subj, cks] of Object.entries(picks)) {
        for (const ck of cks) {
          const [g, i] = ck.split('-').map(Number)
          const key = subjectClassKey(g, i, subj)
          const cur = map[key]
          if (cur && cur !== HOMEROOM_SELF && cur !== id) throw new Error(`${classLabel(g, i)} 的${subj}已經指派給別人了，請重新整理再試`)
          map[key] = targetId
          assigned++
        }
      }
      const { error: e3 } = await admin.from('schedule_config')
        .update({ config: { ...raw, subjectClassTeacher: map } }).eq('year', yr)
      if (e3) throw new Error(`科任配班寫入失敗：${e3.message}`)
    }
    return NextResponse.json({ ok: true, targetId, taken: sumOf(take), remaining: sumOf(restH), assigned })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '拆分失敗' }, { status: 500 })
  }
}
