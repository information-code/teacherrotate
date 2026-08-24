import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'
import { VIRTUAL_EMAIL_DOMAIN } from '@/lib/utils'
import { defaultTeacherAllocation, type TeacherAllocation } from '@/lib/allocation'
import { normalizeScheduleConfig, HOMEROOM_SELF, classLabel } from '@/lib/scheduling'
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
  const lessons = mine.map(p => `${p.classLabel ?? ''} ${p.subject ?? ''}`)
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
    lessons: Array.from(new Set(lessons)).slice(0, 12),
    classes: Array.from(new Set(classes)).slice(0, 12),
  }
}

/** GET ?id=&year=：拆分對話框要的資料——這個帳號的配課、擋住拆分的東西、可併入的既有帳號。 */
export async function GET(request: NextRequest) {
  const admin = await guard()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = request.nextUrl.searchParams.get('id') ?? ''
  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!id || !Number.isInteger(year)) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })

  const { data: me } = await admin.from('profiles').select('id, name, email, employment_type').eq('id', id).maybeSingle()
  if (!me) return NextResponse.json({ error: '帳號不存在' }, { status: 404 })
  if (!me.email?.endsWith(VIRTUAL_EMAIL_DOMAIN)) return NextResponse.json({ error: '只有待聘帳號可以拆分' }, { status: 400 })

  const [{ data: alloc }, { data: others }, blockers] = await Promise.all([
    admin.from('allocation').select('data').eq('teacher_id', id).eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name, email').in('role', ['teacher', 'admin']).order('name'),
    blockersOf(admin, id, year),
  ])
  const d = (alloc?.data ?? null) as TeacherAllocation | null
  return NextResponse.json({
    id, name: me.name, email: me.email, employmentType: me.employment_type,
    hours: (d?.subjectGradeHours ?? {}) as Hours,
    blockers,
    candidates: (others ?? [])
      .filter(p => p.id !== id && !String(p.email ?? '').endsWith(VIRTUAL_EMAIL_DOMAIN))
      .map(p => ({ id: p.id, name: p.name, email: p.email })),
  })
}

const sumOf = (h: Hours) => Object.values(h ?? {}).reduce((s, byG) => s + Object.values(byG ?? {}).reduce((t, v) => t + (Number(v) || 0), 0), 0)

/** 把一份配課節數加進既有配課（既有帳號可能本來就有別的課，不能整份覆蓋）。 */
function addHours(base: TeacherAllocation | null, share: Hours, template: TeacherAllocation): TeacherAllocation {
  const d: TeacherAllocation = base ? { ...base } : { ...template, subjectGradeHours: {} }
  const sgh: Hours = { ...(d.subjectGradeHours ?? {}) }
  for (const [subj, byG] of Object.entries(share)) {
    const cur: Record<string, number> = { ...(sgh[subj] ?? {}) }
    for (const [g, n] of Object.entries(byG)) if (Number(n) > 0) cur[g] = (Number(cur[g]) || 0) + Number(n)
    if (Object.keys(cur).length) sgh[subj] = cur
  }
  d.subjectGradeHours = sgh
  return d
}

/** POST：把一個待聘帳號拆成兩位老師，同時寫好各自的配課。
 *  body: { id, year, a: {mode:'convert'|'merge', email, name?}, b: {mode:'create'|'merge', email, name?}, hours: {a, b} } */
export async function POST(request: NextRequest) {
  const admin = await guard()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, year, a, b, hours } = await request.json()
  if (!id || !Number.isInteger(Number(year))) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })
  const yr = Number(year)

  const { data: me } = await admin.from('profiles').select('id, name, email, role, employment_type').eq('id', id).maybeSingle()
  if (!me) return NextResponse.json({ error: '帳號不存在' }, { status: 404 })
  if (!me.email?.endsWith(VIRTUAL_EMAIL_DOMAIN)) return NextResponse.json({ error: '只有待聘帳號可以拆分' }, { status: 400 })

  // 有課表引用就擋下：拆分只分配課，分不了「哪幾堂歸誰」
  const blockers = await blockersOf(admin, id, yr)
  if (blockers.lessonHours > 0 || blockers.classes.length > 0) {
    return NextResponse.json({
      error: `這個帳號還有課表引用，不能拆分：${blockers.lessonHours ? `課表上已排 ${blockers.lessonHours} 節` : ''}`
        + `${blockers.lessonHours && blockers.classes.length ? '、' : ''}${blockers.classes.length ? `已指派 ${blockers.classes.length} 筆配班` : ''}`
        + '。請先在排課工具處理掉，再回來拆分。',
      blockers,
    }, { status: 409 })
  }

  const { data: allocRow } = await admin.from('allocation').select('data').eq('teacher_id', id).eq('year', yr).maybeSingle()
  const src = (allocRow?.data ?? null) as TeacherAllocation | null
  const orig = (src?.subjectGradeHours ?? {}) as Hours
  const hA = (hours?.a ?? {}) as Hours, hB = (hours?.b ?? {}) as Hours

  // 分配不可超過原本的節數（少於是允許的——真老師節數本來就可能對不上）
  for (const [subj, byG] of Object.entries(orig)) {
    for (const [g, n] of Object.entries(byG)) {
      const used = (Number(hA[subj]?.[g]) || 0) + (Number(hB[subj]?.[g]) || 0)
      if (used > Number(n)) return NextResponse.json({ error: `「${subj}」${g} 年級分配了 ${used} 節，超過原本的 ${n} 節` }, { status: 400 })
    }
  }
  for (const h of [hA, hB]) for (const [subj, byG] of Object.entries(h)) for (const g of Object.keys(byG)) {
    if (!(Number(orig[subj]?.[g]) > 0) && Number(byG[g]) > 0) return NextResponse.json({ error: `「${subj}」${g} 年級原本沒有配課，不能分配` }, { status: 400 })
  }

  const template = (src ?? defaultTeacherAllocation('subject', '', null)) as TeacherAllocation
  const emailA = String(a?.email ?? '').trim().toLowerCase()
  const emailB = String(b?.email ?? '').trim().toLowerCase()
  if (!emailA || !emailB) return NextResponse.json({ error: '兩邊的 Email 都要填' }, { status: 400 })
  if (emailA === emailB) return NextResponse.json({ error: '兩邊不能是同一個人' }, { status: 400 })

  /** 解析一邊要落到哪個帳號；回傳 profile id。 */
  const resolve = async (side: { mode: string; email: string; name?: string }, share: Hours, isSelf: boolean) => {
    const email = side.email.trim().toLowerCase()
    if (isSelf && side.mode === 'convert') {
      // 待聘帳號本人轉正：ID 不變，配課直接改成這一份
      const { error } = await admin.from('profiles').update({ email, ...(side.name?.trim() ? { name: side.name.trim() } : {}) }).eq('id', id)
      if (error) throw new Error(`轉正失敗：${error.message}`)
      const next: TeacherAllocation = { ...template, subjectGradeHours: share }
      const { error: e2 } = await admin.from('allocation').upsert({ year: yr, teacher_id: id, data: next as never }, { onConflict: 'year,teacher_id' })
      if (e2) throw new Error(`配課寫入失敗：${e2.message}`)
      return id
    }
    if (side.mode === 'merge') {
      const { data: t } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
      if (!t) throw new Error(`找不到 Email 為 ${email} 的既有帳號`)
      if (t.id === id) throw new Error('不可併到待聘帳號自己')
      const { data: cur } = await admin.from('allocation').select('data').eq('teacher_id', t.id).eq('year', yr).maybeSingle()
      const next = addHours((cur?.data ?? null) as TeacherAllocation | null, share, template)
      const { error } = await admin.from('allocation').upsert({ year: yr, teacher_id: t.id, data: next as never }, { onConflict: 'year,teacher_id' })
      if (error) throw new Error(`配課寫入失敗：${error.message}`)
      return t.id
    }
    // 新建帳號
    const { data: dup } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
    if (dup) throw new Error(`Email ${email} 已存在，請改選「併到既有帳號」`)
    const newId = randomUUID()
    const { error } = await admin.from('profiles').insert({
      id: newId, email, name: (side.name ?? '').trim() || email.split('@')[0],
      role: 'teacher', employment_type: me.employment_type ?? 'substitute',
    })
    if (error) throw new Error(`建立帳號失敗：${error.message}`)
    const next: TeacherAllocation = { ...template, subjectGradeHours: share }
    const { error: e2 } = await admin.from('allocation').upsert({ year: yr, teacher_id: newId, data: next as never }, { onConflict: 'year,teacher_id' })
    if (e2) throw new Error(`配課寫入失敗：${e2.message}`)
    return newId
  }

  try {
    const idA = await resolve({ mode: a?.mode ?? 'convert', email: emailA, name: a?.name }, hA, true)
    const idB = await resolve({ mode: b?.mode ?? 'create', email: emailB, name: b?.name }, hB, false)
    // 甲若是併到既有帳號，待聘帳號本身就沒有存在的必要了（此時已確認沒有任何課表引用）
    if ((a?.mode ?? 'convert') === 'merge') {
      await admin.from('allocation').delete().eq('teacher_id', id)
      const { error } = await admin.from('profiles').delete().eq('id', id)
      if (error) throw new Error(`刪除待聘帳號失敗：${error.message}`)
    }
    const dropped = sumOf(orig) - sumOf(hA) - sumOf(hB)
    return NextResponse.json({ ok: true, idA, idB, dropped })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '拆分失敗' }, { status: 500 })
  }
}
