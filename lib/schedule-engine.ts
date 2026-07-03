// 排課引擎：只排「科任課」。班級課表的留白＝導師自排空間。
// 三階段：組裝（assembleEngineInput）→ 建構＋局部搜尋（runEngine）→ 罰分明細報告。
// 硬限制：班/師/教室同時段唯一、年段可排時段、鎖課格、教師不排課、永不連 7（絕對 6 連）。
// 軟限制：權重設定（關/低/中/高＝0/1/3/9；必須＝1e6 大罰分，違反時列入報告但不卡死搜尋）。
// 週型（parity）：視藝單雙週連堂——班級格整週占用（另一週保留給導師），教師只占自己的週型，
// 故視藝老師可交錯服務單週組（起始節 1,3,5）與雙週組（起始節 2,4,6）。

import {
  SCHEDULE_DAYS, WEIGHT_PENALTY, HOMEROOM_SELF, LOCK_COLORS,
  bandOf, classKey as ck, classLabel, subjectClassKey, parseSlotKey, roomLabel,
  type ScheduleConfig, type ScheduleWeights, type WeightLevel, type TemplateRule,
} from './scheduling'

export type Parity = 'weekly' | 'odd' | 'even'

export interface EngineLesson {
  id: string
  classKey: string
  grade: number
  classLabel: string
  subject: string
  teacherId: string
  teacherName: string
  size: 1 | 2
  parity: Parity
}

export interface RoomInfo { id: string; label: string; subject: string; zone: number; index: number; zoneSize: number; ring: boolean }

export interface EngineInput {
  classes: { classKey: string; grade: number; label: string }[]
  lessons: EngineLesson[]
  classSlots: Record<string, string[]>       // classKey → 可放科任課的 slotKey（可排時段 − 鎖課格）
  classMustFill: Record<string, string[]>    // classKey → 必排科任課的格（導師不排課時段）
  classDayFull: Record<string, Record<number, boolean>>  // classKey → day → 是否整天日
  lockedCells: Record<string, Record<string, string>>    // classKey → slotKey → 顯示文字（鎖課科目）
  teacherBlocked: Record<string, string[]>   // 科任教師不可排時段
  teacherNames: Record<string, string>
  rooms: RoomInfo[]                          // 科任教室（有綁科目者參與容量/走動計算）
  classRoom: Record<string, { zone: number; index: number; zoneSize: number; ring: boolean } | null>
  weights: ScheduleWeights
  seed: number
}

export interface Placement { day: number; period: number }
export interface PlacedResult extends EngineLesson { day: number; period: number; roomId: string | null }
export interface UnplacedResult { lesson: EngineLesson; reason: string }
export interface RulePenalty { key: string; label: string; count: number; points: number; items: string[] }
export interface EngineResult {
  placed: PlacedResult[]
  unplaced: UnplacedResult[]
  penalties: RulePenalty[]
  totalPenalty: number
  uncoveredMustFill: { classKey: string; slot: string }[]
  iterations: number
  elapsedMs: number
}

export interface PreflightIssue { level: 'error' | 'warn'; text: string }

// ── 亂數（可重現） ──
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ══════════════════ 組裝 ══════════════════

export interface AssembleArgs {
  config: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, { name: string; perClass: number; homeroom: boolean }[]>
  gradeHomeroomBase: Record<number, number>
  teacherNames: Record<string, string>
  seed?: number
}

export function assembleEngineInput(a: AssembleArgs): { input: EngineInput; preflight: PreflightIssue[] } {
  const { config, classCounts, gradeSubjects } = a
  const preflight: PreflightIssue[] = []
  const classes: EngineInput['classes'] = []
  const classSlots: Record<string, string[]> = {}
  const classMustFill: Record<string, string[]> = {}
  const classDayFull: Record<string, Record<number, boolean>> = {}
  const lockedCells: Record<string, Record<string, string>> = {}
  const lessons: EngineLesson[] = []

  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const dblTemplates = config.weights.templates.filter(t => t.template === 'doublePeriod')
  const art = config.weights.builtin.artBiweekly

  // 個人不排課 → teacherId → slots（科任用於自身封鎖；導師用於班級 mustFill）
  const offByTeacher: Record<string, string[]> = {}
  for (const p of config.personalOff) {
    if (!p.teacherId) continue
    offByTeacher[p.teacherId] = [...(offByTeacher[p.teacherId] ?? []), ...p.slots]
  }

  for (const g of [1, 2, 3, 4, 5, 6]) {
    const count = classCounts[g] ?? 0
    if (count === 0) continue
    const grid = config.bands[bandOf(g)]
    const subjects = (gradeSubjects[g] ?? []).filter(s => s.perClass > 0)
    const gradeOff = config.gradeCommonOff[String(g)] ?? []

    for (let i = 0; i < count; i++) {
      const key = ck(g, i)
      classes.push({ classKey: key, grade: g, label: classLabel(g, i) })

      // 可用格＝年段可排 − 鎖課格
      const locks = config.lockCells[key] ?? {}
      const lockDisplay: Record<string, string> = {}
      for (const [slot, tid] of Object.entries(locks)) {
        const t = lockTypeMap[tid]
        lockDisplay[slot] = t ? (t.subject || t.label || '鎖') : '鎖'
      }
      lockedCells[key] = lockDisplay
      const slots: string[] = []
      const dayFull: Record<number, boolean> = {}
      for (const d of SCHEDULE_DAYS) {
        let maxP = 0
        for (let p = 1; p <= grid.periodsPerDay; p++) {
          if (!grid.teachable[`${d}-${p}`]) continue
          maxP = Math.max(maxP, p)
          if (!locks[`${d}-${p}`]) slots.push(`${d}-${p}`)
        }
        dayFull[d] = maxP >= 7
      }
      classSlots[key] = slots
      classDayFull[key] = dayFull

      // 必排科任課的格：學年共同不排課 ＋ 該班導師的個人不排課（限可用格內）
      const homeroomId = config.classTeacher[key] ?? ''
      const homeroomOff = homeroomId ? (offByTeacher[homeroomId] ?? []) : []
      const mustSet = new Set<string>()
      for (const s of [...gradeOff, ...homeroomOff]) if (slots.includes(s)) mustSet.add(s)
      classMustFill[key] = Array.from(mustSet)

      // 鎖課占用後扣科目需求
      const lockCountBySubject: Record<string, number> = {}
      for (const txt of Object.values(lockDisplay)) lockCountBySubject[txt] = (lockCountBySubject[txt] ?? 0) + 1

      // 展開科任課
      for (const s of subjects) {
        const assigned = config.subjectClassTeacher[subjectClassKey(g, i, s.name)] ?? ''
        if (!assigned || assigned === HOMEROOM_SELF) continue   // 未指派或導師自上 → 導師自排，不進引擎
        const teacherName = a.teacherNames[assigned] ?? '？'
        let hours = s.perClass - (lockCountBySubject[s.name] ?? 0)
        if (hours <= 0) continue

        const isArtBiweekly = art.enabled && s.name === '視覺藝術' && art.grades.includes(g)
        if (isArtBiweekly) {
          // 隔週連堂：占固定兩格（整週，另一週保留給導師），教師只占自己週型
          if (s.perClass !== 1) preflight.push({ level: 'warn', text: `${classLabel(g, i)} 視覺藝術每班 ${s.perClass} 節：單雙週連堂假設每週均攤 1 節，請確認配課設定。` })
          lessons.push({
            id: `${key}|${s.name}|bi`, classKey: key, grade: g, classLabel: classLabel(g, i),
            subject: s.name, teacherId: assigned, teacherName, size: 2,
            parity: i % 2 === 0 ? 'odd' : 'even',
          })
          continue
        }

        const wantsDouble = dblTemplates.some(t =>
          t.level !== 'off' && t.subjects.includes(s.name) && (t.grades.length === 0 || t.grades.includes(g)))
        let n = 0
        if (wantsDouble && hours >= 2) {
          lessons.push({
            id: `${key}|${s.name}|d`, classKey: key, grade: g, classLabel: classLabel(g, i),
            subject: s.name, teacherId: assigned, teacherName, size: 2, parity: 'weekly',
          })
          hours -= 2
        }
        while (hours > 0) {
          lessons.push({
            id: `${key}|${s.name}|s${n++}`, classKey: key, grade: g, classLabel: classLabel(g, i),
            subject: s.name, teacherId: assigned, teacherName, size: 1, parity: 'weekly',
          })
          hours--
        }
      }

      // 前置檢核：留白是否夠導師自排
      const lessonPeriods = lessons.filter(l => l.classKey === key).reduce((s2, l) => s2 + l.size, 0)
      const leftover = slots.length - lessonPeriods
      const base = a.gradeHomeroomBase[g] ?? 0
      if (leftover < 0) preflight.push({ level: 'error', text: `${classLabel(g, i)} 科任課共 ${lessonPeriods} 節，超過可排格數 ${slots.length}。` })
      else if (base > 0 && leftover < base) preflight.push({ level: 'warn', text: `${classLabel(g, i)} 留白 ${leftover} 格，少於導師基本授課 ${base} 節。` })
      if (mustSet.size > lessonPeriods) preflight.push({ level: 'error', text: `${classLabel(g, i)} 導師不排課時段 ${mustSet.size} 格，但科任課只有 ${lessonPeriods} 節，無法全部覆蓋。` })
      if (!homeroomId) preflight.push({ level: 'warn', text: `${classLabel(g, i)} 尚未指定導師。` })

      const unassigned = subjects.filter(s => {
        const v = config.subjectClassTeacher[subjectClassKey(g, i, s.name)] ?? ''
        return !v && !s.homeroom
      })
      if (unassigned.length) preflight.push({ level: 'warn', text: `${classLabel(g, i)} 未指派科任：${unassigned.map(s => s.name).join('、')}（將視為導師自排）。` })
    }
  }

  // 科任教師封鎖（只需引擎會用到的老師）
  const teacherIds = new Set(lessons.map(l => l.teacherId))
  const teacherBlocked: Record<string, string[]> = {}
  for (const id of Array.from(teacherIds)) teacherBlocked[id] = offByTeacher[id] ?? []

  // 教室
  const rooms: RoomInfo[] = []
  const classRoom: EngineInput['classRoom'] = {}
  config.roomZones.forEach((z, zi) => {
    z.rooms.forEach((r, ri) => {
      if (r.kind === 'subject' && r.subject) {
        rooms.push({ id: r.id, label: roomLabel(r) || r.subject, subject: r.subject, zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring })
      }
      if (r.kind === 'class' && r.classKey) {
        classRoom[r.classKey] = { zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring }
      }
    })
  })
  for (const c of classes) if (!(c.classKey in classRoom)) classRoom[c.classKey] = null

  if (lessons.length === 0) preflight.push({ level: 'error', text: '沒有任何科任課可排：請先完成科任配班（分頁 3）。' })

  return {
    input: {
      classes, lessons, classSlots, classMustFill, classDayFull, lockedCells,
      teacherBlocked, teacherNames: a.teacherNames, rooms, classRoom,
      weights: config.weights, seed: a.seed ?? 42,
    },
    preflight,
  }
}

// ══════════════════ 引擎狀態 ══════════════════

type TCell = { w?: string; o?: string; e?: string }

class State {
  input: EngineInput
  pos: Map<string, Placement> = new Map()                      // lessonId → 位置
  classOcc: Map<string, Map<string, string>> = new Map()       // classKey → slot → lessonId（班級格整週占用）
  teacherOcc: Map<string, Map<string, TCell>> = new Map()      // teacherId → slot → 週型占用
  lessonById: Map<string, EngineLesson> = new Map()

  constructor(input: EngineInput) {
    this.input = input
    for (const l of input.lessons) this.lessonById.set(l.id, l)
    for (const c of input.classes) this.classOcc.set(c.classKey, new Map())
    for (const l of input.lessons) if (!this.teacherOcc.has(l.teacherId)) this.teacherOcc.set(l.teacherId, new Map())
  }

  slotsOf(l: EngineLesson, p: Placement): string[] {
    return l.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
  }

  canPlace(l: EngineLesson, p: Placement): boolean {
    const slots = this.slotsOf(l, p)
    const avail = this.input.classSlots[l.classKey] ?? []
    const cOcc = this.classOcc.get(l.classKey)!
    const tOcc = this.teacherOcc.get(l.teacherId)!
    const blocked = this.input.teacherBlocked[l.teacherId] ?? []
    // 視藝單雙週起始節次
    if (l.parity === 'odd' && ![1, 3, 5].includes(p.period)) return false
    if (l.parity === 'even' && ![2, 4, 6].includes(p.period)) return false
    for (const s of slots) {
      if (!avail.includes(s)) return false
      if (cOcc.has(s)) return false
      if (blocked.includes(s)) return false
      const cell = tOcc.get(s)
      if (cell) {
        if (cell.w) return false
        if (l.parity === 'weekly' && (cell.o || cell.e)) return false
        if (l.parity === 'odd' && cell.o) return false
        if (l.parity === 'even' && cell.e) return false
      }
    }
    // 永不連 7（絕對 6 連）：模擬放置後檢查該日連續數
    if (this.teacherRunAfter(l, p) > 6) return false
    return true
  }

  private teacherRunAfter(l: EngineLesson, p: Placement): number {
    const tOcc = this.teacherOcc.get(l.teacherId)!
    const parities: ('o' | 'e')[] = l.parity === 'weekly' ? ['o', 'e'] : [l.parity === 'odd' ? 'o' : 'e']
    let worst = 0
    for (const par of parities) {
      const taught = new Set<number>()
      for (let q = 1; q <= 7; q++) {
        const cell = tOcc.get(`${p.day}-${q}`)
        if (cell && (cell.w || cell[par])) taught.add(q)
      }
      taught.add(p.period)
      if (l.size === 2) taught.add(p.period + 1)
      let run = 0, best = 0
      for (let q = 1; q <= 7; q++) { run = taught.has(q) ? run + 1 : 0; best = Math.max(best, run) }
      worst = Math.max(worst, best)
    }
    return worst
  }

  place(l: EngineLesson, p: Placement) {
    this.pos.set(l.id, p)
    const cOcc = this.classOcc.get(l.classKey)!
    const tOcc = this.teacherOcc.get(l.teacherId)!
    for (const s of this.slotsOf(l, p)) {
      cOcc.set(s, l.id)
      const cell = tOcc.get(s) ?? {}
      if (l.parity === 'weekly') cell.w = l.id
      else if (l.parity === 'odd') cell.o = l.id
      else cell.e = l.id
      tOcc.set(s, cell)
    }
  }

  remove(l: EngineLesson) {
    const p = this.pos.get(l.id)
    if (!p) return
    this.pos.delete(l.id)
    const cOcc = this.classOcc.get(l.classKey)!
    const tOcc = this.teacherOcc.get(l.teacherId)!
    for (const s of this.slotsOf(l, p)) {
      cOcc.delete(s)
      const cell = tOcc.get(s)
      if (cell) {
        if (l.parity === 'weekly') delete cell.w
        else if (l.parity === 'odd') delete cell.o
        else delete cell.e
        if (!cell.w && !cell.o && !cell.e) tOcc.delete(s)
      }
    }
  }

  candidates(l: EngineLesson): Placement[] {
    const out: Placement[] = []
    const seen = new Set<string>()
    for (const s of this.input.classSlots[l.classKey] ?? []) {
      const { day, period } = parseSlotKey(s)
      if (l.size === 2 && period >= 7) continue
      const kk = `${day}-${period}`
      if (seen.has(kk)) continue
      seen.add(kk)
      const p = { day, period }
      if (this.canPlace(l, p)) out.push(p)
    }
    return out
  }
}

// ══════════════════ 罰分計算 ══════════════════

const MUST = 1e6
function pen(level: WeightLevel): number {
  return level === 'must' ? MUST : WEIGHT_PENALTY[level]
}

interface Acc { count: number; points: number; items: string[] }
function acc(map: Map<string, Acc & { label: string }>, key: string, label: string, points: number, item: string) {
  const e = map.get(key) ?? { label, count: 0, points: 0, items: [] }
  e.count++; e.points += points
  if (e.items.length < 30) e.items.push(item)
  map.set(key, e)
}

const DAY_ZH = ['', '一', '二', '三', '四', '五']
function slotZh(day: number, period: number) { return `週${DAY_ZH[day]}第${period}節` }

export function scoreState(st: State): { total: number; penalties: RulePenalty[]; uncovered: { classKey: string; slot: string }[] } {
  const { input } = st
  const w = input.weights.builtin
  const map = new Map<string, Acc & { label: string }>()
  const uncovered: { classKey: string; slot: string }[] = []
  const nameOf = (id: string) => input.teacherNames[id] ?? '？'
  const labelOf = (key2: string) => input.classes.find(c => c.classKey === key2)?.label ?? key2

  // 教室容量：每時段每科目已用教室數（供 roomPrefer / 走動）
  const roomCap: Record<string, number> = {}
  for (const r of input.rooms) roomCap[r.subject] = (roomCap[r.subject] ?? 0) + 1
  const roomUse = new Map<string, string[]>()   // `${slot}|${subject}` → lessonIds（先到先得）
  const placedLessons: { l: EngineLesson; p: Placement }[] = []
  st.pos.forEach((p, id) => placedLessons.push({ l: st.lessonById.get(id)!, p }))
  placedLessons.sort((a2, b2) => a2.l.id < b2.l.id ? -1 : 1)
  const hasRoom = new Map<string, boolean>()
  for (const { l, p } of placedLessons) {
    if (!(l.subject in roomCap)) continue
    for (const s of st.slotsOf(l, p)) {
      const k = `${s}|${l.subject}`
      const arr = roomUse.get(k) ?? []
      if (!arr.includes(l.id)) arr.push(l.id)
      roomUse.set(k, arr)
    }
    const got = st.slotsOf(l, p).every(s => (roomUse.get(`${s}|${l.subject}`) ?? []).indexOf(l.id) < roomCap[l.subject])
    hasRoom.set(l.id, got)
    if (!got && w.roomPrefer !== 'off') {
      acc(map, 'roomPrefer', '專科教室優先', pen(w.roomPrefer), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)} 教室不足，回原班`)
    }
  }

  // 必排科任課覆蓋
  for (const c of input.classes) {
    const occ = st.classOcc.get(c.classKey)!
    for (const s of input.classMustFill[c.classKey] ?? []) {
      if (!occ.has(s)) {
        uncovered.push({ classKey: c.classKey, slot: s })
        const { day, period } = parseSlotKey(s)
        acc(map, 'mustFill', '導師不排課時段未排科任課', MUST, `${c.label} ${slotZh(day, period)}`)
      }
    }
  }

  // ── 班級面 ──
  const tplAvoid = input.weights.templates.filter(t => t.template === 'avoidPeriods' && t.level !== 'off')
  const tplNoConsec = input.weights.templates.filter(t => t.template === 'noConsecDays' && t.level !== 'off')
  const tplTime = input.weights.templates.filter(t => t.template === 'timePrefer' && t.level !== 'off')
  const matches = (t: TemplateRule, l: EngineLesson) =>
    t.subjects.includes(l.subject) && (t.grades.length === 0 || t.grades.includes(l.grade))

  const byClassSubject = new Map<string, { l: EngineLesson; p: Placement }[]>()
  const byClassDayCount = new Map<string, number>()   // `${classKey}|${day}` → 科任課節數
  for (const { l, p } of placedLessons) {
    const k = `${l.classKey}|${l.subject}`
    byClassSubject.set(k, [...(byClassSubject.get(k) ?? []), { l, p }])
    for (const s of st.slotsOf(l, p)) {
      const d = parseSlotKey(s).day
      byClassDayCount.set(`${l.classKey}|${d}`, (byClassDayCount.get(`${l.classKey}|${d}`) ?? 0) + 1)
    }
    // 模板：避開節次
    for (const t of tplAvoid) {
      if (!matches(t, l)) continue
      if (t.fullDayOnly && !input.classDayFull[l.classKey]?.[p.day]) continue
      const hit = st.slotsOf(l, p).some(s => (t.periods ?? []).includes(parseSlotKey(s).period))
      if (hit) acc(map, `tpl-avoid-${t.id}`, `避開節次：${t.subjects.join('、')}`, pen(t.level), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)}`)
    }
    // 模板：時段偏好
    for (const t of tplTime) {
      if (!matches(t, l)) continue
      const morning = p.period <= 4
      if ((t.pref === 'morning' && !morning) || (t.pref === 'afternoon' && morning)) {
        acc(map, `tpl-time-${t.id}`, `時段偏好：${t.subjects.join('、')}`, pen(t.level), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)}`)
      }
    }
    // 上午留白給導師：科任課占上午且該班當日下午仍有空格
    if (w.homeroomMorning !== 'off' && p.period <= 4 && input.classDayFull[l.classKey]?.[p.day]) {
      const occ = st.classOcc.get(l.classKey)!
      const avail = input.classSlots[l.classKey] ?? []
      const freeAfternoon = [5, 6, 7].some(q => avail.includes(`${p.day}-${q}`) && !occ.has(`${p.day}-${q}`))
      if (freeAfternoon) acc(map, 'homeroomMorning', '上午留白給導師', pen(w.homeroomMorning), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)}（下午尚有空格）`)
    }
  }

  byClassSubject.forEach((arr, k) => {
    const [key2, subject] = k.split('|')
    const days = arr.map(x => x.p.day)
    // 同科同日
    if (w.sameSubjectSameDay !== 'off') {
      const cnt: Record<number, number> = {}
      for (const d of days) cnt[d] = (cnt[d] ?? 0) + 1
      for (const [d, n] of Object.entries(cnt)) if (n > 1) {
        acc(map, 'sameSubjectSameDay', '同科同日避免', pen(w.sameSubjectSameDay) * (n - 1), `${labelOf(key2)} ${subject} 週${DAY_ZH[Number(d)]}排了 ${n} 次`)
      }
    }
    // 同科隔天分散＋模板不連續日
    const uniq = Array.from(new Set(days)).sort()
    for (let i = 1; i < uniq.length; i++) {
      if (uniq[i] - uniq[i - 1] === 1) {
        if (w.subjectSpread !== 'off') acc(map, 'subjectSpread', '同科隔天分散', pen(w.subjectSpread), `${labelOf(key2)} ${subject} 週${DAY_ZH[uniq[i - 1]]}、週${DAY_ZH[uniq[i]]}連續兩天`)
        for (const t of tplNoConsec) {
          if (t.subjects.includes(subject) && (t.grades.length === 0 || t.grades.includes(arr[0].l.grade))) {
            acc(map, `tpl-consec-${t.id}`, `不連續日：${t.subjects.join('、')}`, pen(t.level), `${labelOf(key2)} ${subject} 週${DAY_ZH[uniq[i - 1]]}、週${DAY_ZH[uniq[i]]}`)
          }
        }
      }
    }
    // 連堂與單節分半週
    if (w.blockSplit !== 'off') {
      const dbl = arr.filter(x => x.l.size === 2 && x.l.parity === 'weekly')
      const sgl = arr.filter(x => x.l.size === 1)
      if (dbl.length && sgl.length) {
        const inA = (d: number) => d <= 3, inB = (d: number) => d >= 3
        const ok = dbl.every(x => inA(x.p.day)) && sgl.every(x => inB(x.p.day))
          || dbl.every(x => inB(x.p.day)) && sgl.every(x => inA(x.p.day))
        if (!ok) acc(map, 'blockSplit', '連堂單節分半週', pen(w.blockSplit), `${labelOf(key2)} ${subject} 連堂與單節未分屬前後半週`)
      }
    }
  })

  // 留白每日平衡（班級的科任課分布）
  if (w.homeroomBalance !== 'off') {
    for (const c of input.classes) {
      const counts = SCHEDULE_DAYS.map(d => byClassDayCount.get(`${c.classKey}|${d}`) ?? 0)
      const diff = Math.max(...counts) - Math.min(...counts)
      if (diff > 2) acc(map, 'homeroomBalance', '留白每日平衡', pen(w.homeroomBalance) * (diff - 2), `${c.label} 科任課最多日與最少日差 ${diff} 節`)
    }
  }

  // ── 教師面 ──
  st.teacherOcc.forEach((occ, tid) => {
    if (occ.size === 0) return
    for (const par of ['o', 'e'] as const) {
      // 兩種週型各算，取較差者計分一次（避免雙倍）——以 par==='o' 時計 max，'e' 只在不同時補差
      if (par === 'e') continue
      for (const d of SCHEDULE_DAYS) {
        const taughtO: number[] = [], taughtE: number[] = []
        for (let q = 1; q <= 7; q++) {
          const cell = occ.get(`${d}-${q}`)
          if (!cell) continue
          if (cell.w || cell.o) taughtO.push(q)
          if (cell.w || cell.e) taughtE.push(q)
        }
        const evalDay = (taught: number[]) => {
          const res = { over: 0, run: 0, gaps: 0 }
          if (taught.length === 0) return res
          res.over = Math.max(0, taught.length - w.dailyMax.n)
          let run = 0, best = 0
          for (let q = 1; q <= 7; q++) { run = taught.includes(q) ? run + 1 : 0; best = Math.max(best, run) }
          res.run = Math.max(0, best - w.consecMax.n)
          res.gaps = (taught[taught.length - 1] - taught[0] + 1) - taught.length
          return res
        }
        const eo = evalDay(taughtO), ee = evalDay(taughtE)
        const worse = { over: Math.max(eo.over, ee.over), run: Math.max(eo.run, ee.run), gaps: Math.max(eo.gaps, ee.gaps) }
        if (worse.over > 0 && w.dailyMax.level !== 'off') acc(map, 'dailyMax', `每日節數上限 ${w.dailyMax.n}`, pen(w.dailyMax.level) * worse.over, `${nameOf(tid)} 週${DAY_ZH[d]}超 ${worse.over} 節`)
        if (worse.run > 0 && w.consecMax.level !== 'off') acc(map, 'consecMax', `連續授課上限 ${w.consecMax.n}`, pen(w.consecMax.level) * worse.run, `${nameOf(tid)} 週${DAY_ZH[d]}連續超 ${worse.run} 節`)
        if (worse.gaps > 0 && w.compact !== 'off') acc(map, 'compact', '減少零碎空堂', pen(w.compact) * worse.gaps, `${nameOf(tid)} 週${DAY_ZH[d]}有 ${worse.gaps} 節空堂夾在課間`)
      }
    }
    // 每日負擔平衡
    if (w.dayBalance !== 'off') {
      const loads = SCHEDULE_DAYS.map(d => {
        let n = 0
        for (let q = 1; q <= 7; q++) { const cell = occ.get(`${d}-${q}`); if (cell && (cell.w || cell.o || cell.e)) n++ }
        return n
      })
      const diff = Math.max(...loads) - Math.min(...loads)
      if (diff > 3) acc(map, 'dayBalance', '每日負擔平衡', pen(w.dayBalance) * (diff - 3), `${nameOf(tid)} 最重日與最輕日差 ${diff} 節`)
    }
  })

  // 同型態同日（老師當日連堂/單節不混）
  if (w.batchType !== 'off') {
    const byTeacherDay = new Map<string, { dbl: number; sgl: number }>()
    for (const { l, p } of placedLessons) {
      const k = `${l.teacherId}|${p.day}`
      const e = byTeacherDay.get(k) ?? { dbl: 0, sgl: 0 }
      if (l.size === 2) e.dbl++; else e.sgl++
      byTeacherDay.set(k, e)
    }
    byTeacherDay.forEach((e, k) => {
      if (e.dbl > 0 && e.sgl > 0) {
        const [tid, d] = k.split('|')
        acc(map, 'batchType', '同型態同日', pen(w.batchType), `${nameOf(tid)} 週${DAY_ZH[Number(d)]}連堂與單節混排`)
      }
    })
  }

  // 走動成本：老師連續兩節在不同位置
  if (w.walkCost !== 'off') {
    const posOf = (l: EngineLesson): RoomInfo | { zone: number; index: number; zoneSize: number; ring: boolean } | null => {
      if (hasRoom.get(l.id)) {
        const r = input.rooms.find(x => x.subject === l.subject)
        if (r) return r
      }
      return input.classRoom[l.classKey] ?? null
    }
    st.teacherOcc.forEach((occ, tid) => {
      for (const d of SCHEDULE_DAYS) for (let q = 1; q <= 6; q++) {
        const a2 = occ.get(`${d}-${q}`), b2 = occ.get(`${d}-${q + 1}`)
        if (!a2 || !b2) continue
        const idA = a2.w ?? a2.o ?? a2.e, idB = b2.w ?? b2.o ?? b2.e
        if (!idA || !idB || idA === idB) continue
        const la = st.lessonById.get(idA)!, lb = st.lessonById.get(idB)!
        const pa = posOf(la), pb = posOf(lb)
        if (!pa || !pb) continue
        let dist: number
        if (pa.zone !== pb.zone) dist = 4
        else {
          const raw = Math.abs(pa.index - pb.index)
          dist = pa.ring ? Math.min(raw, pa.zoneSize - raw) : raw
        }
        if (dist >= 2) acc(map, 'walkCost', '走動成本', pen(w.walkCost) * Math.min(dist - 1, 3), `${nameOf(tid)} 週${DAY_ZH[d]}第${q}→${q + 1}節跨教室（距離 ${dist}）`)
      }
    })
  }

  const penalties: RulePenalty[] = []
  let total = 0
  map.forEach((v, k) => { penalties.push({ key: k, label: v.label, count: v.count, points: v.points, items: v.items }); total += v.points })
  penalties.sort((x, y) => y.points - x.points)
  return { total, penalties, uncovered }
}

// ══════════════════ 建構＋局部搜尋 ══════════════════

export interface RunOptions { timeMs: number; onProgress?: (p: { iter: number; best: number; elapsed: number; placed: number; unplaced: number }) => void }

export function runEngine(input: EngineInput, opts: RunOptions): EngineResult {
  const start = Date.now()
  const rnd = mulberry32(input.seed)
  const st = new State(input)

  // 難排優先：必排格多的班、連堂、老師封鎖多、老師課多
  const teacherLoad: Record<string, number> = {}
  for (const l of input.lessons) teacherLoad[l.teacherId] = (teacherLoad[l.teacherId] ?? 0) + l.size
  const difficulty = (l: EngineLesson) =>
    (l.size === 2 ? 100 : 0) + (l.parity !== 'weekly' ? 50 : 0)
    + (input.teacherBlocked[l.teacherId]?.length ?? 0) * 3
    + (input.classMustFill[l.classKey]?.length ?? 0) * 2
    + teacherLoad[l.teacherId]
  const ordered = [...input.lessons].sort((a, b) => difficulty(b) - difficulty(a))

  // 建構：優先覆蓋必排格，其次低節次干擾
  for (const l of ordered) {
    const cands = st.candidates(l)
    if (cands.length === 0) continue
    const must = new Set(input.classMustFill[l.classKey] ?? [])
    let best: Placement | null = null
    let bestScore = Infinity
    for (const p of cands) {
      const slots = l.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
      const coverMust = slots.filter(s => must.has(s) && !st.classOcc.get(l.classKey)!.has(s)).length
      const score = -coverMust * 1000 + (p.period <= 4 ? 5 : 0) + rnd()
      if (score < bestScore) { bestScore = score; best = p }
    }
    if (best) st.place(l, best)
  }

  // 局部搜尋
  let { total: cur } = scoreState(st)
  let bestTotal = cur
  let iter = 0
  const allLessons = input.lessons
  while (Date.now() - start < opts.timeMs) {
    iter++
    const l = allLessons[Math.floor(rnd() * allLessons.length)]
    const oldP = st.pos.get(l.id) ?? null
    if (oldP) st.remove(l)
    const cands = st.candidates(l)
    let moved = false
    if (cands.length > 0) {
      const p = cands[Math.floor(rnd() * cands.length)]
      st.place(l, p)
      const { total: next } = scoreState(st)
      if (next <= cur || rnd() < 0.02) { cur = next; moved = true }
      else st.remove(l)
    }
    if (!moved && oldP) st.place(l, oldP)
    if (cur < bestTotal) bestTotal = cur
    if (iter % 50 === 0 && opts.onProgress) {
      opts.onProgress({ iter, best: cur, elapsed: Date.now() - start, placed: st.pos.size, unplaced: input.lessons.length - st.pos.size })
    }
  }

  // 結果
  const { total, penalties, uncovered } = scoreState(st)
  const placed: PlacedResult[] = []
  const unplaced: UnplacedResult[] = []
  // 教室分配（與 scoreState 同邏輯：先到先得）
  const roomCap: Record<string, RoomInfo[]> = {}
  for (const r of input.rooms) (roomCap[r.subject] ??= []).push(r)
  const roomTaken = new Map<string, Set<string>>()   // slot → set(roomId)
  const sorted: { l: EngineLesson; p: Placement }[] = []
  st.pos.forEach((p, id) => sorted.push({ l: st.lessonById.get(id)!, p }))
  sorted.sort((a, b) => a.l.id < b.l.id ? -1 : 1)
  for (const { l, p } of sorted) {
    let roomId: string | null = null
    const rooms = roomCap[l.subject] ?? []
    const slots = st.slotsOf(l, p)
    for (const r of rooms) {
      if (slots.every(s => !(roomTaken.get(s)?.has(r.id)))) {
        roomId = r.id
        for (const s of slots) (roomTaken.get(s) ?? roomTaken.set(s, new Set()).get(s)!).add(r.id)
        break
      }
    }
    placed.push({ ...l, day: p.day, period: p.period, roomId })
  }
  for (const l of input.lessons) {
    if (st.pos.has(l.id)) continue
    unplaced.push({ lesson: l, reason: unplacedReason(st, l) })
  }

  return { placed, unplaced, penalties, totalPenalty: total, uncoveredMustFill: uncovered, iterations: iter, elapsedMs: Date.now() - start }
}

function unplacedReason(st: State, l: EngineLesson): string {
  const avail = st.input.classSlots[l.classKey] ?? []
  const cOcc = st.classOcc.get(l.classKey)!
  const blocked = st.input.teacherBlocked[l.teacherId] ?? []
  let classFree = 0, teacherClash = 0, blockedHit = 0
  for (const s of avail) {
    if (cOcc.has(s)) continue
    classFree++
    if (blocked.includes(s)) { blockedHit++; continue }
    const cell = st.teacherOcc.get(l.teacherId)!.get(s)
    if (cell && (cell.w || (l.parity !== 'even' && cell.o) || (l.parity !== 'odd' && cell.e))) teacherClash++
  }
  if (classFree === 0) return '班級課表已無空格'
  const parts: string[] = [`班級尚有 ${classFree} 空格`]
  if (teacherClash) parts.push(`其中 ${teacherClash} 格老師已有課`)
  if (blockedHit) parts.push(`${blockedHit} 格為老師不排課時段`)
  if (l.size === 2) parts.push('連堂需相鄰兩格皆可用')
  if (l.parity !== 'weekly') parts.push(`單雙週起始節次限制（${l.parity === 'odd' ? '1,3,5' : '2,4,6'}）`)
  return parts.join('；')
}
