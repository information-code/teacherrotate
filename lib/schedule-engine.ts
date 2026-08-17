// 排課引擎：只排「科任課」。班級課表的留白＝導師自排空間。
// 三階段：組裝（assembleEngineInput）→ 建構＋局部搜尋（runEngine）→ 罰分明細報告。
// 硬限制：班/師/教室同時段唯一、年段可排時段、鎖課格、教師不排課、永不連 7（絕對 6 連）、上空上空、同科同日、連堂不跨午休、外師唯一/不可到校。
// 權重（2026-08 依 114-2 人工課表檢核降為可調）：同科不隔天、科任課同日成塊、同型態同日。
// 建構模擬人工排課：錨定老師（不排課多／負載比高）先回溯整批落位 → 洞少的班先排 → 緊的老師先排；
// 局部搜尋含必排格覆蓋、成塊補洞、未排課逐出（同師衝堂或占格的別師課）。
// 軟限制：權重設定（關/低/中/高＝0/1/3/9；必須＝1e6 大罰分，違反時列入報告但不卡死搜尋）。
// 週型（parity）：視藝單雙週連堂——班級格整週占用（另一週保留給導師），教師只占自己的週型，
// 故視藝老師可交錯服務單週組（起始節 1,3,5）與雙週組（起始節 2,4,6）。

import {
  SCHEDULE_DAYS, WEIGHT_PENALTY, HOMEROOM_SELF, LOCK_COLORS,
  bandOf, classKey as ck, classLabel, subjectClassKey, parseSlotKey, roomLabel, deriveNativeSessions, foreignDemand, doubleModeOf,
  type ScheduleConfig, type ScheduleWeights, type WeightLevel, type TemplateRule,
} from './scheduling'
import { GRADE_LABEL, type ExtraCourse } from './allocation'

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
  pairable?: boolean       // 連堂模式「都可以」的單節：允許同科同日相鄰兩節自然成對（不跨午休）——人工排課「塞得順就連」
  coTeacherId?: string     // 外師（協同）：掛在此課上的外師——同時段唯一、不可用時段、連 7 皆為硬規則
  coTeacherName?: string
}

export interface RoomInfo { id: string; label: string; subject: string; managerId: string; zone: number; index: number; zoneSize: number; ring: boolean }

export interface EngineInput {
  classes: { classKey: string; grade: number; label: string }[]
  lessons: EngineLesson[]
  classSlots: Record<string, string[]>       // classKey → 可放科任課的 slotKey（可排時段 − 鎖課格）
  classMustFill: Record<string, string[]>    // classKey → 必排科任課的格（導師不排課時段）
  classMustLeave: Record<string, string[]>   // classKey → 必留導師課的格（導師排課標記，科任課不可放）
  classDayFull: Record<string, Record<number, boolean>>  // classKey → day → 是否整天日
  lockedCells: Record<string, Record<string, string>>    // classKey → slotKey → 顯示文字（鎖課科目）
  teacherBlocked: Record<string, string[]>   // 科任教師不可排時段
  teacherMustTeach: Record<string, string[]> // 科任教師必排時段（排課標記，未覆蓋＝必須級罰分）
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
  softPenalty: number      // 純軟規則罰分（排除未排與必須級，供顯示）
  uncoveredMustFill: { classKey: string; slot: string }[]
  iterations: number
  elapsedMs: number
}

export interface PreflightIssue { level: 'error' | 'warn'; text: string; tab?: string; href?: string }   // tab＝排課設定分頁 key、href＝其他頁面完整路徑（引導按鈕用，href 優先）

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

/** 由排課設定重建科任教室清單（有綁科目者）。 */
export function roomsFromConfig(config: ScheduleConfig): RoomInfo[] {
  const rooms: RoomInfo[] = []
  config.roomZones.forEach((z, zi) => {
    z.rooms.forEach((r, ri) => {
      if (r.kind === 'subject' && r.subject) {
        rooms.push({ id: r.id, label: roomLabel(r) || r.subject, subject: r.subject, managerId: r.managerId ?? '', zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring })
      }
    })
  })
  return rooms
}

/** 手動調整後重新分配教室（與排課時同邏輯：管理教師必得自己的教室、
 *  非管理者先用無管理者教室）。失去教室的課 roomId=null＝回原班，零警告。 */
export function reassignRooms(placed: PlacedResult[], rooms: RoomInfo[]): PlacedResult[] {
  const bySubject: Record<string, RoomInfo[]> = {}
  for (const r of rooms) (bySubject[r.subject] ??= []).push(r)
  const taken = new Map<string, Set<string>>()
  const roomOf = new Map<string, string>()
  const entries = placed.filter(p => bySubject[p.subject])
  entries.sort((a, b) => {
    const am = bySubject[a.subject].some(r => r.managerId === a.teacherId) ? 0 : 1
    const bm = bySubject[b.subject].some(r => r.managerId === b.teacherId) ? 0 : 1
    if (am !== bm) return am - bm
    return a.id < b.id ? -1 : 1
  })
  for (const p of entries) {
    const slots = p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
    const rs = bySubject[p.subject]
    const ordered = [
      ...rs.filter(r => r.managerId === p.teacherId),
      ...rs.filter(r => !r.managerId),
      ...rs.filter(r => r.managerId && r.managerId !== p.teacherId),
    ]
    const room = ordered.find(r => slots.every(s => !(taken.get(s)?.has(r.id))))
    if (room) {
      roomOf.set(p.id, room.id)
      for (const s of slots) (taken.get(s) ?? taken.set(s, new Set()).get(s)!).add(room.id)
    }
  }
  return placed.map(p => ({ ...p, roomId: bySubject[p.subject] ? (roomOf.get(p.id) ?? null) : (p.roomId ?? null) }))
}

export interface AssembleArgs {
  config: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, { name: string; perClass: number; homeroom: boolean }[]>
  gradeHomeroomBase: Record<number, number>
  teacherNames: Record<string, string>
  /** 導師自上節數（同科分擔用）：classKey → 科目 → 節數。
   *  科目有指派科任時，科任只排「每班節數 − 鎖課 − 導師分擔」的剩餘節數（如生活 6＝導師 3＋科任 3）。 */
  homeroomHours?: Record<string, Record<string, number>>
  /** 其他課程（本土語語別課）＋各師配課節數：供本土語場次推導與語師占用。 */
  extraCourses?: ExtraCourse[]
  hoursByTeacher?: Record<string, Record<string, Record<string, number>>>
  /** 全體科任/行政/鐘點的配課節數（tid → 科目 → 年級 → 節數）：
   *  未手動配班的班級由此自動分配給尚有容量的老師（手動配班優先且必綁定該師）。 */
  supplyByTeacher?: Record<string, Record<string, Record<string, number>>>
  seed?: number
}

export function assembleEngineInput(a: AssembleArgs): { input: EngineInput; preflight: PreflightIssue[] } {
  const { config, classCounts, gradeSubjects } = a
  const preflight: PreflightIssue[] = []
  // 檢查結果先彙總、最後統整輸出（一類一行，避免逐班洗版）
  const agg = {
    overCap: [] as string[],        // 科任課超過可排格數
    mustOver: [] as string[],       // 導師不排課時段 > 科任課數
    noHomeroom: [] as string[],     // 尚未指定導師
    leftoverLow: [] as string[],    // 留白 < 導師基本授課
    artBiweekly: [] as string[],    // 視藝單雙週但每班節數 ≠ 1
    unassigned: new Map<string, number>(),   // `${grade}|${subject}` → 未指派班數
    onOffConflict: [] as string[],  // 同格同時被標排課與不排課
    onNoLesson: [] as string[],     // 標了排課但無科任課的教師
    onBadSlot: [] as string[],      // 排課標記時段不可行（非授課班可排格或與封鎖衝突）
  }
  const classes: EngineInput['classes'] = []
  const classSlots: Record<string, string[]> = {}
  const classMustFill: Record<string, string[]> = {}
  const classMustLeave: Record<string, string[]> = {}
  const classDayFull: Record<string, Record<number, boolean>> = {}
  const lockedCells: Record<string, Record<string, string>> = {}
  const lessons: EngineLesson[] = []

  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const dmode = (subj: string, g: number) => doubleModeOf(config.weights, subj, g)

  // 個人不排課 → teacherId → slots（科任用於自身封鎖；導師用於班級 mustFill）
  // 個人排課（mode='on'）→ 反向：導師用於班級必留導師格；科任用於必排時段
  const offByTeacher: Record<string, string[]> = {}
  const onByTeacher: Record<string, string[]> = {}
  for (const p of config.personalOff) {
    if (!p.teacherId) continue
    const box = p.mode === 'on' ? onByTeacher : offByTeacher
    box[p.teacherId] = [...(box[p.teacherId] ?? []), ...p.slots]
  }

  // ── 本土語 ──
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
  const nativeExtraBlocked: Record<string, Set<string>> = {}   // 閩南語師（原班時段）＋語別課師（推導場次）
  const blockNative = (tid: string, slot: string) => (nativeExtraBlocked[tid] ??= new Set()).add(slot)
  const nativeAgg = {
    streamClasses: [] as string[],       // 未指派閩南語師 → 直播共學（確認用）
    notLocked: [] as string[],           // 本土語鎖課格數 < 每班節數
  }
  // 語別場次自動推導 → 語師占用（取消的場次不占）＋一致性檢核
  const derived = deriveNativeSessions({
    config,
    extraCourses: a.extraCourses ?? [],
    hoursByTeacher: a.hoursByTeacher ?? {},
  })
  for (const s of derived.sessions) {
    if (s.state !== 'cancelled' && s.teacherId) blockNative(s.teacherId, s.slot)
  }

  // ── 自動配班：未手動指派的班，依配課節數（supplyByTeacher）自動分給尚有容量的老師 ──
  // 手動配班優先（先扣容量、必綁定該師）。本土語同其他科自動配——
  // 配到假師/虛擬帳號的班，之後由管理者視情況改直播共學即可。
  const assign: Record<string, string> = { ...config.subjectClassTeacher }
  const autoAgg = new Map<string, number>()   // `${grade}|${subject}` → 自動配班班數
  if (a.supplyByTeacher) {
    // 剩餘容量：科目 → 年級 → tid → 節數
    const left: Record<string, Record<string, Map<string, number>>> = {}
    for (const [tid, m] of Object.entries(a.supplyByTeacher)) {
      for (const [subj, byG] of Object.entries(m ?? {})) {
        for (const [gs, h] of Object.entries(byG ?? {})) {
          if (!(Number(h) > 0)) continue
          ;((left[subj] ??= {})[gs] ??= new Map()).set(tid, Number(h))
        }
      }
    }
    // 每班該科科任要上的節數 ＝ 每班節數 − 導師自上。
    // 鎖課不扣：鎖課只是把該班該科的某節固定在那格（最高硬規則），
    // 上課的人照配課帳算（導師自上或配班科任），節數不因鎖課而改變。
    const remainderOf = (g: number, i: number, s: { name: string; perClass: number }) =>
      s.perClass - (a.homeroomHours?.[ck(g, i)]?.[s.name] ?? 0)
    for (const pass of ['manual', 'auto'] as const) {
      for (const g of [1, 2, 3, 4, 5, 6]) {
        for (let i = 0; i < (classCounts[g] ?? 0); i++) {
          for (const s of (gradeSubjects[g] ?? [])) {
            if (s.perClass <= 0) continue
            const k = subjectClassKey(g, i, s.name)
            const cur = assign[k]
            const r = remainderOf(g, i, s)
            if (r <= 0) continue
            const map = left[s.name]?.[String(g)]
            if (pass === 'manual') {
              // 先扣手動指派者的容量（可為負＝超派，不影響其綁定）
              if (cur && cur !== HOMEROOM_SELF && map?.has(cur)) map.set(cur, map.get(cur)! - r)
              continue
            }
            if (cur || !map) continue
            // 自動配班：選剩餘容量最大且足夠者
            let best: string | null = null, bestLeft = 0
            for (const [tid, l] of Array.from(map)) if (l >= r && l > bestLeft) { best = tid; bestLeft = l }
            if (!best) continue
            map.set(best, bestLeft - r)
            assign[k] = best
            autoAgg.set(`${g}|${s.name}`, (autoAgg.get(`${g}|${s.name}`) ?? 0) + 1)
          }
        }
      }
    }
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
      // 必留導師格：該班導師的個人排課標記——科任課不可放（同格同時被標排課＋不排課＝矛盾，兩者皆忽略並警告）
      const homeroomOn = homeroomId ? (onByTeacher[homeroomId] ?? []) : []
      const leaveSet = new Set<string>()
      for (const s of homeroomOn) if (slots.includes(s)) leaveSet.add(s)
      for (const s of Array.from(leaveSet)) {
        if (mustSet.has(s)) {
          const { day, period } = parseSlotKey(s)
          agg.onOffConflict.push(`${classLabel(g, i)}導師 週${'一二三四五'[day - 1]}第${period}節`)
          mustSet.delete(s); leaveSet.delete(s)
        }
      }
      classMustFill[key] = Array.from(mustSet)
      classMustLeave[key] = Array.from(leaveSet)

      // 鎖課占用後扣科目需求
      const lockCountBySubject: Record<string, number> = {}
      for (const txt of Object.values(lockDisplay)) lockCountBySubject[txt] = (lockCountBySubject[txt] ?? 0) + 1

      // ── 本土語：閩南語師（科任配班有指派）於該班本土語鎖課時段在原班授課 → 占用；未指派＝直播共學 ──
      const nativeSlotsOfClass = Object.entries(locks).filter(([, tid]) => nativeTypeIds.has(tid)).map(([slot]) => slot)
      const nativePerClass = subjects.find(s2 => s2.name === '本土語')?.perClass ?? 0
      if (nativePerClass > 0 && nativeSlotsOfClass.length < nativePerClass) {
        nativeAgg.notLocked.push(`${classLabel(g, i)}（鎖 ${nativeSlotsOfClass.length}/${nativePerClass}）`)
      }
      if (nativeSlotsOfClass.length > 0) {
        const minnanTeacher = assign[subjectClassKey(g, i, '本土語')] ?? ''
        if (minnanTeacher && minnanTeacher !== HOMEROOM_SELF) {
          for (const slot of nativeSlotsOfClass) blockNative(minnanTeacher, slot)
        } else if (!minnanTeacher) {
          nativeAgg.streamClasses.push(classLabel(g, i))
        }
      }

      // 展開科任課（支援同科分擔：科任只排扣除導師自上節數後的剩餘；assign 含自動配班）
      for (const s of subjects) {
        const assigned = assign[subjectClassKey(g, i, s.name)] ?? ''
        if (!assigned || assigned === HOMEROOM_SELF) continue   // 未指派或全導師自上 → 不進引擎
        const teacherName = a.teacherNames[assigned] ?? '？'
        const selfHours = a.homeroomHours?.[key]?.[s.name] ?? 0
        let hours = s.perClass - (lockCountBySubject[s.name] ?? 0) - selfHours
        if (hours <= 0) continue

        const mode = dmode(s.name, g)
        if (mode === 'biweekly') {
          // 單雙週連堂：占固定兩格（整週，另一週保留給導師），教師只占自己週型
          if (s.perClass !== 1) agg.artBiweekly.push(`${classLabel(g, i)} ${s.name}（${s.perClass} 節）`)
          lessons.push({
            id: `${key}|${s.name}|bi`, classKey: key, grade: g, classLabel: classLabel(g, i),
            subject: s.name, teacherId: assigned, teacherName, size: 2,
            parity: i % 2 === 0 ? 'odd' : 'even',
          })
          continue
        }

        const wantsDouble = mode === 'double'
        const pairable = mode === 'auto'
        let n = 0
        // 連堂科目盡量成組：每 2 節一組連堂（如生活 6 節＝3 組連堂），
        // 否則高節數科目無法滿足「同科不隔天」硬限制（每週最多 3 個落點）
        let d2 = 0
        while (wantsDouble && hours >= 2) {
          lessons.push({
            id: `${key}|${s.name}|d${d2++}`, classKey: key, grade: g, classLabel: classLabel(g, i),
            subject: s.name, teacherId: assigned, teacherName, size: 2, parity: 'weekly',
          })
          hours -= 2
        }
        // 落點數（連堂組數＋單節數；「都可以」以可成對的最少落點估）> 3 即無法同時滿足「同科不隔天」（權重）——提醒但不擋
        const spots = d2 + (pairable ? Math.ceil(hours / 2) : hours)
        if (spots > 3 && config.weights.builtin.subjectSpread !== 'off') preflight.push({ level: 'warn', text: `${classLabel(g, i)} ${s.name} 每週至少 ${spots} 個落點，超過「同科不隔天」可容納的 3 個（一三五），必有相鄰兩天，將計入權重扣分。` })
        while (hours > 0) {
          lessons.push({
            id: `${key}|${s.name}|s${n++}`, classKey: key, grade: g, classLabel: classLabel(g, i),
            subject: s.name, teacherId: assigned, teacherName, size: 1, parity: 'weekly',
            ...(pairable ? { pairable: true } : {}),
          })
          hours--
        }
      }

      // 前置檢核：留白是否夠導師自排（彙總）。
      // 單雙週配對區塊的兩格實體被占，但雙週（或單週）整塊還給導師填課（扣兩節籤）→ 留白帳補回 2 格/區塊
      const classLessons = lessons.filter(l => l.classKey === key)
      const lessonPeriods = classLessons.reduce((s2, l) => s2 + l.size, 0)
      const biBlocks = classLessons.filter(l => l.parity !== 'weekly').length
      const leftover = slots.length - lessonPeriods
      const base = a.gradeHomeroomBase[g] ?? 0
      if (leftover < 0) agg.overCap.push(`${classLabel(g, i)}（${lessonPeriods}/${slots.length}）`)
      else if (base > 0 && leftover + biBlocks * 2 < base) agg.leftoverLow.push(`${classLabel(g, i)}（${leftover + biBlocks * 2}/${base}）`)
      if (mustSet.size > lessonPeriods) agg.mustOver.push(`${classLabel(g, i)}（${mustSet.size} 格/${lessonPeriods} 節）`)
      if (!homeroomId) agg.noHomeroom.push(classLabel(g, i))

      for (const s of subjects) {
        const v = assign[subjectClassKey(g, i, s.name)] ?? ''
        // 本土語未指派＝直播共學（另行確認），不列入未配滿警告
        if (!v && !s.homeroom && s.name !== '本土語') {
          const k2 = `${g}|${s.name}`
          agg.unassigned.set(k2, (agg.unassigned.get(k2) ?? 0) + 1)
        }
      }
    }
  }

  // ── 外師（協同英語）：把外師掛到該班該科的科任課上（每班 N 節、優先單節週課）；掛不上＝設定不成立（必須級）──
  const foreignAgg = { noLesson: [] as string[], overload: [] as string[] }
  const foreignBlocked: Record<string, string[]> = {}
  for (const ft of config.foreignTeachers) {
    const fname = a.teacherNames[ft.teacherId] ?? '外師'
    const demand = foreignDemand(ft, classCounts)
    let attached = 0
    for (const [k2, need] of Object.entries(demand)) {
      const [key, subj] = k2.split('|')
      const pool = lessons
        .filter(l => l.classKey === key && l.subject === subj && !l.coTeacherId)
        .sort((x, y) => (x.size - y.size) || (x.parity === 'weekly' ? -1 : 1))
      const take = pool.slice(0, need)
      for (const l of take) { l.coTeacherId = ft.teacherId; l.coTeacherName = fname; attached += l.size }
      if (take.length < need) {
        const [g, i] = key.split('-').map(Number)
        foreignAgg.noLesson.push(`${fname}：${classLabel(g, i)} ${subj}（要 ${need}、可掛 ${take.length}）`)
      }
    }
    foreignBlocked[ft.teacherId] = Array.from(new Set(ft.offSlots))
    // 可用格 = 全校可排格聯集 − 不可用時段；掛的節數超過即必有未排
    const union = new Set<string>()
    for (const l of lessons) if (l.coTeacherId === ft.teacherId) for (const s of classSlots[l.classKey] ?? []) if (!ft.offSlots.includes(s)) union.add(s)
    if (attached > union.size) foreignAgg.overload.push(`${fname}（${attached} 節／可用 ${union.size} 格）`)
  }

  // 科任教師封鎖（只需引擎會用到的老師）＝個人不排課 ∪ 本土語占用（原班閩南語／實體開課）；外師＝不可用時段
  const teacherIds = new Set(lessons.map(l => l.teacherId))
  const teacherBlocked: Record<string, string[]> = { ...foreignBlocked }
  for (const id of Array.from(teacherIds)) {
    teacherBlocked[id] = Array.from(new Set([...(offByTeacher[id] ?? []), ...Array.from(nativeExtraBlocked[id] ?? [])]))
  }

  // 前置檢核：教師配課節數 vs 其授課班級可排時段（扣除自身不排課）——超過即必然有課排不進
  const loadByTeacher: Record<string, number> = {}
  const slotsByTeacher: Record<string, Set<string>> = {}
  for (const l of lessons) {
    loadByTeacher[l.teacherId] = (loadByTeacher[l.teacherId] ?? 0) + l.size
    const set = (slotsByTeacher[l.teacherId] ??= new Set())
    const blocked = teacherBlocked[l.teacherId]
    for (const s of classSlots[l.classKey] ?? []) if (!blocked.includes(s)) set.add(s)
  }
  for (const [tid, load] of Object.entries(loadByTeacher)) {
    const cap = slotsByTeacher[tid]?.size ?? 0
    if (load > cap) preflight.push({ level: 'warn', text: `${a.teacherNames[tid] ?? tid} 配課 ${load} 節，但其授課班級的可排時段（扣除不排課）僅 ${cap} 格，至少 ${load - cap} 節必然排不進，請調整配班或不排課時段。` })
  }

  // 排課標記（科任）：該時段必須排入該師的課。不可行的時段（非其授課班可排格、或與不排課/本土語封鎖衝突）先剔除並警告。
  const homeroomIds = new Set(Object.values(config.classTeacher).filter(Boolean))
  const teacherMustTeach: Record<string, string[]> = {}
  for (const [tid, onSlots] of Object.entries(onByTeacher)) {
    if (homeroomIds.has(tid)) continue   // 導師 → 已於班級側處理（必留導師格）
    const name = a.teacherNames[tid] ?? tid
    if (!teacherIds.has(tid)) { agg.onNoLesson.push(name); continue }
    const feasible = slotsByTeacher[tid] ?? new Set<string>()
    const good: string[] = []
    for (const s of Array.from(new Set(onSlots))) {
      if (feasible.has(s)) good.push(s)
      else { const { day, period } = parseSlotKey(s); agg.onBadSlot.push(`${name} 週${'一二三四五'[day - 1]}第${period}節`) }
    }
    if (good.length) teacherMustTeach[tid] = good
  }

  // 教室
  const rooms: RoomInfo[] = roomsFromConfig(config)
  const classRoom: EngineInput['classRoom'] = {}
  config.roomZones.forEach((z, zi) => {
    z.rooms.forEach((r, ri) => {
      if (r.kind === 'class' && r.classKey) {
        classRoom[r.classKey] = { zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring }
      }
    })
  })
  for (const c of classes) if (!(c.classKey in classRoom)) classRoom[c.classKey] = null

  // ── 統整輸出（一類一行）──
  const joinCap = (arr: string[], cap = 15) =>
    arr.length > cap ? `${arr.slice(0, cap).join('、')}…等 ${arr.length} 項` : arr.join('、')
  if (lessons.length === 0) preflight.push({ level: 'error', text: '沒有任何科任課可排：請先完成科任配班。', tab: 'subject' })
  if (agg.overCap.length) preflight.push({ level: 'error', text: `科任課超過可排格數（節數/格數）：${joinCap(agg.overCap)}`, tab: 'subject' })
  if (agg.mustOver.length) preflight.push({ level: 'error', text: `導師不排課時段多於科任課、無法全部覆蓋：${joinCap(agg.mustOver)}`, tab: 'subject' })
  // 外師檢核（設定為絕對：掛不上／塞不下皆為必須級）
  if (foreignAgg.noLesson.length) preflight.push({ level: 'error', text: `外師掛課無對應科任課（該班該科無課、由導師自上或已掛滿）：${joinCap(foreignAgg.noLesson)}`, tab: 'foreign' })
  if (foreignAgg.overload.length) preflight.push({ level: 'error', text: `外師掛課節數超過其可用時段（扣除不可到校）：${joinCap(foreignAgg.overload)}`, tab: 'foreign' })
  if (agg.noHomeroom.length) preflight.push({ level: 'warn', text: `尚未指定導師：${joinCap(agg.noHomeroom)}`, tab: 'homeroom' })
  if (agg.unassigned.size) {
    const parts = Array.from(agg.unassigned.entries()).map(([k2, n]) => {
      const [g, subj] = k2.split('|')
      return `${GRADE_LABEL[Number(g)]}${subj}（${n} 班）`
    })
    preflight.push({ level: 'warn', text: `尚未配滿需求節數（未指派科任，暫視為導師自排）：${joinCap(parts)}`, tab: 'subject' })
  }
  if (autoAgg.size) {
    const parts = Array.from(autoAgg.entries()).map(([k2, n]) => {
      const [g, subj] = k2.split('|')
      return `${GRADE_LABEL[Number(g)]}${subj}（${n} 班）`
    })
    preflight.push({ level: 'warn', text: `未手動配班、已依配課節數自動分配：${joinCap(parts)}——如需指定授課教師請至科任配班。`, tab: 'subject' })
  }
  if (agg.leftoverLow.length) preflight.push({ level: 'warn', text: `留白少於導師基本授課（留白/基本）：${joinCap(agg.leftoverLow)}`, tab: 'subject' })
  if (agg.artBiweekly.length) preflight.push({ level: 'warn', text: `單雙週連堂假設每週均攤 1 節，但每班節數不同：${joinCap(agg.artBiweekly)}`, tab: 'weight' })
  const noManager = rooms.filter(r => !r.managerId).map(r => r.label)
  if (noManager.length) preflight.push({ level: 'warn', text: `尚未指定科任教室管理者：${joinCap(noManager)}`, tab: 'room' })
  // 本土語檢核
  if (nativeAgg.notLocked.length) preflight.push({ level: 'warn', text: `本土語尚未鎖滿時段：${joinCap(nativeAgg.notLocked)}`, tab: 'lock' })
  for (const issue of derived.issues) preflight.push(issue)
  if (nativeAgg.streamClasses.length) preflight.push({ level: 'warn', text: `本土語未指派閩南語老師、將以直播共學處理（請確認非漏填）：${joinCap(nativeAgg.streamClasses)}`, tab: 'subject' })
  // 排課標記檢核
  if (agg.onOffConflict.length) preflight.push({ level: 'warn', text: `排課與不排課標記同格衝突（該格兩者皆忽略）：${joinCap(agg.onOffConflict)}`, tab: 'off' })
  if (agg.onNoLesson.length) preflight.push({ level: 'warn', text: `標了排課但無科任課、標記無作用：${joinCap(agg.onNoLesson)}`, tab: 'off' })
  if (agg.onBadSlot.length) preflight.push({ level: 'warn', text: `排課標記時段不可行（非其授課班可排格或與不排課衝突，已忽略）：${joinCap(agg.onBadSlot)}`, tab: 'off' })

  return {
    input: {
      classes, lessons, classSlots, classMustFill, classMustLeave, classDayFull, lockedCells,
      teacherBlocked, teacherMustTeach, teacherNames: a.teacherNames, rooms, classRoom,
      weights: config.weights, seed: a.seed ?? 42,
    },
    preflight,
  }
}

// ══════════════════ 引擎狀態 ══════════════════

/** 上午最後一節：連堂不得由此節起始（會跨午休）；上/下午分段亦以此為界。 */
const MORNING_LAST = 4

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
    for (const l of input.lessons) if (l.coTeacherId && !this.teacherOcc.has(l.coTeacherId)) this.teacherOcc.set(l.coTeacherId, new Map())
  }

  /** 某資源（中師／外師）於該格是否已被此週型占用。 */
  private occClash(rid: string, s: string, parity: Parity): boolean {
    const cell = this.teacherOcc.get(rid)?.get(s)
    if (!cell) return false
    if (cell.w) return true
    if (parity === 'weekly' && (cell.o || cell.e)) return true
    if (parity === 'odd' && cell.o) return true
    if (parity === 'even' && cell.e) return true
    return false
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
    const mustLeave = this.input.classMustLeave?.[l.classKey] ?? []
    // 視藝單雙週：實體區塊一律對齊 (1-2)(3-4)(5-6)——單雙週兩班共用同一區塊；
    // 顯示時單週畫在起始節（1/3/5）、雙週畫在次節（2/4/6），此為顯示層職責
    if (l.parity !== 'weekly' && ![1, 3, 5].includes(p.period)) return false
    // 硬限制：連堂不跨午休（114-2 人工課表 178 組連堂，0 組起始於第 4 節）
    if (l.size === 2 && p.period === MORNING_LAST) return false
    for (const s of slots) {
      if (!avail.includes(s)) return false
      if (cOcc.has(s)) return false
      if (blocked.includes(s)) return false
      if (mustLeave.includes(s)) return false   // 導師排課標記格：必留導師課
      const cell = tOcc.get(s)
      if (cell) {
        if (cell.w) return false
        if (l.parity === 'weekly' && (cell.o || cell.e)) return false
        if (l.parity === 'odd' && cell.o) return false
        if (l.parity === 'even' && cell.e) return false
      }
    }
    // 外師（協同）：同時段唯一、不可用時段、永不連 7
    if (l.coTeacherId) {
      const coBlocked = this.input.teacherBlocked[l.coTeacherId] ?? []
      for (const s of slots) {
        if (coBlocked.includes(s)) return false
        if (this.occClash(l.coTeacherId, s, l.parity)) return false
      }
      if (this.teacherRunAfter(l, p, l.coTeacherId) > 6) return false
    }
    // 永不連 7（絕對 6 連）：模擬放置後檢查該日連續數
    if (this.teacherRunAfter(l, p) > 6) return false
    // 硬限制：單日課間空堂最多一段（禁止「上、空、上、空」交錯）
    if (this.teacherGapSegsAfter(l, p) > 1) return false
    // 硬限制：同班同科同日禁止（連堂自身除外）；相鄰日為權重「同科不隔天」
    if (this.subjectSameDayConflict(l, p)) return false
    return true
  }

  /** 同班同科已排在同日？（連堂模式「都可以」的兩堂單節相鄰、不跨午休＝自然成對，放行；第三堂同日仍禁） */
  private subjectSameDayConflict(l: EngineLesson, p: Placement): boolean {
    const cOcc = this.classOcc.get(l.classKey)!
    let sameDay = 0, pairedOk = false
    for (const [slot, id] of Array.from(cOcc)) {
      if (id === l.id) continue
      const other = this.lessonById.get(id)!
      if (other.subject !== l.subject) continue
      const { day, period } = parseSlotKey(slot)
      if (day !== p.day) continue
      sameDay++
      if (l.pairable && other.pairable && l.size === 1 && other.size === 1) {
        const lo = Math.min(period, p.period), hi = Math.max(period, p.period)
        if (hi - lo === 1 && lo !== MORNING_LAST) pairedOk = true
      }
    }
    if (sameDay === 0) return false
    return !(sameDay === 1 && pairedOk)
  }
  /** 「都可以」單節是否已與同科另一單節相鄰成對（供同型態同日計分視為連堂）。 */
  pairedWith(l: EngineLesson, p: Placement): string | null {
    if (!l.pairable) return null
    for (const q of [p.period - 1, p.period + 1]) {
      const id = this.classOcc.get(l.classKey)!.get(`${p.day}-${q}`)
      if (!id || id === l.id) continue
      const o = this.lessonById.get(id)!
      if (o.pairable && o.subject === l.subject && Math.min(q, p.period) !== MORNING_LAST) return id
    }
    return null
  }

  /** 放置後該師當日「課間空堂段數」（取兩週型較差者）。 */
  private teacherGapSegsAfter(l: EngineLesson, p: Placement): number {
    const tOcc = this.teacherOcc.get(l.teacherId)!
    const parities: ('o' | 'e')[] = l.parity === 'weekly' ? ['o', 'e'] : [l.parity === 'odd' ? 'o' : 'e']
    let worst = 0
    for (const par of parities) {
      const taught: number[] = []
      for (let q = 1; q <= 7; q++) {
        const cell = tOcc.get(`${p.day}-${q}`)
        if (cell && (cell.w || cell[par])) taught.push(q)
      }
      taught.push(p.period)
      if (l.size === 2) taught.push(p.period + 1)
      const qs = Array.from(new Set(taught)).sort((a, b) => a - b)
      let segs = 0
      for (let i = 1; i < qs.length; i++) if (qs[i] - qs[i - 1] > 1) segs++
      worst = Math.max(worst, segs)
    }
    return worst
  }

  private teacherRunAfter(l: EngineLesson, p: Placement, rid: string = l.teacherId): number {
    const tOcc = this.teacherOcc.get(rid)!
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
    const occs = [this.teacherOcc.get(l.teacherId)!]
    if (l.coTeacherId) occs.push(this.teacherOcc.get(l.coTeacherId)!)
    for (const s of this.slotsOf(l, p)) {
      cOcc.set(s, l.id)
      for (const tOcc of occs) {
        const cell = tOcc.get(s) ?? {}
        if (l.parity === 'weekly') cell.w = l.id
        else if (l.parity === 'odd') cell.o = l.id
        else cell.e = l.id
        tOcc.set(s, cell)
      }
    }
  }

  remove(l: EngineLesson) {
    const p = this.pos.get(l.id)
    if (!p) return
    this.pos.delete(l.id)
    const cOcc = this.classOcc.get(l.classKey)!
    const occs = [this.teacherOcc.get(l.teacherId)!]
    if (l.coTeacherId) occs.push(this.teacherOcc.get(l.coTeacherId)!)
    for (const s of this.slotsOf(l, p)) {
      cOcc.delete(s)
      for (const tOcc of occs) {
        const cell = tOcc.get(s)
        if (cell) {
          if (l.parity === 'weekly') delete cell.w
          else if (l.parity === 'odd') delete cell.o
          else delete cell.e
          if (!cell.w && !cell.o && !cell.e) tOcc.delete(s)
        }
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

/** 教室分配（scoreState 與 finalize 共用）：管理教師必得自己的教室；
 *  非管理者先用無管理者的教室、再用有管理者的（此時依權重扣分）。回傳 lessonId → roomId。 */
function assignRooms(input: EngineInput, st: State): Map<string, string> {
  const bySubject: Record<string, RoomInfo[]> = {}
  for (const r of input.rooms) (bySubject[r.subject] ??= []).push(r)
  const roomOf = new Map<string, string>()
  const taken = new Map<string, Set<string>>()   // slotKey → roomIds
  const entries: { l: EngineLesson; p: Placement }[] = []
  st.pos.forEach((p, id) => {
    const l = st.lessonById.get(id)!
    if (bySubject[l.subject]) entries.push({ l, p })
  })
  entries.sort((a, b) => {
    const am = bySubject[a.l.subject].some(r => r.managerId === a.l.teacherId) ? 0 : 1
    const bm = bySubject[b.l.subject].some(r => r.managerId === b.l.teacherId) ? 0 : 1
    if (am !== bm) return am - bm                 // 管理教師的課先分
    return a.l.id < b.l.id ? -1 : 1
  })
  for (const { l, p } of entries) {
    const rooms = bySubject[l.subject]
    const slots = st.slotsOf(l, p)
    const free = (r: RoomInfo) => slots.every(s => !(taken.get(s)?.has(r.id)))
    const ordered = [
      ...rooms.filter(r => r.managerId === l.teacherId),   // 自己管理的教室
      ...rooms.filter(r => !r.managerId),                  // 無管理者的教室
      ...rooms.filter(r => r.managerId && r.managerId !== l.teacherId),
    ]
    const room = ordered.find(free)
    if (!room) continue
    roomOf.set(l.id, room.id)
    for (const s of slots) (taken.get(s) ?? taken.set(s, new Set()).get(s)!).add(room.id)
  }
  return roomOf
}

const UNPLACED_PEN = 1e5   // 每堂未排課的罰分：低於「必須」、高於一切軟規則，確保搜尋優先塞入

export function scoreState(st: State): { total: number; soft: number; penalties: RulePenalty[]; uncovered: { classKey: string; slot: string }[] } {
  const { input } = st
  const w = input.weights.builtin
  const map = new Map<string, Acc & { label: string }>()
  const uncovered: { classKey: string; slot: string }[] = []
  const nameOf = (id: string) => input.teacherNames[id] ?? '？'
  const labelOf = (key2: string) => input.classes.find(c => c.classKey === key2)?.label ?? key2

  // 教室分配：管理教師優先（結構）；roomPrefer＝分不到教室、roomManagerFirst＝借用他人管理的教室
  const placedLessons: { l: EngineLesson; p: Placement }[] = []
  st.pos.forEach((p, id) => placedLessons.push({ l: st.lessonById.get(id)!, p }))
  placedLessons.sort((a2, b2) => a2.l.id < b2.l.id ? -1 : 1)
  const roomOf = assignRooms(input, st)
  const subjectHasRooms = new Set(input.rooms.map(r => r.subject))
  const roomById = new Map(input.rooms.map(r => [r.id, r]))
  for (const { l, p } of placedLessons) {
    if (!subjectHasRooms.has(l.subject)) continue
    const rid = roomOf.get(l.id)
    if (!rid) {
      if (w.roomPrefer !== 'off') acc(map, 'roomPrefer', '專科教室優先', pen(w.roomPrefer), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)} 教室不足，回原班`)
      continue
    }
    const r = roomById.get(rid)!
    if (w.roomManagerFirst !== 'off' && r.managerId && r.managerId !== l.teacherId) {
      acc(map, 'roomManagerFirst', '教室管理教師優先', pen(w.roomManagerFirst), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)} 借用 ${r.label}（管理者非授課者）`)
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

  // 排課標記覆蓋（科任）：標記時段必須有該師的課
  for (const [tid, slots] of Object.entries(input.teacherMustTeach ?? {})) {
    const occ = st.teacherOcc.get(tid)
    for (const s of slots) {
      if (!occ?.has(s)) {
        const { day, period } = parseSlotKey(s)
        acc(map, 'mustTeach', '排課標記時段未排課', MUST, `${nameOf(tid)} ${slotZh(day, period)}`)
      }
    }
  }

  // ── 班級面 ──
  // 母開關關閉＝該類子規則全部不計
  const tplAvoid = w.avoidPeriods === 'off' ? [] : input.weights.templates.filter(t => t.template === 'avoidPeriods' && t.level !== 'off')
  const tplTime = w.timePrefer === 'off' ? [] : input.weights.templates.filter(t => t.template === 'timePrefer' && t.level !== 'off')
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
    // 硬限制安全網：同科同日（「都可以」的兩單節相鄰成對＝一個落點，放行）
    {
      const byDay: Record<number, { l: EngineLesson; p: Placement }[]> = {}
      for (const x of arr) (byDay[x.p.day] ??= []).push(x)
      for (const [d, xs] of Object.entries(byDay)) if (xs.length > 1) {
        const paired = xs.length === 2 && xs.every(x => x.l.pairable && x.l.size === 1) && st.pairedWith(xs[0].l, xs[0].p) === xs[1].l.id
        if (!paired) acc(map, 'sameSubjectSameDay', '同科同日（硬限制）', MUST * (xs.length - 1), `${labelOf(key2)} ${subject} 週${DAY_ZH[Number(d)]}排了 ${xs.length} 次`)
      }
    }
    // 同科不隔天（權重）：相鄰兩日各扣一次
    if (w.subjectSpread !== 'off') {
      const uniq = Array.from(new Set(days)).sort()
      for (let i = 1; i < uniq.length; i++) {
        if (uniq[i] - uniq[i - 1] === 1) {
          acc(map, 'subjectSpread', '同科不隔天', pen(w.subjectSpread), `${labelOf(key2)} ${subject} 週${DAY_ZH[uniq[i - 1]]}、週${DAY_ZH[uniq[i]]}連續兩天`)
        }
      }
    }
  })

  // 科任課同日成塊（權重）——同班同日（上、下午各自計）科任課＋鎖課連成一塊，每多一塊扣一次
  if (w.classCohesion !== 'off') for (const c of input.classes) {
    const occ = st.classOcc.get(c.classKey)!
    const avail = new Set(input.classSlots[c.classKey] ?? [])
    const locks = input.lockedCells[c.classKey] ?? {}
    for (const d of SCHEDULE_DAYS) {
      for (const seg of [[1, 2, 3, 4], [5, 6, 7]]) {
        let blocks = 0, inBlock = false
        for (const q of seg) {
          const k = `${d}-${q}`
          const teachable = avail.has(k) || k in locks
          if (!teachable) { inBlock = false; continue }
          const taken = occ.has(k) || k in locks   // 科任課或鎖課＝非導師
          if (taken) { if (!inBlock) blocks++; inBlock = true }
          else inBlock = false
        }
        if (blocks > 1) {
          acc(map, 'classCohesion', '科任課同日成塊', pen(w.classCohesion) * (blocks - 1),
            `${c.label} 週${DAY_ZH[d]}${seg[0] === 1 ? '上午' : '下午'}科任課分成 ${blocks} 塊（與導師課交錯）`)
        }
      }
    }
  }

  // 留白每日平衡（班級的科任課分布＝導師的每日負擔平衡）
  if (w.homeroomBalance !== 'off') {
    for (const c of input.classes) {
      const counts = SCHEDULE_DAYS.map(d => byClassDayCount.get(`${c.classKey}|${d}`) ?? 0)
      const diff = Math.max(...counts) - Math.min(...counts)
      if (diff > 2) acc(map, 'homeroomBalance', '留白每日平衡', pen(w.homeroomBalance) * (diff - 2), `${c.label} 科任課最多日與最少日差 ${diff} 節`)
    }
  }

  // 導師每日節數上限：每班每日留白（可排格−科任課）≤ N
  if (w.homeroomDailyMax.level !== 'off') {
    for (const c of input.classes) {
      const avail = input.classSlots[c.classKey] ?? []
      const occ = st.classOcc.get(c.classKey)!
      for (const d of SCHEDULE_DAYS) {
        const daySlots = avail.filter(s => parseSlotKey(s).day === d)
        const free = daySlots.filter(s => !occ.has(s)).length
        const over = free - w.homeroomDailyMax.n
        if (over > 0) acc(map, 'homeroomDailyMax', `導師每日上限 ${w.homeroomDailyMax.n}`, pen(w.homeroomDailyMax.level) * over, `${c.label} 週${DAY_ZH[d]}留白 ${free} 格，導師恐上超過 ${w.homeroomDailyMax.n} 節`)
      }
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
          const res = { over: 0, run: 0, gaps: 0, segs: 0 }
          if (taught.length === 0) return res
          res.over = Math.max(0, taught.length - w.dailyMax.n)
          let run = 0, best = 0
          for (let q = 1; q <= 7; q++) { run = taught.includes(q) ? run + 1 : 0; best = Math.max(best, run) }
          res.run = Math.max(0, best - w.consecMax.n)
          res.gaps = (taught[taught.length - 1] - taught[0] + 1) - taught.length
          for (let i = 1; i < taught.length; i++) if (taught[i] - taught[i - 1] > 1) res.segs++
          return res
        }
        const eo = evalDay(taughtO), ee = evalDay(taughtE)
        const worse = { over: Math.max(eo.over, ee.over), run: Math.max(eo.run, ee.run), gaps: Math.max(eo.gaps, ee.gaps), segs: Math.max(eo.segs, ee.segs) }
        if (worse.over > 0 && w.dailyMax.level !== 'off') acc(map, 'dailyMax', `每日節數上限 ${w.dailyMax.n}`, pen(w.dailyMax.level) * worse.over, `${nameOf(tid)} 週${DAY_ZH[d]}超 ${worse.over} 節`)
        if (worse.run > 0 && w.consecMax.level !== 'off') acc(map, 'consecMax', `連續授課上限 ${w.consecMax.n}`, pen(w.consecMax.level) * worse.run, `${nameOf(tid)} 週${DAY_ZH[d]}連續超 ${worse.run} 節`)
        if (worse.gaps > 0 && w.compact !== 'off') acc(map, 'compact', '減少零碎空堂', pen(w.compact) * worse.gaps, `${nameOf(tid)} 週${DAY_ZH[d]}有 ${worse.gaps} 節空堂夾在課間`)
        // 硬限制：課間空堂最多一段（禁止上空上空交錯）
        if (worse.segs > 1) acc(map, 'gapAlternate', '課間空堂交錯（硬限制）', MUST * (worse.segs - 1), `${nameOf(tid)} 週${DAY_ZH[d]}空堂分成 ${worse.segs} 段（上空上空）`)
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

  // 同型態同日（權重）：老師當日連堂/單節不混。混得越兇扣越多——以「較少的那一邊」計次，
  // 兼教兩種型態科目的老師（如社會連堂＋數學單節）不會因為 1 堂單節就被重罰。
  if (w.batchType !== 'off') {
    const byTeacherDay = new Map<string, { dbl: number; sgl: number }>()
    const seenPair = new Set<string>()
    for (const { l, p } of placedLessons) {
      const k = `${l.teacherId}|${p.day}`
      const e = byTeacherDay.get(k) ?? { dbl: 0, sgl: 0 }
      const mate = l.size === 1 ? st.pairedWith(l, p) : null
      if (l.size === 2) e.dbl++
      else if (mate) { if (!seenPair.has(l.id)) { e.dbl++; seenPair.add(l.id); seenPair.add(mate) } }   // 自然成對＝一組連堂
      else e.sgl++
      byTeacherDay.set(k, e)
    }
    byTeacherDay.forEach((e, k) => {
      if (e.dbl > 0 && e.sgl > 0) {
        const [tid, d] = k.split('|')
        acc(map, 'batchType', '同型態同日', pen(w.batchType) * Math.min(e.dbl, e.sgl),
          `${nameOf(tid)} 週${DAY_ZH[Number(d)]}連堂 ${e.dbl} 組與單節 ${e.sgl} 堂混排`)
      }
    })
  }

  // 走動成本：老師連續兩節在不同位置（用實際分配到的教室）
  if (w.walkCost !== 'off') {
    const posOf = (l: EngineLesson): RoomInfo | { zone: number; index: number; zoneSize: number; ring: boolean } | null => {
      const rid = roomOf.get(l.id)
      if (rid) return roomById.get(rid)!
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

  // 未排課罰分（搜尋會優先把課塞回去）
  for (const l of input.lessons) {
    if (!st.pos.has(l.id)) acc(map, 'unplaced', '未排課', UNPLACED_PEN, `${l.classLabel} ${l.subject}（${l.teacherName}）`)
  }

  const penalties: RulePenalty[] = []
  let total = 0, soft = 0
  map.forEach((v, k) => {
    penalties.push({ key: k, label: v.label, count: v.count, points: v.points, items: v.items })
    total += v.points
    if (k !== 'unplaced' && v.points / v.count < UNPLACED_PEN) soft += v.points   // 排除未排與必須級
  })
  penalties.sort((x, y) => y.points - x.points)
  return { total, soft, penalties, uncovered }
}

// ══════════════════ 建構＋局部搜尋 ══════════════════

export interface RunProgress { iter: number; best: number; softBest: number; elapsed: number; placed: number; unplaced: number; sinceImproveMs: number }

/** 可分段執行的排課回合：建構於建構子內完成，step() 跑一小段局部搜尋，
 *  finalize() 還原「歷來最佳解」快照並產出結果。供 Worker 分段執行以支援
 *  「收斂自動停」與「中途停止採用目前結果」。 */
export class EngineRun {
  private input: EngineInput
  private st: State
  private rnd: () => number
  private startTime = Date.now()
  private cur = 0
  private bestTotal = 0
  private bestSoft = 0
  private bestPos: Map<string, Placement>
  private lastImprove = Date.now()
  iterations = 0
  // 必排格定向補洞用索引
  private mustTargets: { classKey: string; slot: string }[] = []
  private mustSetByClass = new Map<string, Set<string>>()
  private lessonsByClass = new Map<string, EngineLesson[]>()
  private rankOf = new Map<string, number>()   // 難排順位（0＝最難）：未排安插時優先處理最難的課，模擬人工「先排最難的」
  private anchored = new Set<string>()          // 錨定課：時間極受限老師（不排課多／負載比高）的課，先排且不被別堂逐出——人工排課的「先把行政／輔導團的課釘住」

  /** @param initial 熱啟動落點（兩階段的第二階段用）：以既有解為搜尋起點，不合法的落點靜默略過，
   *  其餘課照常走建構流程補齊。 */
  constructor(input: EngineInput, initial?: { id: string; day: number; period: number }[]) {
    this.input = input
    this.rnd = mulberry32(input.seed)
    this.st = new State(input)

    if (initial?.length) {
      for (const w of initial) {
        const l = this.st.lessonById.get(w.id)
        if (!l || this.st.pos.has(w.id)) continue
        const p = { day: w.day, period: w.period }
        if (this.st.canPlace(l, p)) this.st.place(l, p)
      }
    }

    // 必排格索引
    for (const [key2, slots] of Object.entries(input.classMustFill)) {
      if (!slots.length) continue
      this.mustSetByClass.set(key2, new Set(slots))
      for (const s of slots) this.mustTargets.push({ classKey: key2, slot: s })
    }
    for (const l of input.lessons) this.lessonsByClass.set(l.classKey, [...(this.lessonsByClass.get(l.classKey) ?? []), l])

    // 難排優先（模擬人工排課順序）：
    //   1. 洞少的班先排——班級餘裕＝可排格 − 科任節數（種子班／鎖課多的班餘裕≈0，人工也是先把這些班排完）
    //   2. 緊的老師先排——老師負載比＝節數 ÷ 可用格（不排課多、跨班多的老師）
    //   3. 再看課本身：連堂、單雙週、老師封鎖多、必排格多、老師課多
    const teacherLoad: Record<string, number> = {}
    const teacherSlots: Record<string, Set<string>> = {}
    const classLoad: Record<string, number> = {}
    for (const l of input.lessons) {
      teacherLoad[l.teacherId] = (teacherLoad[l.teacherId] ?? 0) + l.size
      classLoad[l.classKey] = (classLoad[l.classKey] ?? 0) + l.size
      const set = (teacherSlots[l.teacherId] ??= new Set())
      const blocked = input.teacherBlocked[l.teacherId] ?? []
      for (const s of input.classSlots[l.classKey] ?? []) if (!blocked.includes(s)) set.add(s)
    }
    const classSlack = (ck2: string) => (input.classSlots[ck2]?.length ?? 0) - (classLoad[ck2] ?? 0)
    const teacherRatio = (tid: string) => teacherLoad[tid] / Math.max(1, teacherSlots[tid]?.size ?? 1)
    const blockedOf = (tid: string) => input.teacherBlocked[tid]?.length ?? 0
    // 錨定：不排課 ≥ 10 格（如整天輔導團／跨校）或負載比 ≥ 0.85 的老師——她們的課可行落點極少，先排、不被逐出
    for (const l of input.lessons) if (blockedOf(l.teacherId) >= 10 || teacherRatio(l.teacherId) >= 0.85) this.anchored.add(l.id)
    const difficulty = (l: EngineLesson) =>
      (l.size === 2 ? 100 : 0) + (l.parity !== 'weekly' ? 50 : 0)
      + blockedOf(l.teacherId) * 3
      + (input.teacherMustTeach[l.teacherId]?.length ?? 0) * 3
      + (input.classMustFill[l.classKey]?.length ?? 0) * 2
      + teacherLoad[l.teacherId]
    // 錨定老師先用回溯法整批落位（她的課彼此牽制：連堂＋單節＋同科不隔天＋不排課，貪婪一步選錯就把自己堵死，
    // 人工排課會先把這幾位的整週想清楚再排別人）。失敗者退回下方貪婪流程。
    {
      const byTeacher = new Map<string, EngineLesson[]>()
      for (const l of input.lessons) if (this.anchored.has(l.id) && !this.st.pos.has(l.id)) byTeacher.set(l.teacherId, [...(byTeacher.get(l.teacherId) ?? []), l])
      const teachersSorted = Array.from(byTeacher.keys()).sort((x, y) => teacherRatio(y) - teacherRatio(x) || blockedOf(y) - blockedOf(x))
      for (const tid of teachersSorted) {
        const ls = byTeacher.get(tid)!.sort((x, y) => (y.size - x.size) || (classSlack(x.classKey) - classSlack(y.classKey)))
        let nodes = 0
        const dfs = (i: number): boolean => {
          if (i >= ls.length) return true
          if (++nodes > 20000) return false
          const l = ls[i]
          const cands = this.st.candidates(l)
          // 候選順序加一點隨機（種子可重現），避免每個種子走同一條死路
          for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(this.rnd() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]] }
          for (const p of cands) {
            this.st.place(l, p)
            if (dfs(i + 1)) return true
            this.st.remove(l)
          }
          return false
        }
        if (!dfs(0)) for (const l of ls) if (this.st.pos.has(l.id)) this.st.remove(l)   // 整批失敗 → 全部撤回交給貪婪
      }
    }

    // 第零步 A：必排格覆蓋——同一時段多班互搶老師是配對問題，
    // 用二部圖最大匹配（Kuhn 增廣路徑）保證可配就配到
    const bySlot = new Map<string, string[]>()
    for (const t of this.mustTargets) bySlot.set(t.slot, [...(bySlot.get(t.slot) ?? []), t.classKey])
    bySlot.forEach((classKeys, slot) => {
      const p = parseSlotKey(slot)
      const candsOf = new Map<string, EngineLesson[]>()
      for (const ckey of classKeys) {
        if (this.st.classOcc.get(ckey)?.has(slot)) continue
        candsOf.set(ckey, (this.lessonsByClass.get(ckey) ?? []).filter(l =>
          !this.st.pos.has(l.id) && l.size === 1 && l.parity === 'weekly' && this.st.canPlace(l, p)))
      }
      const matchTeacher = new Map<string, { classKey: string; lesson: EngineLesson }>()
      const tryMatch = (ckey: string, seen: Set<string>): boolean => {
        for (const l of candsOf.get(ckey) ?? []) {
          if (seen.has(l.teacherId)) continue
          seen.add(l.teacherId)
          const cur = matchTeacher.get(l.teacherId)
          if (!cur || tryMatch(cur.classKey, seen)) {
            matchTeacher.set(l.teacherId, { classKey: ckey, lesson: l })
            return true
          }
        }
        return false
      }
      for (const ckey of Array.from(candsOf.keys())) tryMatch(ckey, new Set())
      matchTeacher.forEach(({ lesson }) => { if (this.st.canPlace(lesson, p)) this.st.place(lesson, p) })
    })

    // 第零步 B：殘餘的必排格用貪婪補。相鄰兩格都是必排（如整天不排課）時連堂優先，
    // 一次蓋兩格；否則單節優先、連堂彈性留給後面
    for (const t of this.mustTargets) {
      if (this.st.classOcc.get(t.classKey)?.has(t.slot)) continue
      const { day, period } = parseSlotKey(t.slot)
      const mustSet0 = this.mustSetByClass.get(t.classKey)!
      const nextAlsoMust = mustSet0.has(`${day}-${period + 1}`) && !this.st.classOcc.get(t.classKey)?.has(`${day}-${period + 1}`)
      const free = (this.lessonsByClass.get(t.classKey) ?? [])
        .filter(l => !this.st.pos.has(l.id))
        .sort((a, b) => nextAlsoMust ? b.size - a.size : a.size - b.size)
      for (const l of free) {
        const tries: Placement[] = l.size === 2 ? [{ day, period }, { day, period: period - 1 }] : [{ day, period }]
        let ok = false
        for (const p of tries) if (p.period >= 1 && this.st.canPlace(l, p)) { this.st.place(l, p); ok = true; break }
        if (ok) break
      }
    }

    // 錨定課最先（整批、跨班），其餘依 班級餘裕 → 老師負載比 → 課本身難度
    const ordered = [...input.lessons].filter(l => !this.st.pos.has(l.id)).sort((a, b) =>
      (Number(this.anchored.has(b.id)) - Number(this.anchored.has(a.id)))
      || (classSlack(a.classKey) - classSlack(b.classKey))
      || (teacherRatio(b.teacherId) - teacherRatio(a.teacherId))
      || (difficulty(b) - difficulty(a)))
    ordered.forEach((l, i) => this.rankOf.set(l.id, i))

    // 建構：優先覆蓋必排格，其次低節次干擾
    for (const l of ordered) {
      const cands = this.st.candidates(l)
      if (cands.length === 0) continue
      const must = new Set(input.classMustFill[l.classKey] ?? [])
      const tmust = new Set(input.teacherMustTeach[l.teacherId] ?? [])
      let best: Placement | null = null
      let bestScore = Infinity
      for (const p of cands) {
        const slots = l.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
        const coverMust = slots.filter(s =>
          (must.has(s) && !this.st.classOcc.get(l.classKey)!.has(s))
          || (tmust.has(s) && !this.st.teacherOcc.get(l.teacherId)!.has(s))).length
        const score = -coverMust * 1000 + (p.period <= 4 ? 5 : 0) + this.rnd()
        if (score < bestScore) { bestScore = score; best = p }
      }
      if (best) this.st.place(l, best)
    }

    const s0 = scoreState(this.st)
    this.cur = s0.total
    this.bestTotal = s0.total
    this.bestSoft = s0.soft
    this.bestPos = new Map(this.st.pos)

    // 建構後先做幾輪定向補洞
    for (let k = 0; k < this.mustTargets.length * 2; k++) this.tryCoverMustFill()
  }

  private snapshotIfBest(total: number, soft: number) {
    if (total < this.bestTotal) {
      this.bestTotal = total
      this.bestSoft = soft
      this.bestPos = new Map(this.st.pos)
      this.lastImprove = Date.now()
    }
  }

  /** 定向補洞：挑一個未覆蓋的必排格，把該班某堂課搬進來（總分下降才保留）。 */
  /** 成塊補洞（權重）：找出「同班同日（上/下午）科任課分成兩塊」的洞，把該班別處的一堂單節搬進洞裡（人工排課的「補洞」）；權重關閉時不做。 */
  private tryFixCohesion() {
    if (this.input.weights.builtin.classCohesion === 'off') return
    const holes: { classKey: string; slot: string }[] = []
    for (const c of this.input.classes) {
      const cOcc = this.st.classOcc.get(c.classKey)!
      const locks = this.input.lockedCells[c.classKey] ?? {}
      const avail = this.input.classSlots[c.classKey] ?? []
      const mustLeave = this.input.classMustLeave?.[c.classKey] ?? []
      for (const d of SCHEDULE_DAYS) for (const seg of [[1, 2, 3, 4], [5, 6, 7]]) {
        const cells = seg.map(q => `${d}-${q}`).filter(k => avail.includes(k) || k in locks)
        const taken = cells.map(k => cOcc.has(k) || k in locks)
        const first = taken.indexOf(true), last = taken.lastIndexOf(true)
        if (first < 0) continue
        for (let i = first + 1; i < last; i++) if (!taken[i] && !mustLeave.includes(cells[i])) holes.push({ classKey: c.classKey, slot: cells[i] })
      }
    }
    if (!holes.length) return
    const h = holes[Math.floor(this.rnd() * holes.length)]
    const p = parseSlotKey(h.slot)
    const ls = (this.lessonsByClass.get(h.classKey) ?? []).filter(l => l.size === 1 && this.st.pos.has(l.id))
    const start = Math.floor(this.rnd() * Math.max(1, ls.length))
    for (let k = 0; k < ls.length; k++) {
      const l = ls[(start + k) % ls.length]
      const from = this.st.pos.get(l.id)!
      if (from.day === p.day && from.period === p.period) continue
      const bMust = this.mustSetByClass.get(h.classKey)
      if (bMust && bMust.has(`${from.day}-${from.period}`)) continue
      this.st.remove(l)
      if (this.st.canPlace(l, p)) {
        this.st.place(l, p)
        const sc = scoreState(this.st)
        if (sc.total <= this.cur) { this.cur = sc.total; this.snapshotIfBest(sc.total, sc.soft); return }
        this.st.remove(l)
      }
      this.st.place(l, from)
    }
  }

  private tryCoverMustFill() {
    const n = this.mustTargets.length
    if (n === 0) return
    const start = Math.floor(this.rnd() * n)
    for (let k = 0; k < n; k++) {
      const t = this.mustTargets[(start + k) % n]
      const occ = this.st.classOcc.get(t.classKey)
      if (!occ || occ.has(t.slot)) continue
      const { day, period } = parseSlotKey(t.slot)
      const mustSet = this.mustSetByClass.get(t.classKey)!
      const lessons = this.lessonsByClass.get(t.classKey) ?? []
      const off = Math.floor(this.rnd() * Math.max(1, lessons.length))
      for (let j = 0; j < lessons.length; j++) {
        const l = lessons[(off + j) % lessons.length]
        const oldP = this.st.pos.get(l.id) ?? null
        // 原位置若已覆蓋其他必排格則不動它（避免拆東牆補西牆）
        if (oldP && this.st.slotsOf(l, oldP).some(s => mustSet.has(s))) continue
        if (oldP) this.st.remove(l)
        const tries: Placement[] = l.size === 2
          ? [{ day, period }, { day, period: period - 1 }]
          : [{ day, period }]
        let placedAt = false
        for (const p of tries) {
          if (p.period >= 1 && this.st.canPlace(l, p)) { this.st.place(l, p); placedAt = true; break }
        }
        if (placedAt) {
          const sc = scoreState(this.st)
          if (sc.total <= this.cur) {
            this.cur = sc.total
            this.snapshotIfBest(sc.total, sc.soft)
            return
          }
          this.st.remove(l)
        }
        if (oldP) this.st.place(l, oldP)
      }
      // 直接搬入都失敗 → 逐出式：把擋住老師的課搬走，再把本班課放進必排格
      if (this.tryEjectAndCover(t.classKey, day, period, mustSet, lessons, off)) return
      return   // 一次處理一格
    }
  }

  /** 逐出式補洞：本班課 l 想進必排格但老師在該時段有別班的課 → 先把那堂課搬到別處。 */
  private tryEjectAndCover(classKey2: string, day: number, period: number, mustSet: Set<string>, lessons: EngineLesson[], off: number): boolean {
    const avail = this.input.classSlots[classKey2] ?? []
    for (let j = 0; j < lessons.length; j++) {
      const l = lessons[(off + j) % lessons.length]
      const oldP = this.st.pos.get(l.id) ?? null
      if (oldP && this.st.slotsOf(l, oldP).some(s => mustSet.has(s))) continue
      const tries: Placement[] = l.size === 2 ? [{ day, period }, { day, period: period - 1 }] : [{ day, period }]
      for (const p of tries) {
        if (p.period < 1 || (l.size === 2 && p.period + 1 > 7)) continue
        if (l.parity !== 'weekly' && ![1, 3, 5].includes(p.period)) continue
        const slots = l.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
        if (oldP) this.st.remove(l)
        const cOcc = this.st.classOcc.get(classKey2)!
        const blocked = this.input.teacherBlocked[l.teacherId] ?? []
        if (!slots.every(s => avail.includes(s) && !cOcc.has(s) && !blocked.includes(s))) {
          if (oldP) this.st.place(l, oldP)
          continue
        }
        // 找擋路的老師課（最多逐出 2 堂）
        const tOcc = this.st.teacherOcc.get(l.teacherId)!
        const blockers = new Set<string>()
        for (const s of slots) {
          const cell = tOcc.get(s)
          if (!cell) continue
          const ids = [cell.w, l.parity !== 'even' ? cell.o : undefined, l.parity !== 'odd' ? cell.e : undefined]
          for (const id of ids) if (id && id !== l.id) blockers.add(id)
        }
        if (blockers.size === 0 || blockers.size > this.ejectDepth()) {
          if (oldP) this.st.place(l, oldP)
          continue
        }
        // 逐出：blocker 搬到不與目標格重疊的其他合法位置
        const moved: { bl: EngineLesson; from: Placement }[] = []
        let fail = false
        for (const bid of Array.from(blockers)) {
          const bl = this.st.lessonById.get(bid)!
          const from = this.st.pos.get(bid)
          if (!from) { fail = true; break }
          const bMust = this.mustSetByClass.get(bl.classKey)
          if (bMust && this.st.slotsOf(bl, from).some(s => bMust.has(s))) { fail = true; break }
          this.st.remove(bl)
          moved.push({ bl, from })
          const cands = this.st.candidates(bl).filter(pp => {
            const ss = bl.size === 2 ? [`${pp.day}-${pp.period}`, `${pp.day}-${pp.period + 1}`] : [`${pp.day}-${pp.period}`]
            return !ss.some(s => slots.includes(s))
          })
          if (!cands.length) { fail = true; break }
          this.st.place(bl, cands[Math.floor(this.rnd() * cands.length)])
        }
        if (!fail && this.st.canPlace(l, p)) {
          this.st.place(l, p)
          const sc = scoreState(this.st)
          if (sc.total <= this.cur) {
            this.cur = sc.total
            this.snapshotIfBest(sc.total, sc.soft)
            return true
          }
          this.st.remove(l)
        }
        // 還原被逐出的課與本班課
        for (const m of moved.reverse()) {
          if (this.st.pos.has(m.bl.id)) this.st.remove(m.bl)
          this.st.place(m.bl, m.from)
        }
        if (oldP) this.st.place(l, oldP)
      }
    }
    return false
  }

  /** 跑一小段局部搜尋（約 ms 毫秒）。 */
  step(ms: number) {
    const end = Date.now() + ms
    const allLessons = this.input.lessons
    while (Date.now() < end) {
      this.iterations++
      if (this.iterations % 8 === 0) { this.tryCoverMustFill(); continue }
      if (this.iterations % 8 === 6) { this.tryFixCohesion(); continue }
      if (this.iterations % 8 === 4) { this.tryPlaceUnplacedWithEject(); continue }
      if (this.rnd() < 0.3) { this.trySwap(); continue }
      const l = allLessons[Math.floor(this.rnd() * allLessons.length)]
      const oldP = this.st.pos.get(l.id) ?? null
      if (oldP) this.st.remove(l)
      const cands = this.st.candidates(l)
      let moved = false
      if (cands.length > 0) {
        const p = cands[Math.floor(this.rnd() * cands.length)]
        this.st.place(l, p)
        const sc = scoreState(this.st)
        if (sc.total <= this.cur || this.rnd() < 0.02) {
          this.cur = sc.total
          moved = true
          this.snapshotIfBest(sc.total, sc.soft)
        } else this.st.remove(l)
      }
      if (!moved && oldP) this.st.place(l, oldP)
    }
  }

  /** 交換移動：同班或同師的兩堂同型態課互換位置（硬限制緊繃時比單堂移動有效）。 */
  private trySwap() {
    const placedIds = Array.from(this.st.pos.keys())
    if (placedIds.length < 2) return
    const id1 = placedIds[Math.floor(this.rnd() * placedIds.length)]
    const l1 = this.st.lessonById.get(id1)!
    const p1 = this.st.pos.get(id1)!
    const partners: string[] = []
    for (const id of placedIds) {
      if (id === id1) continue
      const l = this.st.lessonById.get(id)!
      if (l.size === l1.size && l.parity === l1.parity && (l.classKey === l1.classKey || l.teacherId === l1.teacherId)) partners.push(id)
    }
    if (!partners.length) return
    const l2 = this.st.lessonById.get(partners[Math.floor(this.rnd() * partners.length)])!
    const p2 = this.st.pos.get(l2.id)!
    this.st.remove(l1); this.st.remove(l2)
    let done = false
    if (this.st.canPlace(l1, p2)) {
      this.st.place(l1, p2)
      if (this.st.canPlace(l2, p1)) {
        this.st.place(l2, p1)
        const sc = scoreState(this.st)
        if (sc.total <= this.cur) { this.cur = sc.total; this.snapshotIfBest(sc.total, sc.soft); done = true }
        else this.st.remove(l2)
      }
      if (!done) this.st.remove(l1)
    }
    if (!done) { this.st.place(l1, p1); this.st.place(l2, p2) }
  }

  /** 未排課逐出安插：把擋住老師的別班課搬走後放入未排課。 */
  private tryPlaceUnplacedWithEject() {
    const unplaced = this.input.lessons.filter(l => !this.st.pos.has(l.id))
    if (!unplaced.length) return
    // 優先處理最難排的未排課（依建構順位），前 3 名中隨機挑一，兼顧多樣性
    unplaced.sort((a, b) => (this.rankOf.get(a.id) ?? 1e9) - (this.rankOf.get(b.id) ?? 1e9))
    const l = unplaced[Math.floor(this.rnd() * Math.min(3, unplaced.length))]
    const avail = this.input.classSlots[l.classKey] ?? []
    const cOcc = this.st.classOcc.get(l.classKey)!
    const blockedT = this.input.teacherBlocked[l.teacherId] ?? []
    const mustLeave = this.input.classMustLeave?.[l.classKey] ?? []
    const start = Math.floor(this.rnd() * Math.max(1, avail.length))
    for (let k = 0; k < avail.length; k++) {
      const p = parseSlotKey(avail[(start + k) % avail.length])
      if (l.size === 2 && p.period >= 7) continue
      if (l.parity !== 'weekly' && ![1, 3, 5].includes(p.period)) continue
      const slots = this.st.slotsOf(l, p)
      // 該班該格：可排、非老師不排課、非必留導師格（班級格被別堂課占住的情況交給下面的逐出）
      if (!slots.every(x => avail.includes(x) && !blockedT.includes(x) && !mustLeave.includes(x))) continue
      if (slots.every(x => !cOcc.has(x)) && this.st.canPlace(l, p)) {
        this.st.place(l, p)
        const sc = scoreState(this.st)
        if (sc.total <= this.cur) { this.cur = sc.total; this.snapshotIfBest(sc.total, sc.soft); return }
        this.st.remove(l)
        continue
      }
      // 逐出（最多 2 堂，不動已覆蓋必排格的課）：
      //   a. 老師衝堂——該師在該時段的別班課
      //   b. 班級格被占——該班該格的別師課（人工排課的「把那堂課搬走騰位子」）
      const tOcc = this.st.teacherOcc.get(l.teacherId)!
      const blockers = new Set<string>()
      for (const x of slots) {
        const cell = tOcc.get(x)
        if (cell) {
          const ids = [cell.w, l.parity !== 'even' ? cell.o : undefined, l.parity !== 'odd' ? cell.e : undefined]
          for (const id of ids) if (id && id !== l.id) blockers.add(id)
        }
        const occId = cOcc.get(x)
        if (occId && occId !== l.id) blockers.add(occId)
      }
      if (blockers.size === 0 || blockers.size > this.ejectDepth()) continue
      if (!this.anchored.has(l.id) && Array.from(blockers).some(id => this.anchored.has(id))) continue   // 錨定課不被非錨定課逐出
      const moved: { bl: EngineLesson; from: Placement }[] = []
      let fail = false
      for (const bid of Array.from(blockers)) {
        const bl = this.st.lessonById.get(bid)!
        const from = this.st.pos.get(bid)
        if (!from) { fail = true; break }
        const bMust = this.mustSetByClass.get(bl.classKey)
        if (bMust && this.st.slotsOf(bl, from).some(x => bMust.has(x))) { fail = true; break }
        this.st.remove(bl); moved.push({ bl, from })
        const cands = this.st.candidates(bl).filter(pp => !this.st.slotsOf(bl, pp).some(x => slots.includes(x)))
        if (!cands.length) { fail = true; break }
        this.st.place(bl, cands[Math.floor(this.rnd() * cands.length)])
      }
      if (!fail && this.st.canPlace(l, p)) {
        this.st.place(l, p)
        const sc = scoreState(this.st)
        if (sc.total <= this.cur) { this.cur = sc.total; this.snapshotIfBest(sc.total, sc.soft); return }
        this.st.remove(l)
      }
      for (const m of moved.reverse()) {
        if (this.st.pos.has(m.bl.id)) this.st.remove(m.bl)
        this.st.place(m.bl, m.from)
      }
    }
  }

  /** 逐出鏈深度：平常最多搬 2 堂；只差 1～2 節（未排／必須級合計 ≤2）時放寬到 4，最後那幾節往往要多搬幾堂才騰得出位。 */
  private ejectDepth() { return this.cur <= 2 * MUST ? 4 : 2 }

  get elapsed() { return Date.now() - this.startTime }
  get sinceImprove() { return Date.now() - this.lastImprove }

  progress(): RunProgress {
    return {
      iter: this.iterations, best: this.bestTotal, softBest: this.bestSoft,
      elapsed: this.elapsed, placed: this.bestPos.size,
      unplaced: this.input.lessons.length - this.bestPos.size,
      sinceImproveMs: this.sinceImprove,
    }
  }

  /** 還原歷來最佳解並產出結果（教室分配、罰分明細、未排原因）。 */
  finalize(): EngineResult {
    const st = new State(this.input)
    this.bestPos.forEach((p, id) => st.place(st.lessonById.get(id)!, p))
    const { total, soft, penalties, uncovered } = scoreState(st)

    const placed: PlacedResult[] = []
    const unplaced: UnplacedResult[] = []
    // 教室分配（與 scoreState 同邏輯：管理教師優先）
    const roomOf = assignRooms(this.input, st)
    const sorted: { l: EngineLesson; p: Placement }[] = []
    st.pos.forEach((p, id) => sorted.push({ l: st.lessonById.get(id)!, p }))
    sorted.sort((a, b) => a.l.id < b.l.id ? -1 : 1)
    for (const { l, p } of sorted) {
      placed.push({ ...l, day: p.day, period: p.period, roomId: roomOf.get(l.id) ?? null })
    }
    for (const l of this.input.lessons) {
      if (st.pos.has(l.id)) continue
      unplaced.push({ lesson: l, reason: unplacedReason(st, l) })
    }

    return {
      placed, unplaced,
      penalties: penalties.filter(p => p.key !== 'unplaced'),   // 未排另有清單，不重複列
      totalPenalty: total, softPenalty: soft,
      uncoveredMustFill: uncovered, iterations: this.iterations, elapsedMs: this.elapsed,
    }
  }
}

export interface RunOptions { timeMs: number; onProgress?: (p: RunProgress) => void }

/** 一次跑完（固定時間預算）。分段執行請直接用 EngineRun。 */
export function runEngine(input: EngineInput, opts: RunOptions): EngineResult {
  const run = new EngineRun(input)
  while (run.elapsed < opts.timeMs) {
    run.step(Math.min(300, opts.timeMs - run.elapsed))
    opts.onProgress?.(run.progress())
  }
  return run.finalize()
}

function unplacedReason(st: State, l: EngineLesson): string {
  const avail = st.input.classSlots[l.classKey] ?? []
  const cOcc = st.classOcc.get(l.classKey)!
  const blocked = st.input.teacherBlocked[l.teacherId] ?? []
  let classFree = 0, teacherClash = 0, blockedHit = 0, coClash = 0, coBlockedHit = 0
  const coBlocked = l.coTeacherId ? (st.input.teacherBlocked[l.coTeacherId] ?? []) : []
  for (const s of avail) {
    if (cOcc.has(s)) continue
    classFree++
    if (blocked.includes(s)) { blockedHit++; continue }
    const cell = st.teacherOcc.get(l.teacherId)!.get(s)
    if (cell && (cell.w || (l.parity !== 'even' && cell.o) || (l.parity !== 'odd' && cell.e))) { teacherClash++; continue }
    if (l.coTeacherId) {
      if (coBlocked.includes(s)) { coBlockedHit++; continue }
      const cc = st.teacherOcc.get(l.coTeacherId)?.get(s)
      if (cc && (cc.w || (l.parity !== 'even' && cc.o) || (l.parity !== 'odd' && cc.e))) coClash++
    }
  }
  if (classFree === 0) return '班級課表已無空格'
  const parts: string[] = [`班級尚有 ${classFree} 空格`]
  if (teacherClash) parts.push(`其中 ${teacherClash} 格老師已有課`)
  if (blockedHit) parts.push(`${blockedHit} 格為老師不排課時段`)
  if (coClash) parts.push(`${coClash} 格外師 ${l.coTeacherName ?? ''} 已在別班`)
  if (coBlockedHit) parts.push(`${coBlockedHit} 格外師不可到校`)
  if (l.size === 2) parts.push('連堂需相鄰兩格皆可用')
  if (l.parity !== 'weekly') parts.push(`單雙週起始節次限制（${l.parity === 'odd' ? '1,3,5' : '2,4,6'}）`)
  return parts.join('；')
}
