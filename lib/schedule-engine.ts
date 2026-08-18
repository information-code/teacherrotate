// 排課引擎：只排「科任課」。班級課表的留白＝導師自排空間。
// 三階段：組裝（assembleEngineInput）→ 建構＋局部搜尋（runEngine）→ 罰分明細報告。
// 硬限制：班/師/教室同時段唯一、年段可排時段、鎖課格、教師不排課、永不連 7（絕對 6 連；導師側＝班級整天日至少 1 堂科任/鎖課）、上空上空、同科同日、連堂不跨午休、外師唯一/不可到校。
// 權重（2026-08 依 114-2 人工課表檢核降為可調）：同科不隔天、科任課同日成塊、同型態同日。
// 建構模擬人工排課：錨定老師（不排課多／負載比高）先回溯整批落位 → 洞少的班先排 → 緊的老師先排；
// 局部搜尋含必排格覆蓋、成塊補洞、未排課逐出（同師衝堂或占格的別師課）。
// 軟限制：權重設定（關/低/中/高＝0/1/3/9；必須＝1e6 大罰分，違反時列入報告但不卡死搜尋）。
// 週型（parity）：視藝單雙週連堂——班級格整週占用（另一週保留給導師），教師只占自己的週型，
// 故視藝老師可交錯服務單週組（起始節 1,3,5）與雙週組（起始節 2,4,6）。

import {
  SCHEDULE_DAYS, WEIGHT_PENALTY, HOMEROOM_SELF, LOCK_COLORS,
  bandOf, shouldUseRoom, classKey as ck, classLabel, subjectClassKey, parseSlotKey, roomLabel, deriveNativeSessions, foreignDemand, doubleModeOf,
  DAY_MODE_LABEL,
  type ScheduleConfig, type ScheduleWeights, type WeightLevel, type TemplateRule, type DaySpread,
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

export interface RoomInfo { id: string; label: string; subject: string; managerIds: string[]; zone: number; index: number; zoneSize: number; ring: boolean; floor: number }

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
  hourlyTeachers: string[]                   // 鐘點教師 id：每週分布傾向另用 hourlyBalance（多半要集中、少跑幾趟）
  rooms: RoomInfo[]                          // 科任教室（有綁科目者參與容量/走動計算）
  classRoom: Record<string, { zone: number; index: number; zoneSize: number; ring: boolean; floor: number } | null>
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

export interface PreflightIssue { level: 'error' | 'warn' | 'info'; text: string; tab?: string; href?: string }   // info＝說明性、不是問題   // tab＝排課設定分頁 key、href＝其他頁面完整路徑（引導按鈕用，href 優先）

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

/** 區域的樓層字串 → 數字（"1"/"2"/"3"）。解析不出來回 NaN，走動成本會退回「不看樓層」的舊算法。 */
export function floorNum(floor: string): number {
  const n = Number(String(floor ?? '').trim())
  return Number.isFinite(n) ? n : NaN
}

/** 兩個位置之間的走動距離。
 *  同區＝位置差（環狀區取繞回去的較短邊）；不同區同層＝4；跨樓＝4＋3×樓層差（爬樓梯比同層走過去累得多）。
 *  樓層解析不出來時退回 4，與未支援樓層前的行為相同。 */
export function walkDistance(
  a: { zone: number; index: number; zoneSize: number; ring: boolean; floor: number },
  b: { zone: number; index: number; zoneSize: number; ring: boolean; floor: number },
): number {
  if (a.zone === b.zone) {
    const raw = Math.abs(a.index - b.index)
    return a.ring ? Math.min(raw, a.zoneSize - raw) : raw
  }
  const df = Math.abs(a.floor - b.floor)
  return Number.isFinite(df) ? 4 + 3 * df : 4
}

/** 由排課設定重建科任教室清單（有綁科目者）。 */
export function roomsFromConfig(config: ScheduleConfig): RoomInfo[] {
  const rooms: RoomInfo[] = []
  config.roomZones.forEach((z, zi) => {
    z.rooms.forEach((r, ri) => {
      if (r.kind === 'subject' && r.subject) {
        rooms.push({ id: r.id, label: roomLabel(r) || r.subject, subject: r.subject, managerIds: r.managerIds ?? [], zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring, floor: floorNum(z.floor) })
      }
    })
  })
  return rooms
}

/** 手動調整後重新分配教室（與排課時同邏輯：管理教師必得自己的教室、
 *  非管理者先用無管理者教室）。失去教室的課 roomId=null＝回原班，零警告。 */
export function reassignRooms(placed: PlacedResult[], rooms: RoomInfo[], weights?: ScheduleWeights): PlacedResult[] {
  const bySubject: Record<string, RoomInfo[]> = {}
  for (const r of rooms) (bySubject[r.subject] ??= []).push(r)
  // 專科教室使用時機（自然單節留原班等）；未帶 weights 時維持舊行為＝一律使用
  const wants = (p: PlacedResult) => Boolean(bySubject[p.subject]) && (!weights || shouldUseRoom(weights, p.subject, p.grade, p.size))
  // 固定硬限制：管理教師的課一定在自己管理的教室。手動微調重分配時同樣遵守——
  // 管理教師只看自己的教室，非管理教師撿還空著的（優先無管理者的那些）。
  const usable = (rs: RoomInfo[], teacherId: string) =>
    rs.some(r => r.managerIds.includes(teacherId))
      ? rs.filter(r => r.managerIds.includes(teacherId))
      : rs
  const taken = new Map<string, Map<string, TCell>>()   // 週型感知：單雙週輪流用同一格可共用
  const roomOf = new Map<string, string>()
  const entries = placed.filter(wants)
  entries.sort((a, b) => {
    const am = bySubject[a.subject].some(r => r.managerIds.includes(a.teacherId)) ? 0 : 1
    const bm = bySubject[b.subject].some(r => r.managerIds.includes(b.teacherId)) ? 0 : 1
    if (am !== bm) return am - bm
    return a.id < b.id ? -1 : 1
  })
  for (const p of entries) {
    const slots = p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
    const rs = bySubject[p.subject]
    const ordered = [
      ...usable(rs, p.teacherId).filter(r => r.managerIds.includes(p.teacherId)),
      ...usable(rs, p.teacherId).filter(r => r.managerIds.length === 0),
      ...usable(rs, p.teacherId).filter(r => r.managerIds.length > 0 && !r.managerIds.includes(p.teacherId)),
    ]
    const room = ordered.find(r => slots.every(s => !roomClash(taken.get(s)?.get(r.id), p.parity)))
    if (room) {
      roomOf.set(p.id, room.id)
      for (const s of slots) {
        const m = taken.get(s) ?? taken.set(s, new Map()).get(s)!
        const cell = m.get(room.id) ?? {}
        if (p.parity === 'weekly') cell.w = p.id
        else if (p.parity === 'odd') cell.o = p.id
        else cell.e = p.id
        m.set(room.id, cell)
      }
    }
  }
  return placed.map(p => ({ ...p, roomId: wants(p) ? (roomOf.get(p.id) ?? null) : (bySubject[p.subject] ? null : (p.roomId ?? null)) }))
}

export interface AssembleArgs {
  config: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, { name: string; perClass: number; homeroom: boolean }[]>
  gradeHomeroomBase: Record<number, number>
  teacherNames: Record<string, string>
  /** 鐘點教師 id 清單（聘任別 hourly）：供「鐘點每週分布傾向」辨識對象。 */
  hourlyTeacherIds?: string[]
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
      // 導師還要排進留白的節數＝該班導師實際配課合計（有配課資料時）− 已鎖在固定格的導師科目（種子班鎖課國數班會、游泳等）
      // 無配課資料時退回年級基本（已扣採用情境減課）
      // 只算該年級有開的科目（導師配課資料可能殘留他年級科目，如四年級導師還留著「生活 3」——統計頁的合計也不含）
      const gradeSubjNames = new Set((gradeSubjects[g] ?? []).map(s2 => s2.name))
      const hrBd0 = a.homeroomHours?.[key]
      const hrBd = hrBd0 ? Object.fromEntries(Object.entries(hrBd0).filter(([k2]) => gradeSubjNames.has(k2))) : undefined
      let need = a.gradeHomeroomBase[g] ?? 0
      if (hrBd && Object.values(hrBd).some(v => Number(v) > 0)) {
        const total = Object.values(hrBd).reduce((s2, v) => s2 + (Number(v) || 0), 0)
        const hrSubjects = new Set(Object.keys(hrBd).filter(k2 => Number(hrBd[k2]) > 0))
        let lockedHr = 0
        for (const tid of Object.values(locks)) { const t = lockTypeMap[tid]; if (t && !t.isNative && hrSubjects.has(t.subject)) lockedHr++ }
        need = Math.max(0, total - lockedHr)
      }
      if (leftover < 0) agg.overCap.push(`${classLabel(g, i)}（${lessonPeriods}/${slots.length}）`)
      else if (need > 0 && leftover + biBlocks * 2 < need) agg.leftoverLow.push(`${classLabel(g, i)}（${leftover + biBlocks * 2}/${need}）`)
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
        classRoom[r.classKey] = { zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring, floor: floorNum(z.floor) }
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
  // 專科教室容量防呆（error，擋住排課）：管理教師的課硬綁定自己的教室，
  // 所以掛在同一間教室的管理教師，其課數不能超過該教室一週能放的量——超過就是怎麼排都不可能。
  {
    const roomsBySubject: Record<string, RoomInfo[]> = {}
    for (const r of rooms) (roomsBySubject[r.subject] ??= []).push(r)
    // 一間教室一週能放幾組連堂／幾節單節：連堂不跨午休（上午 1-4 放 2 組、下午 5-7 放 1 組）
    const capOf = (grades: Set<number>) => {
      let dbl = 0, single = 0
      for (const d of SCHEDULE_DAYS) {
        let am = 0, pm = 0
        for (const g of grades) {
          const grid = config.bands[bandOf(g)]
          am = Math.max(am, [1, 2, 3, 4].filter(q => grid.teachable[`${d}-${q}`]).length)
          pm = Math.max(pm, [5, 6, 7].filter(q => grid.teachable[`${d}-${q}`]).length)
        }
        dbl += Math.floor(am / 2) + Math.floor(pm / 2)
        single += am + pm
      }
      return { dbl, single }
    }
    const over: string[] = []
    for (const [subj, rs] of Object.entries(roomsBySubject)) {
      for (const r of rs) {
        if (r.managerIds.length === 0) continue
        const mine = lessons.filter(l => l.subject === subj && r.managerIds.includes(l.teacherId)
          && shouldUseRoom(config.weights, l.subject, l.grade, l.size))
        if (!mine.length) continue
        const grades = new Set(mine.map(l => l.grade))
        const cap = capOf(grades)
        const dbl = mine.filter(l => l.size === 2).length, single = mine.filter(l => l.size === 1).length
        // 連堂占 2 節、單節占 1 節；以節數為總量檢核，並另外檢查連堂組數
        const needSlots = dbl * 2 + single
        if (dbl > cap.dbl || needSlots > cap.single) {
          const who = r.managerIds.map(i => a.teacherNames[i] ?? i).join('、')
          over.push(`${r.label}（管理教師 ${who}）需 ${dbl} 組連堂＋${single} 節單節＝${needSlots} 節，該教室每週最多 ${cap.dbl} 組連堂／${cap.single} 節`)
        }
      }
    }
    if (over.length) preflight.push({
      level: 'error', tab: 'room',
      text: `專科教室排不下：管理教師的課必須排在自己管理的教室，但下列教室的課量已超過容量，怎麼排都不可能——請增加教室、調整管理教師，或把部分班級改為不使用專科教室。${joinCap(over)}`,
    })
  }
  // 導師每日節數上限（權重）可行性：每天要把導師壓到 N 節，該日就得有「格數 − N」節科任課。
  // 全週加總超過該班的科任節數＝這條規則怎麼排都達不到（不會卡死，但會一直吃罰分）——先講明白。
  {
    const { level, n: hrN } = config.weights.builtin.homeroomDailyMax
    const nodesByClass: Record<string, number> = {}
    for (const l of lessons) nodesByClass[l.classKey] = (nodesByClass[l.classKey] ?? 0) + l.size
    const short: string[] = []
    if (level !== 'off') for (const c of classes) {
      const avail = new Set(classSlots[c.classKey] ?? [])
      let need = 0
      for (const d of SCHEDULE_DAYS) {
        const cnt = Array.from(avail).filter(s => parseSlotKey(s).day === d).length
        need += Math.max(0, cnt - hrN)
      }
      const have = nodesByClass[c.classKey] ?? 0
      if (have < need) short.push(`${c.label}（需 ${need} 節／科任課僅 ${have} 節）`)
    }
    if (short.length) preflight.push({
      level: 'info', tab: 'weight',
      text: `導師每日節數上限 ${hrN} 節：這些班的科任課節數不足以完全達標，會殘留超標（權重＝盡量，不會卡住排課，其餘班級照樣壓到 ${hrN} 節，這幾班也會盡量壓近）：${joinCap(short)}——想完全消掉可於配課統計增加該班科任課，或調高上限。`,
    })
  }
  // 導師連上上限（硬限制）可行性：每段長度 L 的連續可排格，需要 ceil((L−N)/(N+1)) 堂科任課／鎖課切開；
  // 全週加總若多於該班的科任課堂數，就是怎麼排都必然違反——先在前置檢核講明白，別讓精靈白跑一輪。
  {
    const { maxRunHomeroom: hrN, homeroomRunBands } = config.weights.hardParams
    const runBands = new Set(homeroomRunBands)
    const lessonsByClass: Record<string, number> = {}
    for (const l of lessons) lessonsByClass[l.classKey] = (lessonsByClass[l.classKey] ?? 0) + 1
    const short: string[] = []
    if (runBands.size) for (const c of classes) {
      if (!runBands.has(bandOf(c.grade))) continue
      const avail = new Set(classSlots[c.classKey] ?? [])
      let need = 0
      for (const d of SCHEDULE_DAYS) {
        let run = 0
        for (let q = 1; q <= 8; q++) {
          if (q <= 7 && avail.has(`${d}-${q}`)) { run++; continue }
          if (run > hrN) need += Math.ceil((run - hrN) / (hrN + 1))
          run = 0
        }
      }
      const have = lessonsByClass[c.classKey] ?? 0
      if (have < need) short.push(`${c.label}（需 ${need} 堂／科任課 ${have} 堂）`)
    }
    if (short.length) preflight.push({
      level: 'error', tab: 'weight',
      text: `導師連上上限 ${hrN} 節（硬限制）需要科任課把連續留白切開，但這些班的科任課堂數不足、必然違反：${joinCap(short)}——請調高上限、縮小適用年段，或增加該班科任課。`,
    })
  }
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
    // 預設就是「隨機（精靈自動分配）」，這不是問題、只是告知；配課統計配完＝供給齊了，配班是可選的固定
    const totalAuto = Array.from(autoAgg.values()).reduce((s2, n) => s2 + n, 0)
    preflight.push({ level: 'info', text: `${totalAuto} 個班科由精靈依配課節數自動配班（未手動指定授課老師）——這是預設行為；只有要固定某班由誰上時才需到科任配班指定。`, tab: 'subject' })
  }
  if (agg.leftoverLow.length) preflight.push({ level: 'warn', text: `班級課表塞不下：導師要排進留白的節數多於留白格（留白/導師待排＝導師實際配課−已鎖固定格）——請於配課統計調整該班導師或科任的節數：${joinCap(agg.leftoverLow)}`, href: '/admin/allocation-statistics' })
  if (agg.artBiweekly.length) preflight.push({ level: 'warn', text: `單雙週連堂假設每週均攤 1 節，但每班節數不同：${joinCap(agg.artBiweekly)}`, tab: 'weight' })
  const noManager = rooms.filter(r => r.managerIds.length === 0).map(r => r.label)
  if (noManager.length) preflight.push({ level: 'info', text: `未指定管理教師的科任教室（「教室管理教師優先」權重不作用於這些教室，其餘照常）：${joinCap(noManager)}`, tab: 'room' })
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
      teacherBlocked, teacherMustTeach, teacherNames: a.teacherNames, hourlyTeachers: a.hourlyTeacherIds ?? [], rooms, classRoom,
      weights: config.weights, seed: a.seed ?? 42,
    },
    preflight,
  }
}

// ══════════════════ 引擎狀態 ══════════════════

/** 上午最後一節：連堂不得由此節起始（會跨午休）；上/下午分段亦以此為界。 */
const MORNING_LAST = 4

type TCell = { w?: string; o?: string; e?: string }

/** 這堂課是不是該教室管理教師的課（占用優先權判斷用）。 */
function isMgrLesson(st: State, lessonId: string, roomId: string): boolean {
  return Boolean(st.mgrRooms.get(lessonId)?.some(r => r.id === roomId))
}

/** 教室該格是否已被此週型占用。單週課與雙週課輪流用同一格，可以共用；週課與兩者皆衝突。 */
function roomClash(cell: TCell | undefined, parity: Parity): boolean {
  if (!cell) return false
  if (cell.w) return true
  if (parity === 'weekly') return Boolean(cell.o || cell.e)
  return parity === 'odd' ? Boolean(cell.o) : Boolean(cell.e)
}

class State {
  input: EngineInput
  pos: Map<string, Placement> = new Map()                      // lessonId → 位置
  classOcc: Map<string, Map<string, string>> = new Map()       // classKey → slot → lessonId（班級格整週占用）
  teacherOcc: Map<string, Map<string, TCell>> = new Map()      // teacherId → slot → 週型占用
  lessonById: Map<string, EngineLesson> = new Map()
  // 管理教師的課＝硬綁定自己的專科教室，排課當下就占住（跟班級、老師同級的資源）。
  // 非管理教師不在這裡預約，排完之後才撿剩下的空教室（assignRooms）。
  roomOcc: Map<string, Map<string, TCell>> = new Map()         // roomId → slot → 週型占用（單雙週輪流用同一格＝可共用）
  roomPool: Map<string, RoomInfo[]> = new Map()                // lessonId → 這堂課可用的教室清單（空＝不需要教室）
  mgrRooms: Map<string, RoomInfo[]> = new Map()                // lessonId → 有管理教室者的自管教室（供排序與計分辨識）
  roomOf: Map<string, string> = new Map()                      // lessonId → 已占用的 roomId

  constructor(input: EngineInput) {
    this.input = input
    for (const r of input.rooms) this.roomOcc.set(r.id, new Map())
    for (const l of input.lessons) {
      if (!shouldUseRoom(input.weights, l.subject, l.grade, l.size)) continue
      const same = input.rooms.filter(r => r.subject === l.subject)
      if (!same.length) continue
      const mine = same.filter(r => r.managerIds.includes(l.teacherId))
      // 有管理教室的老師只用自己那間；沒有的則整科的教室都可用（可跨間跑）
      if (mine.length) this.mgrRooms.set(l.id, mine)
      this.roomPool.set(l.id, mine.length ? mine : same)
    }
    for (const l of input.lessons) this.lessonById.set(l.id, l)
    for (const c of input.classes) this.classOcc.set(c.classKey, new Map())
    for (const l of input.lessons) if (!this.teacherOcc.has(l.teacherId)) this.teacherOcc.set(l.teacherId, new Map())
    for (const l of input.lessons) if (l.coTeacherId && !this.teacherOcc.has(l.coTeacherId)) this.teacherOcc.set(l.coTeacherId, new Map())
  }

  /** 某教室某格，對這堂課而言是否「真的空著」（週型感知）。 */
  private roomSlotFree(roomId: string, slot: string, l: EngineLesson): boolean {
    const cell = this.roomOcc.get(roomId)!.get(slot)
    if (!cell || !roomClash(cell, l.parity)) return true
    return [cell.w, cell.o, cell.e].every(id => !id || id === l.id)
  }
  /** 這堂課若放在 p，教室 roomId 是否可用；管理教師可把「借用中的非管理教師」趕走，
   *  但被趕的人必須換得到別間（同科、該時段空著），否則不准趕。
   *  回傳 null＝不可用；否則回傳需要搬走的人與新教室（空陣列＝直接可用）。 */
  private planRoom(roomId: string, l: EngineLesson, p: Placement): { id: string; to: string }[] | null {
    const slots = this.slotsOf(l, p)
    if (slots.every(sl => this.roomSlotFree(roomId, sl, l))) return []
    if (!isMgrLesson(this, l.id, roomId)) return null           // 非管理教師只能用真正空的
    // 找出擋路的人：全部得是非管理教師（管理者之間不互趕）
    const blockers = new Set<string>()
    for (const sl of slots) {
      const cell = this.roomOcc.get(roomId)!.get(sl)
      if (!cell || !roomClash(cell, l.parity)) continue
      for (const id of [cell.w, cell.o, cell.e]) {
        if (!id || id === l.id) continue
        if (isMgrLesson(this, id, roomId)) return null
        blockers.add(id)
      }
    }
    // 幫每位被趕的人找新教室（同科、其時段真的空著）；多人同時換要避免搶同一間
    const moves: { id: string; to: string }[] = []
    const claimed = new Map<string, Set<string>>()   // newRoom → slots 已被本次搬遷預約
    for (const id of blockers) {
      const bl = this.lessonById.get(id)!
      const bp = this.pos.get(id)!
      const bslots = this.slotsOf(bl, bp)
      const pool = (this.roomPool.get(id) ?? []).filter(r => r.id !== roomId)
      const to = pool.find(r => bslots.every(sl => this.roomSlotFree(r.id, sl, bl) && !claimed.get(r.id)?.has(sl)))
      if (!to) return null
      moves.push({ id, to: to.id })
      for (const sl of bslots) (claimed.get(to.id) ?? claimed.set(to.id, new Set()).get(to.id)!).add(sl)
    }
    return moves
  }
  private occupyRoom(lessonId: string, roomId: string, slots: string[], parity: Parity) {
    this.roomOf.set(lessonId, roomId)
    for (const s of slots) {
      const cell = this.roomOcc.get(roomId)!.get(s) ?? {}
      if (parity === 'weekly') cell.w = lessonId
      else if (parity === 'odd') cell.o = lessonId
      else cell.e = lessonId
      this.roomOcc.get(roomId)!.set(s, cell)
    }
  }
  private releaseRoom(lessonId: string) {
    const rid = this.roomOf.get(lessonId)
    const p = this.pos.get(lessonId)
    if (!rid || !p) return
    const l = this.lessonById.get(lessonId)!
    for (const sl of this.slotsOf(l, p)) {
      const cell = this.roomOcc.get(rid)!.get(sl)
      if (!cell) continue
      if (cell.w === lessonId) delete cell.w
      if (cell.o === lessonId) delete cell.o
      if (cell.e === lessonId) delete cell.e
      if (!cell.w && !cell.o && !cell.e) this.roomOcc.get(rid)!.delete(sl)
    }
    this.roomOf.delete(lessonId)
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
      if (this.teacherRunAfter(l, p, l.coTeacherId) > this.input.weights.hardParams.maxRunTeacher) return false
    }
    // 連續授課絕對上限（預設 6＝永不連 7）：模擬放置後檢查該日連續數
    if (this.teacherRunAfter(l, p) > this.input.weights.hardParams.maxRunTeacher) return false
    // 硬限制：單日課間空堂最多一段（禁止「上、空、上、空」交錯）
    if (this.teacherGapSegsAfter(l, p) > 1) return false
    // 硬限制：同班同科同日禁止（連堂自身除外）；相鄰日為權重「同科不隔天」
    if (this.subjectSameDayConflict(l, p)) return false
    // 硬限制：專科教室。所有依設定要進專科教室的課，該時段都必須有教室可用，否則不准排在這裡——
    // 管理教師只認自己管理的那間（可趕走借用者，但得幫對方換到別間）；沒有管理教室的老師則整科任一間皆可。
    // 沒教室不是回原班，是換時段；整週都塞不進才會成為未排（明著卡住，不悄悄降級）。
    const pool = this.roomPool.get(l.id)
    if (pool && !pool.some(r => this.planRoom(r.id, l, p) !== null)) return false
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
    const pool = this.roomPool.get(l.id)
    if (pool) {
      const slots = this.slotsOf(l, p)
      // 直接空著的優先；沒有才動用管理者的優先權（趕走借用者並幫他換教室）
      let chosen: RoomInfo | undefined, moves: { id: string; to: string }[] = []
      for (const r of pool) { const m = this.planRoom(r.id, l, p); if (m && m.length === 0) { chosen = r; break } }
      if (!chosen) for (const r of pool) { const m = this.planRoom(r.id, l, p); if (m) { chosen = r; moves = m; break } }
      if (chosen) {
        for (const mv of moves) {
          const bl = this.lessonById.get(mv.id)!, bp = this.pos.get(mv.id)!
          this.releaseRoom(mv.id)
          this.occupyRoom(mv.id, mv.to, this.slotsOf(bl, bp), bl.parity)
        }
        this.occupyRoom(l.id, chosen.id, slots, l.parity)
      }
    }
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
    this.releaseRoom(l.id)   // 要在 pos 刪除前釋放教室（releaseRoom 靠 pos 找時段）
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
/** 教室分配。管理教師的課在排課當下（State.place）就綁定了自己的教室，這裡照抄。
 *  非管理教師沒有那層保護，放置當下若剛好沒空教室就會空手——但之後別人可能搬走、教室空出來，
 *  故排完後再替所有沒拿到教室的課補撿一次（優先撿無管理者的教室，避免占用管理者的地盤）。 */
function assignRooms(input: EngineInput, st: State): Map<string, string> {
  const roomOf = new Map(st.roomOf)
  const bySubject: Record<string, RoomInfo[]> = {}
  for (const r of input.rooms) (bySubject[r.subject] ??= []).push(r)
  // 目前占用：以已分配結果重建（週型感知）
  const taken = new Map<string, Map<string, TCell>>()
  const mark = (l: EngineLesson, p: Placement, roomId: string) => {
    for (const sl of st.slotsOf(l, p)) {
      const m = taken.get(sl) ?? taken.set(sl, new Map()).get(sl)!
      const cell = m.get(roomId) ?? {}
      if (l.parity === 'weekly') cell.w = l.id
      else if (l.parity === 'odd') cell.o = l.id
      else cell.e = l.id
      m.set(roomId, cell)
    }
  }
  roomOf.forEach((rid, id) => {
    const p = st.pos.get(id)
    if (p) mark(st.lessonById.get(id)!, p, rid)
  })
  // 補撿：仍未拿到教室、但依設定該進教室的課
  const rest: { l: EngineLesson; p: Placement }[] = []
  st.pos.forEach((p, id) => {
    if (roomOf.has(id)) return
    const l = st.lessonById.get(id)!
    if (bySubject[l.subject] && shouldUseRoom(input.weights, l.subject, l.grade, l.size)) rest.push({ l, p })
  })
  rest.sort((a, b) => (a.l.id < b.l.id ? -1 : 1))
  for (const { l, p } of rest) {
    const slots = st.slotsOf(l, p)
    const free = (r: RoomInfo) => slots.every(sl => !roomClash(taken.get(sl)?.get(r.id), l.parity))
    const rooms = bySubject[l.subject]
    const room = rooms.filter(r => r.managerIds.length === 0).find(free) ?? rooms.find(free)
    if (room) { roomOf.set(l.id, room.id); mark(l, p, room.id) }
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

  // 教室分配：排課當下已依硬限制決定（見 State.planRoom）；這裡只計「教室固定」權重＝借用者本週用了幾間
  const placedLessons: { l: EngineLesson; p: Placement }[] = []
  st.pos.forEach((p, id) => placedLessons.push({ l: st.lessonById.get(id)!, p }))
  placedLessons.sort((a2, b2) => a2.l.id < b2.l.id ? -1 : 1)
  const roomOf = assignRooms(input, st)
  const subjectHasRooms = new Set(input.rooms.map(r => r.subject))
  const roomById = new Map(input.rooms.map(r => [r.id, r]))
  for (const { l, p } of placedLessons) {
    if (!subjectHasRooms.has(l.subject)) continue
    if (!shouldUseRoom(input.weights, l.subject, l.grade, l.size)) continue   // 依設定本來就該留原班，不算「教室不足」
    const rid = roomOf.get(l.id)
    if (!rid) continue   // 依設定該進教室的課，canPlace 已保證一定有教室；沒有 roomId 的只會是設定為不使用教室者
    const r = roomById.get(rid)!
    if (w.roomManagerFirst !== 'off' && r.managerIds.length > 0 && !r.managerIds.includes(l.teacherId)) {
      acc(map, 'roomManagerFirst', '教室固定（借用他人教室）', pen(w.roomManagerFirst), `${l.classLabel} ${l.subject} ${slotZh(p.day, p.period)} 借用 ${r.label}（管理者非授課者）`)
    }
  }
  // 同一位老師本週用了幾間教室——每多一間扣一次（使用者要求：擠不下時盡量集中在同一間）
  if (w.roomManagerFirst !== 'off') {
    const roomsOfTeacher = new Map<string, Set<string>>()
    for (const { l } of placedLessons) {
      const rid = roomOf.get(l.id)
      if (rid) (roomsOfTeacher.get(l.teacherId) ?? roomsOfTeacher.set(l.teacherId, new Set()).get(l.teacherId)!).add(rid)
    }
    roomsOfTeacher.forEach((set, tid) => {
      if (set.size > 1) acc(map, 'roomManagerFirst', '教室固定（借用他人教室）', pen(w.roomManagerFirst) * (set.size - 1), `${nameOf(tid)} 本週用了 ${set.size} 間教室`)
    })
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
  const tplApart = w.subjectApart === 'off' ? [] : input.weights.templates.filter(t => t.template === 'subjectApart' && t.level !== 'off' && t.subjects.length >= 2)
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
  })

  // 科目互斥同日（權重）：子規則列的幾科，同班同一天出現超過一科即扣（每多一科扣一次）
  if (tplApart.length) {
    const subjByClassDay = new Map<string, Set<string>>()
    for (const { l, p } of placedLessons) {
      const k = `${l.classKey}|${p.day}`
      const set = subjByClassDay.get(k) ?? new Set<string>()
      set.add(l.subject); subjByClassDay.set(k, set)
    }
    for (const c of input.classes) for (const d of SCHEDULE_DAYS) {
      const set = subjByClassDay.get(`${c.classKey}|${d}`)
      if (!set) continue
      for (const t of tplApart) {
        if (t.grades.length && !t.grades.includes(c.grade)) continue
        const hit = t.subjects.filter(s => set.has(s))
        if (hit.length > 1) acc(map, `tpl-apart-${t.id}`, `科目互斥同日：${t.subjects.join('／')}`, pen(t.level) * (hit.length - 1), `${c.label} 週${DAY_ZH[d]} ${hit.join('＋')}`)
      }
    }
  }

  // 硬限制：導師連上上限——班級同日連續留白（無科任課、無鎖課）不得超過 maxRunHomeroom（預設 3＝不連四）。
  // 目的是導師不會整個上午連上四節、中間沒有一節科任課可以喘口氣／改作業。
  // 引擎只排科任課，導師側靠「該段留白被科任課或鎖課切開」保證；適用年段可於權重頁調整（清空＝停用）。
  const runBands = new Set(input.weights.hardParams.homeroomRunBands)
  if (runBands.size) for (const c of input.classes) {
    if (!runBands.has(bandOf(c.grade))) continue
    const occ = st.classOcc.get(c.classKey)!
    const avail = new Set(input.classSlots[c.classKey] ?? [])
    const locks = input.lockedCells[c.classKey] ?? {}
    const maxRun = input.weights.hardParams.maxRunHomeroom
    for (const d of SCHEDULE_DAYS) {
      let run = 0, best = 0
      for (let q = 1; q <= 7; q++) {
        const k = `${d}-${q}`
        const teachable = avail.has(k) || k in locks
        const blank = teachable && !occ.has(k) && !(k in locks)
        run = blank ? run + 1 : 0; best = Math.max(best, run)
      }
      if (best > maxRun) acc(map, 'homeroomRun', `導師連上超過 ${maxRun} 節（硬限制）`, MUST, `${c.label} 週${DAY_ZH[d]}連續 ${best} 格導師課`)
    }
  }

  // 上午導師課下限：每天上午（1~4 節）至少 N 節導師課，不足才罰。
  // 是「下限」不是「越多越好」——到達門檻就收手，才不會跟成塊、不連四無限拉扯。
  if (w.homeroomMorning.level !== 'off') {
    const target = Math.max(1, w.homeroomMorning.n)
    for (const c of input.classes) {
      const occ = st.classOcc.get(c.classKey)!
      const avail = new Set(input.classSlots[c.classKey] ?? [])
      const locks = input.lockedCells[c.classKey] ?? {}
      for (const d of SCHEDULE_DAYS) {
        // 上午可排格數不足 N 的日子（如只開 2 格），目標降到實際格數，不能罰它做不到的事
        const morningSlots = [1, 2, 3, 4].filter(q => avail.has(`${d}-${q}`) || (`${d}-${q}` in locks))
        if (morningSlots.length === 0) continue
        const hr = morningSlots.filter(q => !occ.has(`${d}-${q}`) && !(`${d}-${q}` in locks)).length
        const want = Math.min(target, morningSlots.length)
        if (hr < want) acc(map, 'homeroomMorning', `上午導師課下限 ${target}`, pen(w.homeroomMorning.level) * (want - hr), `${c.label} 週${DAY_ZH[d]}上午只有 ${hr} 節導師課`)
      }
    }
  }

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
  const hourlySet = new Set(input.hourlyTeachers ?? [])
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
    {
      // 只有鐘點有每週分布規則（科任・行政的「分散」依 114-2 人工課表刪除：
      // 最重日與最輕日差 4 節最常見，學校根本沒在平均分配）
      const cfg = w.hourlyBalance
      const key = 'hourlyBalance'
      const who = '鐘點'
      if (!hourlySet.has(tid)) { /* 非鐘點不計 */ } else {
      const loads = SCHEDULE_DAYS.map(d => {
        let n = 0
        for (let q = 1; q <= 7; q++) { const cell = occ.get(`${d}-${q}`); if (cell && (cell.w || cell.o || cell.e)) n++ }
        return n
      })
      const r = spreadOver(cfg, loads, 3)
      if (r) acc(map, key, `${who}每週分布（${DAY_MODE_LABEL[cfg.mode]}）`, pen(cfg.level) * r.over, `${nameOf(tid)} ${r.why}`)
      }
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
    const posOf = (l: EngineLesson): { zone: number; index: number; zoneSize: number; ring: boolean; floor: number } | null => {
      const rid = roomOf.get(l.id)
      if (rid) return roomById.get(rid)!
      return input.classRoom[l.classKey] ?? null
    }
    st.teacherOcc.forEach((occ, tid) => {
      for (const d of SCHEDULE_DAYS) {
        // 當天這位老師的課依節次排成序列（連堂只算一堂）。
        // 比較「相鄰兩堂課」而不是「相鄰兩節」——中間隔空堂照樣要走那一趟，
        // 舊寫法把隔空堂的移動當作沒發生，等於鼓勵引擎用空堂隔開跨樓的課來規避罰分。
        const seq: { q: number; id: string; pos: NonNullable<ReturnType<typeof posOf>> }[] = []
        for (let q = 1; q <= 7; q++) {
          const cell = occ.get(`${d}-${q}`)
          if (!cell) continue
          const id = cell.w ?? cell.o ?? cell.e
          if (!id || (seq.length && seq[seq.length - 1].id === id)) continue
          const pos = posOf(st.lessonById.get(id)!)
          if (!pos) continue
          seq.push({ q, id, pos })
        }
        for (let i = 1; i < seq.length; i++) {
          const a2 = seq[i - 1], b2 = seq[i]
          const dist = walkDistance(a2.pos, b2.pos)
          // 上限 9（同層跨區＝3、跨一層＝6、跨兩層＝9）：舊上限 3 會讓跨樓與跨區一樣痛，樓層就白算了
          if (dist < 2) continue
          // 中間有空堂、或跨午休＝有時間慢慢走，不像下課十分鐘那麼痛，罰分減半。
          // 「趟數」照算，所以一樓→二樓→一樓仍然比一樓→二樓→二樓貴。
          const relaxed = b2.q - a2.q > 1 || (a2.q <= MORNING_LAST && b2.q > MORNING_LAST)
          const df = Math.abs(a2.pos.floor - b2.pos.floor)
          const note = `${Number.isFinite(df) && df > 0 ? `、跨 ${df} 層` : ''}${relaxed ? '、有空檔' : ''}`
          acc(map, 'walkCost', '走動成本', pen(w.walkCost) * Math.min(dist - 1, 9) * (relaxed ? 0.5 : 1),
            `${nameOf(tid)} 週${DAY_ZH[d]}第${a2.q}→${b2.q}節跨教室（距離 ${dist}${note}）`)
        }
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

/** 每週分布傾向計分。spread＝各日課量極差超過門檻；concentrate＝授課天數超過目標天數。
 *  分散與集中是同一條軸的兩端，同一條規則用 mode 切換，不會互相打架。 */
function spreadOver(cfg: DaySpread, loads: number[], spreadTolerance: number): { over: number; why: string } | null {
  if (cfg.level === 'off' || cfg.mode === 'off') return null
  if (cfg.mode === 'concentrate') {
    const used = loads.filter(n => n > 0).length
    const over = used - Math.max(1, cfg.days)
    return over > 0 ? { over, why: `分散在 ${used} 天（目標 ${cfg.days} 天內）` } : null
  }
  const diff = Math.max(...loads) - Math.min(...loads)
  const over = diff - spreadTolerance
  return over > 0 ? { over, why: `最重日與最輕日差 ${diff} 節` } : null
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
  private curSoft = 0
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
  private hrBands = new Set<ReturnType<typeof bandOf>>()   // 導師連上上限適用年段
  private hrRunN = 3                                       // 導師連上上限節數

  /** @param initial 熱啟動落點（診斷探測／重排續跑用）：以既有解為搜尋起點，不合法的落點靜默略過，
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

    this.hrBands = new Set(input.weights.hardParams.homeroomRunBands)
    this.hrRunN = input.weights.hardParams.maxRunHomeroom

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
    // ── 前置階段：先排「科任教室」，不是先排課 ──
    // 教室數量固定、常常剛好夠用（如自然三間各 14 組對容量 14），排在後面就再也塞不進去。
    // 因此趁課表全空時，把所有要進專科教室的課先用回溯法填進教室：
    //   第一輪：每間教室的管理教師 → 填自己那間（依需求最滿的教室先）；
    //   第二輪：沒有管理教室的老師 → 填整科剩下的教室格（可跨間）。
    // 這些課之後仍可換時段（鎖的是教室歸屬，不是時段），但 canPlace 保證換到哪都有教室。
    {
      const fillBatch = (todo0: EngineLesson[], ok: (l: EngineLesson) => boolean) => {
        const todo = todo0.filter(l => !this.st.pos.has(l.id))
          .sort((x, y) => (y.size - x.size) || (classSlack(x.classKey) - classSlack(y.classKey)) || (this.rnd() - 0.5))
        let nodes = 0
        const dfs = (i: number): boolean => {
          if (i >= todo.length) return true
          if (++nodes > 20000) return false
          const l = todo[i]
          // 候選格子打散：前置階段若不吃種子，五個種子會排出完全相同的教室配置，多起點就失去意義
          const cands = this.st.candidates(l)
          for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(this.rnd() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]] }
          for (const p of cands) {
            this.st.place(l, p)
            if (ok(l) && dfs(i + 1)) return true
            this.st.remove(l)
          }
          return false
        }
        if (!dfs(0)) {
          // 整批填不滿 → 保留已填且合格的（貪婪結果），其餘交給後面的一般流程（canPlace 仍會要求有教室）
          for (const l of todo) if (this.st.pos.has(l.id) && !ok(l)) this.st.remove(l)
        }
      }
      // 第一輪：管理教師 → 自己的教室
      const roomsByTight = [...input.rooms].map(r => {
        const ls = input.lessons.filter(l => l.subject === r.subject && r.managerIds.includes(l.teacherId)
          && shouldUseRoom(input.weights, l.subject, l.grade, l.size))
        return { r, ls }
      }).filter(x => x.ls.length > 0)
        .sort((x, y) => (y.ls.length - x.ls.length) || (this.rnd() - 0.5))   // 需求最滿的教室先；同樣滿的隨機
      for (const { r, ls } of roomsByTight) fillBatch(ls, l => this.st.roomOf.get(l.id) === r.id)
      // 第二輪：沒有管理教室但要進專科教室的老師 → 整科剩下的格子
      const subjects = Array.from(new Set(input.rooms.map(r => r.subject)))
      for (const subj of subjects.sort(() => this.rnd() - 0.5)) {
        const ls = input.lessons.filter(l => l.subject === subj && this.st.roomPool.has(l.id) && !this.st.mgrRooms.has(l.id))
        if (ls.length) fillBatch(ls, l => this.st.roomOf.has(l.id))
      }
    }

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

    // 專科教室優先序：0＝有管理教室者（鎖進自己那間，容錯空間最小，必須先排）
    //                 1＝要用專科教室但沒有管理教室者（撿剩下的，仍比一般課優先）
    //                 2＝其餘。教室數量固定且常常剛好夠用，排在後面就再也塞不進去了。
    const roomRank = (l: EngineLesson) => this.st.mgrRooms.has(l.id) ? 0 : this.st.roomPool.has(l.id) ? 1 : 2
    // 錨定課最先（整批、跨班），接著專科教室課，其餘依 班級餘裕 → 老師負載比 → 課本身難度
    const ordered = [...input.lessons].filter(l => !this.st.pos.has(l.id)).sort((a, b) =>
      (Number(this.anchored.has(b.id)) - Number(this.anchored.has(a.id)))
      || (roomRank(a) - roomRank(b))
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
    this.curSoft = s0.soft
    this.bestTotal = s0.total
    this.bestSoft = s0.soft
    this.bestPos = new Map(this.st.pos)

    // 建構後先做幾輪定向補洞
    for (let k = 0; k < this.mustTargets.length * 2; k++) this.tryCoverMustFill()
    // 連上修補在建構後多跑幾輪：科任課的「哪一天」在建構期就定調，越早切開越不必後面大搬風
    for (let k = 0; k < this.input.classes.length * 3; k++) this.tryFixHomeroomRun()
  }

  /** 還有未排課時，接受條件只看「未排＋必須級」、忽略軟分。
   *  要把最後幾堂塞進去往往得先把別的課挪開，而挪動當下只讓軟分變差、沒有立即好處，
   *  用總分比較會把這種過渡步驟全部擋掉（純硬探測之所以幾秒就填滿，就是因為軟分為 0 可自由遊走）。
   *  填滿之後恢復用總分比較，才開始計較軟分。 */
  private stuck() { return this.bestTotal >= UNPLACED_PEN }
  private accept(sc: { total: number; soft: number }): boolean {
    return this.stuck() ? (sc.total - sc.soft) <= (this.cur - this.curSoft) : sc.total <= this.cur
  }
  private take(sc: { total: number; soft: number }) {
    this.cur = sc.total; this.curSoft = sc.soft
    this.snapshotIfBest(sc.total, sc.soft)
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
        if (this.accept(sc)) { this.take(sc); return }
        this.st.remove(l)
      }
      this.st.place(l, from)
    }
  }

  /** 導師連上定向修補（硬限制）：找出班級同日連續留白超過上限的段，把該班某堂課搬進段中把它切成兩截。
   *  與必排格補洞同套路（直接搬 → 逐出式），差別只在目標格由「必排格」換成「切點」。
   *  沒有這一步時，「同科不隔天」等權重會把科任課全推去一三五，讓某些班的週二整天沒有科任課可切。 */
  private tryFixHomeroomRun() {
    if (!this.hrBands.size) return
    const n = this.hrRunN
    const targets: { classKey: string; day: number; period: number }[] = []
    for (const c of this.input.classes) {
      if (!this.hrBands.has(bandOf(c.grade))) continue
      const occ = this.st.classOcc.get(c.classKey)!
      const avail = new Set(this.input.classSlots[c.classKey] ?? [])
      const locks = this.input.lockedCells[c.classKey] ?? {}
      const mustLeave = this.input.classMustLeave?.[c.classKey] ?? []
      for (const d of SCHEDULE_DAYS) {
        let start = -1, run = 0
        for (let q = 1; q <= 8; q++) {
          const k = `${d}-${q}`
          const teachable = q <= 7 && (avail.has(k) || k in locks)
          const blank = teachable && !occ.has(k) && !(k in locks)
          if (blank) { if (run === 0) start = q; run++; continue }
          // 切點＝段內第 n+1 格起、每隔 n+1 格一個（切完每截都 ≤ n）
          if (run > n) for (let q2 = start + n; q2 < start + run; q2 += n + 1) {
            const kk = `${d}-${q2}`
            if (avail.has(kk) && !mustLeave.includes(kk)) targets.push({ classKey: c.classKey, day: d, period: q2 })
          }
          run = 0
        }
      }
    }
    if (!targets.length) return
    const t = targets[Math.floor(this.rnd() * targets.length)]
    const mustSet = this.mustSetByClass.get(t.classKey) ?? new Set<string>()
    const lessons = (this.lessonsByClass.get(t.classKey) ?? [])
    if (!lessons.length) return
    const off = Math.floor(this.rnd() * lessons.length)
    for (let j = 0; j < lessons.length; j++) {
      const l = lessons[(off + j) % lessons.length]
      const oldP = this.st.pos.get(l.id) ?? null
      // 原位置若在覆蓋必排格則不動它（避免拆東牆補西牆）
      if (oldP && this.st.slotsOf(l, oldP).some(s => mustSet.has(s))) continue
      if (oldP) this.st.remove(l)
      const tries: Placement[] = l.size === 2
        ? [{ day: t.day, period: t.period }, { day: t.day, period: t.period - 1 }]
        : [{ day: t.day, period: t.period }]
      let ok = false
      for (const p of tries) {
        if (p.period >= 1 && this.st.canPlace(l, p)) { this.st.place(l, p); ok = true; break }
      }
      if (ok) {
        const sc = scoreState(this.st)
        if (this.accept(sc)) { this.take(sc); return }
        this.st.remove(l)
      }
      if (oldP) this.st.place(l, oldP)
    }
    // 直接搬都失敗 → 逐出式：把擋住老師的課先搬走，再把本班課放進切點。
    // 這裡固定用較深的逐出鏈（4）：切點通常卡在「老師該時段有別班的課」，只搬 2 堂常騰不出位子，
    // 而剩幾筆連上違反時 cur 還沒低到 ejectDepth() 自動放寬的門檻。
    this.tryEjectAndCover(t.classKey, t.day, t.period, mustSet, lessons, off, 4)
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
      const lessons = (this.lessonsByClass.get(t.classKey) ?? [])
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
          if (this.accept(sc)) { this.take(sc); return }
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
  private tryEjectAndCover(classKey2: string, day: number, period: number, mustSet: Set<string>, lessons: EngineLesson[], off: number, depth = this.ejectDepth()): boolean {
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
        if (blockers.size === 0 || blockers.size > depth) {
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
          if (this.accept(sc)) { this.take(sc); return true }
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
      if (this.iterations % 8 === 2) { this.tryFixHomeroomRun(); continue }
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
        if (this.accept(sc) || this.rnd() < 0.02) {
          this.cur = sc.total
          this.curSoft = sc.soft
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
        if (this.accept(sc)) { this.take(sc); done = true }
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
        if (this.accept(sc)) { this.take(sc); return }
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
        if (this.accept(sc)) { this.take(sc); return }
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
