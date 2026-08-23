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
  bandOf, shouldUseRoom, classKey as ck, classLabel, subjectClassKey, parseSlotKey, roomLabel, deriveNativeSessions, foreignDemand, doubleModeOf, homeroomLockSlots,
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
  autoAssigned?: boolean   // 這班這科的授課老師是精靈自動配的（非手動指定）→ 排課時可與同科同年級另一位老師的自動配班對調
}

export interface RoomInfo { id: string; label: string; subject: string; managerIds: string[]; zone: number; index: number; zoneSize: number; ring: boolean; floor: number; area: string /* 區（有填）否則棟 */; offSlots: string[]; offNote: string }

export interface EngineInput {
  classes: { classKey: string; grade: number; label: string }[]
  lessons: EngineLesson[]
  classSlots: Record<string, string[]>       // classKey → 可放科任課的 slotKey（可排時段 − 鎖課格）
  classMustFill: Record<string, string[]>    // classKey → 必排科任課的格（導師不排課時段）
  classMustLeave: Record<string, string[]>   // classKey → 必留導師課的格（導師排課標記，科任課不可放）
  classDayFull: Record<string, Record<number, boolean>>  // classKey → day → 是否整天日
  lockedCells: Record<string, Record<string, string>>    // classKey → slotKey → 顯示文字（鎖課科目）
  homeroomLocks: Record<string, string[]>                 // classKey → 由導師授課的鎖課格（種子班國數／班級活動等：科目在導師配課裡）
  /** classKey → 導師自上的連堂科目需要幾組「同半天連續兩格留白」（連堂科目 floor(節數/2) 組、單雙週科目 1 組）。
   *  引擎不排導師課，但排科任課時必須留得下這些連堂位，否則導師的自然／社會／視藝連堂根本上不了（固定硬限制，算必須級）。 */
  homeroomDoubleNeed: Record<string, { pairs: number; note: string }>
                                                          // 導師規則（不連四、上午下限、每日上限）與成塊要把這些格當導師課，而非「非導師」
  teacherBlocked: Record<string, string[]>
  /** 不進引擎、但老師確實在上課的時段（本土語原班與語別場次）。
   *  這些格子同時也在 teacherBlocked 裡（不可再排課），但兩者意義不同：
   *  「不排課」是休息、會中斷連上；「本土語」是上課、要接續計算——不分開就會漏掉連 7。 */
  teacherFixed: Record<string, string[]>   // 科任教師不可排時段
  teacherMustTeach: Record<string, string[]> // 科任教師必排時段（排課標記，未覆蓋＝必須級罰分）
  teacherNames: Record<string, string>
  /** 該班該科有科任需求（每班節數 − 導師自上 > 0）卻沒有任何科任可配（供給不足或配班解不出）。
   *  以前被靜默當成「導師自排」、精靈報未排 0——那是假的 0。現在一律列為未排，讓課務組看得到。 */
  unassigned: { classKey: string; grade: number; classLabel: string; subject: string; hours: number }[]
  hourlyTeachers: string[]                   // 鐘點教師 id：每週分布傾向另用 hourlyBalance（多半要集中、少跑幾趟）
  substituteTeachers: string[]               // 代理教師 id：與鐘點同屬「專程跑一趟」的人，孤堂日可升必須級
  homeroomTeachers: string[]                 // 導師 id：孤堂日／少節數集中不算他們（整天都在自己班）
  rooms: RoomInfo[]                          // 科任教室（有綁科目者參與容量/走動計算）
  classRoom: Record<string, { zone: number; index: number; zoneSize: number; ring: boolean; floor: number; area: string } | null>
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
  notes?: string[]         // 引擎說明（如：自然教室優先排的降級紀錄）
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
        rooms.push({ id: r.id, label: roomLabel(r) || r.subject, subject: r.subject, managerIds: r.managerIds ?? [], zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring, floor: floorNum(z.floor), area: z.district || z.area, offSlots: r.offSlots ?? [], offNote: r.offNote ?? '' })
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
  for (const r of rooms) for (const sl of r.offSlots ?? []) { const m = taken.get(sl) ?? taken.set(sl, new Map()).get(sl)!; m.set(r.id, { w: ROOM_OFF }) }
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
  /** 代理教師 id 清單（聘任別 substitute）：孤堂日「鐘點／代理必須級」用。 */
  substituteTeacherIds?: string[]
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
    hrLockOff: [] as string[],      // 導師自己要上的鎖課，落在她本人的不排課時段（矛盾，引擎動不了）
  }
  const classes: EngineInput['classes'] = []
  const classSlots: Record<string, string[]> = {}
  const classMustFill: Record<string, string[]> = {}
  const classMustLeave: Record<string, string[]> = {}
  const classDayFull: Record<string, Record<number, boolean>> = {}
  const lockedCells: Record<string, Record<string, string>> = {}
  const homeroomLocks: Record<string, string[]> = {}
  const homeroomDoubleNeed: Record<string, { pairs: number; note: string }> = {}
  const unassignedList: EngineInput['unassigned'] = []
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
  const autoKeys = new Set<string>()          // 自動配班的 subjectClassKey（排課時可對調）
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
            // 自動配班：先由 solveAuto 對整個「年級×科目」整批求解（見下方），這裡只處理它沒解掉的殘餘（貪婪）
            let best: string | null = null, bestLeft = 0
            for (const [tid, l] of Array.from(map)) if (l >= r && l > bestLeft) { best = tid; bestLeft = l }
            if (!best) continue
            map.set(best, bestLeft - r)
            assign[k] = best; autoKeys.add(k)
            autoAgg.set(`${g}|${s.name}`, (autoAgg.get(`${g}|${s.name}`) ?? 0) + 1)
          }
        }
      }
      if (pass === 'manual') {
        // ── 整批求解：同一年級同一科，把所有未指派的班一次分給有容量的老師 ──
        // 逐班貪婪會把容量切碎（例：需求 4,3,3,3,4,3,3,3,4,3、供給 12/17/4，供需剛好相等，
        // 貪婪排到最後一班時剩 2+1 湊不出 3 → 該班沒科任）；改用回溯，一人一班一科、容量不超，
        // 找到完整解就採用；找不到才退回貪婪（供給真的不足時）
        for (const g of [1, 2, 3, 4, 5, 6]) {
          for (const s of (gradeSubjects[g] ?? [])) {
            if (s.perClass <= 0) continue
            const map = left[s.name]?.[String(g)]
            if (!map || map.size === 0) continue
            const todo: { i: number; k: string; r: number }[] = []
            for (let i = 0; i < (classCounts[g] ?? 0); i++) {
              const k = subjectClassKey(g, i, s.name)
              if (assign[k]) continue
              const r = remainderOf(g, i, s)
              if (r > 0) todo.push({ i, k, r })
            }
            if (!todo.length) continue
            // 需求大的班先放（first-fit-decreasing 的回溯版）；老師依剩餘容量大到小嘗試
            todo.sort((x, y) => y.r - x.r || x.i - y.i)
            const cap = new Map(map)
            const pick: string[] = new Array(todo.length)
            let nodes = 0
            const dfs = (idx: number): boolean => {
              if (idx >= todo.length) return true
              if (++nodes > 50000) return false
              const need = todo[idx].r
              const tids = Array.from(cap.entries()).filter(([, l]) => l >= need).sort((x, y) => y[1] - x[1]).map(([t]) => t)
              for (const t of tids) {
                cap.set(t, cap.get(t)! - need); pick[idx] = t
                if (dfs(idx + 1)) return true
                cap.set(t, cap.get(t)! + need)
              }
              return false
            }
            if (dfs(0)) {
              todo.forEach((x, idx) => { assign[x.k] = pick[idx]; autoKeys.add(x.k); map.set(pick[idx], map.get(pick[idx])! - x.r) })
              autoAgg.set(`${g}|${s.name}`, (autoAgg.get(`${g}|${s.name}`) ?? 0) + todo.length)
            }
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
      // 鎖課由誰上？科目在該班導師的配課裡（或科任配班標「導師自上」）＝導師課；否則（本土語鐘點、外聘）＝非導師。
      // 從配課推、不必另外勾選——種子班鎖課(國語/數學/班級活動/自主學習) 全命中、本土語鎖課全不命中。
      homeroomLocks[key] = homeroomLockSlots(config, g, i, a.homeroomHours?.[key])
      // 導師自上的科目裡只要有連堂（或單雙週）的，該班就要留「至少 1 組」同半天連續兩格留白——
      // 給導師連堂的機會；要不要拆、拆幾組由導師自己決定，引擎不按節數多要（課務組：就算只有一組連堂位也可以）
      {
        const notes: string[] = []
        for (const [subj, h] of Object.entries(a.homeroomHours?.[key] ?? {})) {
          const n = Number(h); if (!(n > 0)) continue
          const m = dmode(subj, g)
          if (m === 'double') notes.push(`${subj} ${n} 節連堂`)
          else if (m === 'biweekly') notes.push(`${subj} 單雙週`)
        }
        if (notes.length) homeroomDoubleNeed[key] = { pairs: 1, note: notes.join('、') }
      }
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
      // 導師自己要上的鎖課（種子班國數班會等）落在她本人的不排課時段＝矛盾：
      // 鎖課釘死時段、不排課說那時段不能上，引擎兩邊都動不了，只能請課務組擇一調整。
      if (homeroomOff.length) {
        const offSet = new Set(homeroomOff)
        for (const sl of homeroomLocks[key] ?? []) {
          if (!offSet.has(sl)) continue
          const t = lockTypeMap[config.lockCells[key]?.[sl] ?? '']
          const { day, period } = parseSlotKey(sl)
          agg.hrLockOff.push(`${classLabel(g, i)}${a.teacherNames[homeroomId] ? `（${a.teacherNames[homeroomId]}）` : ''} 週${'一二三四五'[day - 1]}第${period}節 ${t?.subject || t?.label || '鎖課'}`)
        }
      }
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
            parity: i % 2 === 0 ? 'odd' : 'even', autoAssigned: autoKeys.has(subjectClassKey(g, i, s.name)) || undefined,
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
            autoAssigned: autoKeys.has(subjectClassKey(g, i, s.name)) || undefined,
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
            autoAssigned: autoKeys.has(subjectClassKey(g, i, s.name)) || undefined,
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
        // 本土語未指派＝直播共學（另行確認），不列入
        if (v || s.name === '本土語') continue
        const r = s.perClass - (a.homeroomHours?.[key]?.[s.name] ?? 0)
        if (r <= 0) continue   // 導師全包＝真的沒有科任需求
        // 有科任需求卻沒人上（不論該科導師可不可配）→ 記下來，結果頁列為未排
        const k2 = `${g}|${s.name}`
        agg.unassigned.set(k2, (agg.unassigned.get(k2) ?? 0) + 1)
        unassignedList.push({ classKey: key, grade: g, classLabel: classLabel(g, i), subject: s.name, hours: r })
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
  const teacherFixed: Record<string, string[]> = {}
  for (const id of Array.from(teacherIds)) {
    teacherBlocked[id] = Array.from(new Set([...(offByTeacher[id] ?? []), ...Array.from(nativeExtraBlocked[id] ?? [])]))
    // 本土語是「在上課」不是「休息」：連上節數要把它算進去，否則本土語連上六節之後
    // 再被排一堂就變成連 7，而引擎完全看不到（人工課表四期 974 個老師日只出現過 1 次連 7）
    if (nativeExtraBlocked[id]?.size) teacherFixed[id] = Array.from(nativeExtraBlocked[id])
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
        classRoom[r.classKey] = { zone: zi, index: ri, zoneSize: z.rooms.length, ring: z.ring, floor: floorNum(z.floor), area: z.district || z.area }   // area＝區（有填）否則棟：跨區來回以此為單位
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
    // 容量＝該教室一週可用的格（年段可排 ∩ 教室未設不排課）；連堂組數以「相鄰兩格皆可用且不跨午休」計
    const capOf = (grades: Set<number>, off: Set<string>) => {
      let dbl = 0, single = 0
      for (const d of SCHEDULE_DAYS) {
        const ok = (q: number) => !off.has(`${d}-${q}`) && Array.from(grades).some(g => config.bands[bandOf(g)].teachable[`${d}-${q}`])
        for (let q = 1; q <= 7; q++) if (ok(q)) single++
        for (const [a, b] of [[1, 2], [3, 4], [5, 6]]) if (ok(a) && ok(b)) dbl++
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
        const cap = capOf(grades, new Set(r.offSlots))
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
      // 導師每日節數＝留白＋由導師上的鎖課，兩者都算進當日格數
      const avail = new Set([...(classSlots[c.classKey] ?? []), ...(homeroomLocks[c.classKey] ?? [])])
      let need = 0
      for (const d of SCHEDULE_DAYS) {
        const cnt = Array.from(avail).filter(s => parseSlotKey(s).day === d).length
        need += Math.max(0, cnt - hrN)
      }
      const have = nodesByClass[c.classKey] ?? 0
      if (have < need) short.push(`${c.label}（需 ${need} 節／科任課僅 ${have} 節）`)
    }
  }
  // 導師鎖課本身就連上超過 N（如種子班國數鎖滿整個上午）：引擎一格也動不了，先講明白
  {
    const { maxRunHomeroom: hrN, homeroomRunBands } = config.weights.hardParams
    const runBands = new Set(homeroomRunBands)
    const hits: string[] = []
    if (runBands.size) for (const c of classes) {
      if (!runBands.has(bandOf(c.grade))) continue
      const hl = new Set(homeroomLocks[c.classKey] ?? [])
      for (const d of SCHEDULE_DAYS) {
        let run = 0, best = 0
        for (let q = 1; q <= 8; q++) { if (q <= 7 && hl.has(`${d}-${q}`)) { run++; continue } best = Math.max(best, run); run = 0 }
        if (best > hrN) hits.push(`${c.label} 週${DAY_ZH[d]}（${best} 節）`)
      }
    }
    if (hits.length) preflight.push({
      level: 'warn', tab: 'lock',
      text: `導師連上上限 ${hrN} 節：下列班日「由導師授課的鎖課」本身就連續超過 ${hrN} 節（如種子班國語／數學鎖滿整個上午），排課引擎動不了鎖課、無法補救——請確認是否接受，或調整鎖課：${joinCap(hits)}`,
    })
  }
  // 導師連上上限可行性：每段長度 L 的連續可排格，需要 ceil((L−N)/(N+1)) 堂科任課／鎖課切開；
  // 全週加總若多於該班的科任課堂數，就是怎麼排都必然違反——先在前置檢核講明白，別讓精靈白跑一輪。
  {
    const { maxRunHomeroom: hrN, homeroomRunBands } = config.weights.hardParams
    const runBands = new Set(homeroomRunBands)
    const lessonsByClass: Record<string, number> = {}
    for (const l of lessons) lessonsByClass[l.classKey] = (lessonsByClass[l.classKey] ?? 0) + 1
    const short: string[] = []
    if (runBands.size) for (const c of classes) {
      if (!runBands.has(bandOf(c.grade))) continue
      const avail = new Set([...(classSlots[c.classKey] ?? []), ...(homeroomLocks[c.classKey] ?? [])])   // 導師鎖課也是導師連上的一部分
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
      text: `導師連上上限 ${hrN} 節需要科任課把連續留白切開，但這些班的科任課堂數不足、必然違反（會扣「導師連上上限」權重分）：${joinCap(short)}——請調高上限、縮小適用年段，或增加該班科任課。`,
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
    preflight.push({ level: 'warn', text: `有科任需求卻沒有科任可配（供給不足，或現有供給湊不出各班的節數）：${joinCap(parts)}——這些課會列為「未排」，未排不為 0 無法發布；請於配課統計補足供給，或於科任配班手動指定。`, tab: 'subject' })
  }
  if (autoAgg.size) {
    const parts = Array.from(autoAgg.entries()).map(([k2, n]) => {
      const [g, subj] = k2.split('|')
      return `${GRADE_LABEL[Number(g)]}${subj}（${n} 班）`
    })
  }
  if (agg.leftoverLow.length) preflight.push({ level: 'warn', text: `班級課表塞不下：導師要排進留白的節數多於留白格（留白/導師待排＝導師實際配課−已鎖固定格）——請於配課統計調整該班導師或科任的節數：${joinCap(agg.leftoverLow)}`, href: '/admin/allocation-statistics' })
  if (agg.artBiweekly.length) preflight.push({ level: 'warn', text: `單雙週連堂假設每週均攤 1 節，但每班節數不同：${joinCap(agg.artBiweekly)}`, tab: 'weight' })
  const noManager = rooms.filter(r => r.managerIds.length === 0).map(r => r.label)
  // 本土語檢核
  if (nativeAgg.notLocked.length) preflight.push({ level: 'warn', text: `本土語尚未鎖滿時段：${joinCap(nativeAgg.notLocked)}`, tab: 'lock' })
  for (const issue of derived.issues) preflight.push(issue)
  if (nativeAgg.streamClasses.length) preflight.push({ level: 'warn', text: `本土語未指派閩南語老師、將以直播共學處理（請確認非漏填）：${joinCap(nativeAgg.streamClasses)}`, tab: 'subject' })
  // 排課標記檢核
  if (agg.hrLockOff.length) preflight.push({
    level: 'warn', tab: 'lock',
    text: `導師自己要上的鎖課，排在她本人的不排課時段——引擎兩邊都動不了，請擇一調整（改鎖課時段，或取消該格不排課）：${joinCap(agg.hrLockOff)}`,
  })
  if (agg.onOffConflict.length) preflight.push({ level: 'warn', text: `排課與不排課標記同格衝突（該格兩者皆忽略）：${joinCap(agg.onOffConflict)}`, tab: 'off' })
  if (agg.onNoLesson.length) preflight.push({ level: 'warn', text: `標了排課但無科任課、標記無作用：${joinCap(agg.onNoLesson)}`, tab: 'off' })
  if (agg.onBadSlot.length) preflight.push({ level: 'warn', text: `排課標記時段不可行（非其授課班可排格或與不排課衝突，已忽略）：${joinCap(agg.onBadSlot)}`, tab: 'off' })
  // 結構極緊的班日：扣掉非導師鎖課（游泳、本土語）、導師不排課、年段共同不排課後，導師當天可用格只比「每日下限」多 ≤1 格——
  // 這種班日只有一兩種排法（5年10班 週一：游泳 3-4＋五年級共同不排課 6-7，導師只剩 1、2、5 三格），
  // 引擎很容易在這裡卡住；先點名，讓課務組決定是接受那天導師少一節，還是動游泳／共同不排課
  {
    const hm = config.weights.builtin.homeroomDailyMin
    const tight: string[] = []
    if (hm.level !== 'off') for (const c of classes) {
      const slots = new Set(classSlots[c.classKey] ?? [])
      const hrLocks = new Set(homeroomLocks[c.classKey] ?? [])
      const mustFill = new Set(classMustFill[c.classKey] ?? [])
      for (const d of SCHEDULE_DAYS) {
        let possible = 0
        for (let q = 1; q <= 7; q++) { const k = `${d}-${q}`; if ((slots.has(k) && !mustFill.has(k)) || hrLocks.has(k)) possible++ }
        if (!possible) continue
        const need = Math.min(classDayFull[c.classKey]?.[d] ? hm.full : hm.half, possible)
        if (possible - need <= 1) tight.push(`${c.label} 週${DAY_ZH[d]}（導師可用 ${possible} 格、下限 ${need}）`)
      }
    }
    // 課務組不需要看這個：結構極緊班日只留在 console 供除錯，不進前置檢核
    if (tight.length) console.debug('[engine] 結構極緊的班日：', tight.join('、'))
  }

  return {
    input: {
      classes, lessons, classSlots, classMustFill, classMustLeave, classDayFull, lockedCells, homeroomLocks, homeroomDoubleNeed,
      teacherBlocked, teacherFixed, teacherMustTeach, teacherNames: a.teacherNames, unassigned: unassignedList, hourlyTeachers: a.hourlyTeacherIds ?? [], rooms, classRoom,
      substituteTeachers: a.substituteTeacherIds ?? [],
      homeroomTeachers: Array.from(new Set(Object.values(config.classTeacher).filter((t): t is string => Boolean(t)))),
      weights: config.weights, seed: a.seed ?? 42,
    },
    preflight,
  }
}

// ══════════════════ 引擎狀態 ══════════════════

/** 上午最後一節：連堂不得由此節起始（會跨午休）；上/下午分段亦以此為界。 */
const MORNING_LAST = 4

type TCell = { w?: string; o?: string; e?: string }

/** 教室不排課時段的占位 lessonId：任何週型都撞、任何人都趕不走。 */
const ROOM_OFF = '__room_off__'

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
  // 科目互斥同日（硬）：subject → 與它互斥的科目集合（依年級）。如 國際教育↔英語 不得同班同日
  apartHard: Map<string, Map<number, Set<string>>> = new Map()  // subject → grade → Set<other subjects>
  mgrRooms: Map<string, RoomInfo[]> = new Map()                // lessonId → 有管理教室者的自管教室（供排序與計分辨識）
  roomOf: Map<string, string> = new Map()                      // lessonId → 已占用的 roomId
  roomDayPref = new Map<string, Set<number>>()                 // lessonId → 管理者認領的日子（先分天再填；不回頭科目的教室＝硬限制，其他＝建構偏好）
  roomDayHard = new Set<string>()                              // 認領日子當硬限制的 lessonId（教室科目列在 hardParams.noReturnSubjects）

  constructor(input: EngineInput) {
    this.input = input
    for (const r of input.rooms) {
      const m = new Map<string, TCell>()
      for (const sl of r.offSlots) m.set(sl, { w: ROOM_OFF })   // 教室不排課時段：整週占住、誰都趕不走
      this.roomOcc.set(r.id, m)
    }
    for (const l of input.lessons) this.bindRoomPool(l)
    for (const l of input.lessons) this.lessonById.set(l.id, l)
    for (const t of input.weights.templates) {
      if (t.template !== 'subjectApart' || !t.hard || t.subjects.length < 2) continue
      const grades = t.grades.length ? t.grades : [1, 2, 3, 4, 5, 6]
      for (const a of t.subjects) for (const b of t.subjects) {
        if (a === b) continue
        const byG = this.apartHard.get(a) ?? this.apartHard.set(a, new Map()).get(a)!
        for (const g of grades) (byG.get(g) ?? byG.set(g, new Set()).get(g)!).add(b)
      }
    }
    for (const c of input.classes) this.classOcc.set(c.classKey, new Map())
    for (const l of input.lessons) if (!this.teacherOcc.has(l.teacherId)) this.teacherOcc.set(l.teacherId, new Map())
    for (const l of input.lessons) if (l.coTeacherId && !this.teacherOcc.has(l.coTeacherId)) this.teacherOcc.set(l.coTeacherId, new Map())
  }

  /** 依授課老師決定這堂課的教室池：有管理教室的老師只用自己那間；沒有的則整科的教室都可用（可跨間跑）。 */
  private bindRoomPool(l: EngineLesson) {
    this.mgrRooms.delete(l.id); this.roomPool.delete(l.id)
    if (!shouldUseRoom(this.input.weights, l.subject, l.grade, l.size)) return
    const same = this.input.rooms.filter(r => r.subject === l.subject)
    if (!same.length) return
    const mine = same.filter(r => r.managerIds.includes(l.teacherId))
    if (mine.length) this.mgrRooms.set(l.id, mine)
    this.roomPool.set(l.id, mine.length ? mine : same)
  }
  /** 自動配班對調：把這堂（未排的）課改由另一位老師上，教室池跟著換。 */
  rebindTeacher(l: EngineLesson, tid: string, name: string) {
    if (this.pos.has(l.id)) throw new Error('rebindTeacher on placed lesson')
    l.teacherId = tid; l.teacherName = name
    if (!this.teacherOcc.has(tid)) this.teacherOcc.set(tid, new Map())
    this.bindRoomPool(l)
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
        if (id === ROOM_OFF || isMgrLesson(this, id, roomId)) return null   // 教室不排課／管理者的課：不可趕
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
  /** 外部指定教室（調課查詢器把 UI 的 reassignRooms 結果同步進來，讓計分基準與畫面一致）。 */
  setRoom(lessonId: string, roomId: string | null) {
    const l = this.lessonById.get(lessonId), p = this.pos.get(lessonId)
    if (!l || !p || !this.roomPool.has(lessonId)) return
    if ((this.roomOf.get(lessonId) ?? null) === roomId) return
    this.releaseRoom(lessonId)
    if (roomId && this.roomPool.get(lessonId)!.some(r => r.id === roomId)) this.occupyRoom(lessonId, roomId, this.slotsOf(l, p), l.parity)
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
    // 半天日一定要留得下導師課（硬限制）：
    //   a) 單雙週區塊不得占滿半天日扣掉導師鎖課後的所有格——輪到導師的那一週整個半天都是導師課、一堂科任都沒有
    //      （種子班週三就是這形狀：國數鎖課在 3-4，只剩 1-2 可排）
    //   b) 任何科任課都不得把半天日的可排格占到一格不剩，除非那天還有導師鎖課——否則導師整天 0 節
    if (!this.input.classDayFull[l.classKey]?.[p.day]) {
      const locks = this.input.lockedCells[l.classKey] ?? {}
      const hrLock = new Set(this.input.homeroomLocks[l.classKey] ?? [])
      const cOcc2 = this.classOcc.get(l.classKey)!
      const avail = this.input.classSlots[l.classKey] ?? []
      // 導師自己宣告不排課的格不算「導師的格」——那些格本來就該是科任課（6年3班 楊淨伃 週三 1-4 全公假進修）
      const mustFill = this.input.classMustFill[l.classKey] ?? []
      const dayFree = avail.filter(x => x.startsWith(`${p.day}-`) && !mustFill.includes(x))
      const lockSlots = Object.keys(locks).filter(x => x.startsWith(`${p.day}-`))
      const hrLocksHere = lockSlots.filter(x => hrLock.has(x)).length
      // 這個半天完全沒有「導師可上的格」（整個半天都宣告不排課）→ 本來就該全是科任，不受此限
      if (dayFree.length || hrLocksHere) {
        // 放上去之後，這個半天還剩幾格是導師的（空著、且非不排課的可排格）
        const left = dayFree.filter(x => !slots.includes(x) && !cOcc2.has(x)).length
        if (l.parity !== 'weekly') {
          // 單雙週：導師那一週連區塊本身也是導師課，所以只要「其餘格全是導師鎖課」就整個半天都是導師
          if (!dayFree.some(x => !slots.includes(x)) && lockSlots.every(x => hrLock.has(x))) return false
        } else if (left === 0 && hrLocksHere === 0) return false
      }
    }
    // 需要專科教室的連堂只能落在磚位 1-2／3-4／5-6／6-7，不可 2-3：上午放 2-3 會讓那間教室那個上午只剩一組位子，
    // 自然／科技教室 42 磚位對 42 組連堂用滿的情況下，一塊擺歪全校就少一格（人工課表 0 組起始於第 2 節）
    if (l.size === 2 && p.period === 2 && (this.roomPool.get(l.id)?.length ?? 0) > 0) return false
    for (const s of slots) {
      if (!avail.includes(s)) return false
      if (cOcc.has(s)) return false
      if (blocked.includes(s)) return false
      if (mustLeave.includes(s)) return false   // 導師排課標記格：必留導師課
      // 單雙週區塊：另一週整塊兩節歸導師上，所以整塊都不能碰導師的不排課時段
      // （只放一半＝導師那一週還是得來上課，等於不排課申報形同虛設）
      if (l.parity !== 'weekly' && (this.input.classMustFill[l.classKey] ?? []).includes(s)) return false
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
    // 硬限制：連堂後不緊接單節（同一位老師、同半天）——連堂結束要收器材，緊接著跑班來不及；單節後接連堂可以。
    // 114-2 人工課表自然 42 組連堂 0 例外。列在 hardParams.noSingleAfterDouble 的科目為「連堂的科目」
    if (this.doubleThenSingle(l, p)) return false
    // 硬限制：單日課間空堂最多一段（禁止「上、空、上、空」交錯）
    if (this.teacherGapSegsAfter(l, p) > 1) return false
    // 硬限制：同班同科同日禁止（連堂自身除外）；相鄰日為權重「同科不隔天」
    if (this.subjectSameDayConflict(l, p)) return false
    // 硬限制：科目互斥同日（設為「必須」的子規則，如 國際教育↔英語）——同班同日不得並存
    const apart = this.apartHard.get(l.subject)?.get(l.grade)
    if (apart) {
      const cOcc = this.classOcc.get(l.classKey)!
      for (const [slot, id] of Array.from(cOcc)) {
        if (id === l.id || parseSlotKey(slot).day !== p.day) continue
        if (apart.has(this.lessonById.get(id)!.subject)) return false
      }
    }
    // 硬限制：專科教室。所有依設定要進專科教室的課，該時段都必須有教室可用，否則不准排在這裡——
    // 管理教師只認自己管理的那間（可趕走借用者，但得幫對方換到別間）；沒有管理教室的老師則整科任一間皆可。
    // 沒教室不是回原班，是換時段；整週都塞不進才會成為未排（明著卡住，不悄悄降級）。
    const pool = this.roomPool.get(l.id)
    if (pool && !pool.some(r => this.planRoom(r.id, l, p) !== null && !this.roomReturnAfter(r.id, l, p))) return false
    // 硬限制（不回頭科目的教室）：管理者只在自己認領的日子用教室——先分天再填（甲＝一二三、乙＝三四五），器材不用收
    if (this.roomDayHard.has(l.id) && !this.roomDayPref.get(l.id)!.has(p.day)) return false
    return true
  }

  /** 這間教室一週時間軸上的老師交接次數（週一第 1 節 → 週五第 7 節，跳過空格）；可模擬把 l 放在 p（同週型才算）。 */
  roomTransitions(roomId: string, l?: EngineLesson, p?: Placement): number {
    const occ = this.roomOcc.get(roomId)
    const mine = new Set(l && p ? this.slotsOf(l, p) : [])
    let last: string | undefined; let n = 0
    for (const d of SCHEDULE_DAYS) for (let q = 1; q <= 7; q++) {
      const s = `${d}-${q}`
      let tid: string | undefined
      if (mine.has(s)) tid = l!.teacherId
      else {
        const cell = occ?.get(s)
        const id = cell?.w ?? (l?.parity !== 'even' ? cell?.o : undefined) ?? (l?.parity !== 'odd' ? cell?.e : undefined)
        if (id && id !== ROOM_OFF && id !== l?.id) tid = this.lessonById.get(id)?.teacherId
      }
      if (tid && tid !== last) { if (last) n++; last = tid }
    }
    return n
  }

  /** 硬限制（hardParams.noReturnSubjects 列的科目，預設自然）：同一間專科教室同一天，老師走了不能再回來——
   *  翁 1-2／陳 3-4／翁 5-6 ✗。收了實驗器材又要回來擺，來不及。114-1 人工課表自然教室 27 個教室日 0 次回頭。
   *  模擬把 l 放進 roomId 之後，該日這間教室依節次的老師序列裡是否有人出現兩塊以上。 */
  private roomReturnAfter(roomId: string, l: EngineLesson, p: Placement): boolean {
    if (!this.input.weights.hardParams.noReturnSubjects.includes(l.subject)) return false
    const occ = this.roomOcc.get(roomId)
    const mine = new Set(this.slotsOf(l, p).map(s => Number(s.split('-')[1])))
    const blocks: string[] = []
    for (let q = 1; q <= 7; q++) {
      let tid: string | undefined
      if (mine.has(q)) tid = l.teacherId
      else {
        const cell = occ?.get(`${p.day}-${q}`)
        const id = cell?.w ?? (l.parity !== 'even' ? cell?.o : undefined) ?? (l.parity !== 'odd' ? cell?.e : undefined)
        if (id && id !== ROOM_OFF && id !== l.id) tid = this.lessonById.get(id)?.teacherId
      }
      if (tid && blocks[blocks.length - 1] !== tid) blocks.push(tid)
    }
    return new Set(blocks).size !== blocks.length
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

  /** 放置後該師當日「課間空堂段數」（取兩週型較差者）。
   *  只算「起點落在上午（1~MORNING_LAST 節）」的空堂段——下午的空堂完全不計。
   *  半天日「上空上空」＝1 段（可以）；整天日「上空上空上」＝2 段（不行）；
   *  而 1,2,3 上完、下午 5、7 這種只有下午空一節的，不算違反。 */
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
      for (let i = 1; i < qs.length; i++) {
        if (qs[i] - qs[i - 1] <= 1) continue
        if (qs[i - 1] + 1 <= MORNING_LAST) segs++   // 空堂起點在上午才計
      }
      worst = Math.max(worst, segs)
    }
    return worst
  }

  /** 放 l 在 p 之後，這位老師是否出現「連堂（指定科目）→ 緊接單節」。午休隔開不算（4→5）。 */
  private doubleThenSingle(l: EngineLesson, p: Placement): boolean {
    const subjSet = this.input.weights.hardParams.noSingleAfterDouble
    if (!subjSet.length) return false
    const tOcc = this.teacherOcc.get(l.teacherId)
    if (!tOcc) return false
    const lessonAt = (q: number): EngineLesson | null => {
      const cell = tOcc.get(`${p.day}-${q}`)
      const id = cell?.w ?? (l.parity !== 'even' ? cell?.o : undefined) ?? (l.parity !== 'odd' ? cell?.e : undefined)
      return id && id !== l.id ? this.lessonById.get(id)! : null
    }
    if (l.size === 1) {
      // 我是單節：前一格若是某連堂的第二節（連堂起於 p-2）且不跨午休 → 違反
      if (p.period === MORNING_LAST + 1) return false
      const prev = lessonAt(p.period - 1)
      if (prev && prev.size === 2 && subjSet.includes(prev.subject)) {
        const pp = this.pos.get(prev.id)
        if (pp && pp.period === p.period - 2) return true
      }
      return false
    }
    // 我是連堂（指定科目）：結束的下一格若是單節且不跨午休 → 違反
    if (!subjSet.includes(l.subject)) return false
    const endQ = p.period + 1
    if (endQ === MORNING_LAST) return false
    const next = lessonAt(endQ + 1)
    return Boolean(next && next.size === 1)
  }

  private teacherRunAfter(l: EngineLesson, p: Placement, rid: string = l.teacherId): number {
    const tOcc = this.teacherOcc.get(rid)!
    const fixed = this.input.teacherFixed[rid] ?? []   // 本土語那些不進引擎、但確實在上課的時段
    const parities: ('o' | 'e')[] = l.parity === 'weekly' ? ['o', 'e'] : [l.parity === 'odd' ? 'o' : 'e']
    let worst = 0
    for (const par of parities) {
      const taught = new Set<number>()
      for (let q = 1; q <= 7; q++) {
        const cell = tOcc.get(`${p.day}-${q}`)
        if (cell && (cell.w || cell[par])) taught.add(q)
      }
      for (const s2 of fixed) { const [d2, q2] = s2.split('-').map(Number); if (d2 === p.day) taught.add(q2) }
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
/** 規則量級對齊（計分 v2）：任何規則違反一筆＝權重那個數字（低 1／中 3／高 9），
 *  「嚴重程度」（走動距離、超過幾節、空堂幾格…）只當同分時的加分項，每多一級加 10%。
 *  舊算法是權重 × 嚴重程度，走動距離 9 的一筆「中」＝27 分、空堂 1 格的一筆「低」＝1 分，
 *  同樣叫「中」「低」卻差 27 倍，目標函數被走動成本吃掉一半——課務組在面板上調不到自己真正的偏好。 */
export const SCORING_VERSION = 2
/** 除錯用：第零步 A0（必排格整段回溯）的追蹤紀錄。沙盒把 on 打開才會寫，正式跑完全不動。 */
export const A0_TRACE = { on: false, lines: [] as string[] }
function sev(n: number): number { return 1 + 0.1 * (Math.max(1, n) - 1) }

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
  for (const r of input.rooms) for (const sl of r.offSlots) { const m = taken.get(sl) ?? taken.set(sl, new Map()).get(sl)!; m.set(r.id, { w: ROOM_OFF }) }
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
      if (set.size > 1) acc(map, 'roomManagerFirst', '教室固定（借用他人教室）', pen(w.roomManagerFirst) * sev(set.size - 1), `${nameOf(tid)} 本週用了 ${set.size} 間教室`)
    })
  }

  // 專科教室老師集中（權重）：一間教室一週依時間軸（週一第 1 節 → 週五第 7 節）看老師序列，「交接」越少越好——
  // 一位老師連續幾天用完再換下一位（賴＝一二、翁＝三四五），器材不用收；同一天多位老師、隔天又換回來、走了又回來，都是多餘的交接。
  // 計分：交接次數 −（老師數 − 1）＝多餘交接，每次扣 1；回頭（同一天走了又回來）另計，自然為 MUST；
  //   同一個半天被兩位老師分掉扣 ½（真的得交接時，寧可在上午／下午之間交接，不要在 2／3 節之間）。
  if (w.roomHalfDay !== 'off' || input.weights.hardParams.noReturnSubjects.length) {
    const byRoom = new Map<string, Map<string, string>>()   // rid → `${d}-${q}` → tid
    for (const { l, p } of placedLessons) {
      const rid = roomOf.get(l.id)
      if (!rid) continue
      const m = byRoom.get(rid) ?? byRoom.set(rid, new Map()).get(rid)!
      for (const q of (l.size === 2 ? [p.period, p.period + 1] : [p.period])) m.set(`${p.day}-${q}`, l.teacherId)
    }
    byRoom.forEach((m, rid) => {
      const room = roomById.get(rid)
      const rlabel = room?.label ?? rid
      // 週時間軸的交接
      const runs: { tid: string; from: string }[] = []
      for (const d of SCHEDULE_DAYS) for (let q = 1; q <= 7; q++) {
        const t = m.get(`${d}-${q}`)
        if (t && runs[runs.length - 1]?.tid !== t) runs.push({ tid: t, from: `週${DAY_ZH[d]}${q}` })
      }
      const teachers = new Set(runs.map(r => r.tid))
      const excess = Math.max(0, runs.length - teachers.size)
      if (w.roomHalfDay !== 'off' && excess > 0) {
        acc(map, 'roomHalfDay', '專科教室老師集中', pen(w.roomHalfDay) * sev(excess),
          `${rlabel} 一週交接 ${runs.length - 1} 次（${teachers.size} 位老師至少 ${teachers.size - 1} 次）：${runs.map(r => `${nameOf(r.tid)}@${r.from}`).join('→')}`)
      }
      // 每天：回頭（硬／權重另計）＋半天兩位（½）
      for (const d of SCHEDULE_DAYS) {
        const label = `${rlabel} 週${DAY_ZH[d]}`
        const blocks: string[] = []
        for (let q = 1; q <= 7; q++) { const t = m.get(`${d}-${q}`); if (t && blocks[blocks.length - 1] !== t) blocks.push(t) }
        const seenT = new Set<string>(); let returns = 0
        for (const t of blocks) { if (seenT.has(t)) returns++; seenT.add(t) }
        if (returns) {
          const hard = input.weights.hardParams.noReturnSubjects.includes(room?.subject ?? '')
          if (hard) acc(map, 'roomNoReturn', '專科教室老師不回頭（硬限制）', MUST * returns, `${label} ${blocks.map(t => nameOf(t)).join('→')}（走了又回來）`)
          else if (w.roomHalfDay !== 'off') acc(map, 'roomHalfDay', '專科教室老師集中', pen(w.roomHalfDay) * sev(returns), `${label} ${blocks.map(t => nameOf(t)).join('→')}（走了又回來）`)
        }
        if (w.roomHalfDay !== 'off') for (const [half, qs] of [['上午', [1, 2, 3, 4]], ['下午', [5, 6, 7]]] as const) {
          const ts = new Set(qs.map(q => m.get(`${d}-${q}`)).filter(Boolean) as string[])
          if (ts.size > 1) acc(map, 'roomHalfDay', '專科教室老師集中', pen(w.roomHalfDay) * 0.5, `${label}${half} ${Array.from(ts).map(t => nameOf(t)).join('＋')}（半天兩位老師）`)
        }
      }
    })
  }

  // 必排科任課覆蓋。單雙週課只覆蓋一半（另一週整塊還給導師上），對「導師不排課」而言等於沒覆蓋
  for (const c of input.classes) {
    const occ = st.classOcc.get(c.classKey)!
    for (const s of input.classMustFill[c.classKey] ?? []) {
      const id = occ.get(s)
      const biweekly = id ? st.lessonById.get(id)?.parity !== 'weekly' : false
      if (!id || biweekly) {
        uncovered.push({ classKey: c.classKey, slot: s })
        const { day, period } = parseSlotKey(s)
        acc(map, 'mustFill', '導師不排課時段未排科任課', MUST,
          `${c.label} ${slotZh(day, period)}${biweekly ? '（單雙週課只有一週是科任，另一週導師仍要上）' : ''}`)
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
  const tplApart = w.subjectApart === 'off' ? [] : input.weights.templates.filter(t => t.template === 'subjectApart' && !t.hard && t.level !== 'off' && t.subjects.length >= 2)
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
        if (hit.length > 1) acc(map, `tpl-apart-${t.id}`, `科目互斥同日：${t.subjects.join('／')}`, pen(t.level) * sev(hit.length - 1), `${c.label} 週${DAY_ZH[d]} ${hit.join('＋')}`)
      }
    }
  }

  // 導師連上上限（權重，原為硬限制）——班級同日連續留白（無科任課、無鎖課）不要超過 maxRunHomeroom（預設 3＝不連四）。
  // 目的是導師不會整個上午連上四節、中間沒有一節科任課可以喘口氣／改作業。
  // 引擎只排科任課，導師側靠「該段留白被科任課或鎖課切開」；適用年段可於權重頁調整（清空＝停用）。
  // 人工課表 5% 班日導師連四、課務組手調也踩 4 筆 → 不是絕對條件，降為權重（預設高）。
  // 班級某日某週型的「導師格」遮罩（週型感知）：單雙週的視藝格，不是這週的那組就是導師在上——
  // 導師連上／每日上限／上午下限／每日下限都要兩種週型分開算、取較差的一週，否則導師週會出現半天連四、整天連七，科任週整天沒導師
  const hrMask = (ckey: string, d: number, par: 'o' | 'e') => {
    const occ = st.classOcc.get(ckey)!
    const avail = new Set(input.classSlots[ckey] ?? [])
    const locks = input.lockedCells[ckey] ?? {}
    const hrLock = new Set(input.homeroomLocks[ckey] ?? [])
    const teachable: boolean[] = [], hr: boolean[] = [], blank: boolean[] = []
    for (let q = 1; q <= 7; q++) {
      const k = `${d}-${q}`
      const t = avail.has(k) || (k in locks)
      teachable[q] = t
      if (!t) { hr[q] = false; blank[q] = false; continue }
      if (k in locks) { hr[q] = hrLock.has(k); blank[q] = false; continue }
      const id = occ.get(k)
      if (!id) { hr[q] = true; blank[q] = true; continue }
      const p = st.lessonById.get(id)?.parity ?? 'weekly'
      const isHr = p !== 'weekly' && p[0] !== par   // 單雙週：不是這週上的就是導師課
      hr[q] = isHr; blank[q] = isHr
    }
    return { teachable, hr, blank }
  }
  const PARS: ('o' | 'e')[] = ['o', 'e']

  const runBands = new Set(input.weights.hardParams.homeroomRunBands)
  if (runBands.size && w.homeroomRun !== 'off') for (const c of input.classes) {
    if (!runBands.has(bandOf(c.grade))) continue
    const maxRun = input.weights.hardParams.maxRunHomeroom
    for (const d of SCHEDULE_DAYS) {
      // 只罰引擎能改變的連段（段內至少有一格是留白）；整段都是導師鎖課的，引擎一格也動不了，
      // 由前置檢核告知課務組（種子班鎖課排滿整個上午就是這種情況）。兩種週型取較差的。
      let worstBest = 0, worstBlank = false
      for (const par of PARS) {
        const m = hrMask(c.classKey, d, par)
        let run = 0, best = 0, hasBlank = false, bestHasBlank = false
        for (let q = 1; q <= 8; q++) {
          if (q <= 7 && m.hr[q]) { run++; if (m.blank[q]) hasBlank = true; continue }
          if (run > best || (run === best && hasBlank)) { best = run; bestHasBlank = hasBlank }
          run = 0; hasBlank = false
        }
        if (best > worstBest || (best === worstBest && bestHasBlank)) { worstBest = best; worstBlank = bestHasBlank }
      }
      if (worstBest > maxRun && worstBlank) acc(map, 'homeroomRun', `導師連上超過 ${maxRun} 節`, pen(w.homeroomRun) * sev(worstBest - maxRun), `${c.label} 週${DAY_ZH[d]}連續 ${worstBest} 格導師課${worstBest >= 7 ? '（單雙週導師週整天連七）' : ''}`)
    }
  }

  // 導師每日下限（課務組：半天日至少 1 節、整天日至少 2 節導師課；人工課表 0 例外）——兩種週型分開算、取較少的一週。
  // 該班當天導師最多可能幾節＝可排格 − 導師不排課格 − 非導師鎖課；下限不超過它（導師整天不排課的日子不算）。
  if (w.homeroomDailyMin.level !== 'off') {
    const hm = w.homeroomDailyMin
    for (const c of input.classes) {
      const mustFill = new Set(input.classMustFill[c.classKey] ?? [])
      for (const d of SCHEDULE_DAYS) {
        const m0 = hrMask(c.classKey, d, 'o')
        let possible = 0
        for (let q = 1; q <= 7; q++) if (m0.teachable[q] && !mustFill.has(`${d}-${q}`) && (m0.blank[q] || m0.hr[q] || (st.classOcc.get(c.classKey)!.has(`${d}-${q}`)))) possible++
        if (!possible) continue
        const full = input.classDayFull[c.classKey]?.[d]
        const need = Math.min(full ? hm.full : hm.half, possible)
        if (!need) continue
        let have = 99
        for (const par of PARS) { const m = hrMask(c.classKey, d, par); have = Math.min(have, m.hr.filter(Boolean).length) }
        // 必須級只守「絕不 0 節」（人工課表四期 0 例外）；整天 2 節是權重高（人工四期有 4 班日只有 1 節、課務組手調 v18 有 5 班日）——
        // 3年3班 週二、4年3班 週二、5年1／10／11班 週一那種被鎖課＋不排課＋共同不排課扣到只剩 3 格的班日才排得過
        const hardNeed = Math.min(1, possible)
        if (hm.must && have < hardNeed) acc(map, 'homeroomDailyMinMust', '導師整天沒課（必須級）', MUST * (hardNeed - have), `${c.label} 週${DAY_ZH[d]}（${full ? '整天' : '半天'}）導師 0 節`)
        if (have < need && have >= hardNeed) acc(map, 'homeroomDailyMin', `導師每日下限（整天 ${hm.full}／半天 ${hm.half}）`, pen(hm.level) * sev(need - have), `${c.label} 週${DAY_ZH[d]}（${full ? '整天' : '半天'}）導師只有 ${have} 節`)
      }
    }
  }

  // 硬限制：導師連堂位——導師自上的科目有連堂（自然／社會／生活）或單雙週（視藝）的班，至少留 1 組同半天連續兩格留白；
  // 科任課把留白切得一格一格的，導師的連堂就上不了（4年10班 吳佩容 視藝單雙週 v21 實測 0 組）。沒留到＝必須級。
  for (const c of input.classes) {
    const need = input.homeroomDoubleNeed?.[c.classKey]
    if (!need?.pairs) continue
    const occ = st.classOcc.get(c.classKey)!
    const blank = new Set((input.classSlots[c.classKey] ?? []).filter(sl => !occ.has(sl)))
    let pairs = 0
    for (const d of SCHEDULE_DAYS) for (const half of [[1, 2, 3, 4], [5, 6, 7]]) {
      let run = 0
      for (const q of [...half, 0]) { if (q && blank.has(`${d}-${q}`)) run++; else { pairs += Math.floor(run / 2); run = 0 } }
    }
    if (pairs < need.pairs) acc(map, 'homeroomDouble', '導師連堂位不足（硬限制）', MUST * (need.pairs - pairs), `${c.label} 導師自上 ${need.note}，卻沒有任何一組連續兩格留白`)
  }

  // 上午導師課下限：每天上午（1~4 節）至少 N 節導師課，不足才罰。
  // 是「下限」不是「越多越好」——到達門檻就收手，才不會跟成塊、不連四無限拉扯。
  if (w.homeroomMorning.level !== 'off') {
    const target = Math.max(1, w.homeroomMorning.n)
    for (const c of input.classes) {
      for (const d of SCHEDULE_DAYS) {
        // 上午可排格數不足 N 的日子（如只開 2 格），目標降到實際格數，不能罰它做不到的事；單雙週取較少的一週
        const m0 = hrMask(c.classKey, d, 'o')
        const morningSlots = [1, 2, 3, 4].filter(q => m0.teachable[q])
        if (morningSlots.length === 0) continue
        let hr = 99
        for (const par of PARS) { const m = hrMask(c.classKey, d, par); hr = Math.min(hr, morningSlots.filter(q => m.hr[q]).length) }
        const want = Math.min(target, morningSlots.length)
        if (hr < want) acc(map, 'homeroomMorning', `上午導師課下限 ${target}`, pen(w.homeroomMorning.level) * sev(want - hr), `${c.label} 週${DAY_ZH[d]}上午只有 ${hr} 節導師課`)
      }
    }
  }

  // 上午導師課上限：每天上午（1-4 節）導師最多 n 節（課務組：沒鎖課的老師上午最多 3，可以連 3）；
  // 導師自己的鎖課（種子班國數）在上午就超過 n 的，以鎖課數為準——鎖課逼出來的可以。
  // 單雙週視藝的「導師週」多出的兩節不算（那是單雙週結構逼的，與鎖課同理；沙盒實測剩下的違反全是這種）→ 取較少的一週（科任週）
  if (w.homeroomMorningMax.level !== 'off') {
    const mm = w.homeroomMorningMax
    for (const c of input.classes) {
      const hrLock = new Set(input.homeroomLocks[c.classKey] ?? [])
      for (const d of SCHEDULE_DAYS) {
        const lockAm = [1, 2, 3, 4].filter(q => hrLock.has(`${d}-${q}`)).length
        const allowed = Math.max(mm.n, lockAm)
        let am = 99
        for (const par of PARS) { const m = hrMask(c.classKey, d, par); am = Math.min(am, [1, 2, 3, 4].filter(q => m.hr[q]).length) }
        if (am > allowed) {
          if (mm.must) acc(map, 'homeroomMorningMaxMust', `上午導師課上限 ${mm.n}（必須級）`, MUST * (am - allowed), `${c.label} 週${DAY_ZH[d]}上午導師 ${am} 節${lockAm > mm.n ? `（鎖課 ${lockAm}）` : ''}`)
          else acc(map, 'homeroomMorningMax', `上午導師課上限 ${mm.n}`, pen(mm.level) * sev(am - allowed), `${c.label} 週${DAY_ZH[d]}上午導師 ${am} 節`)
        }
        // 半天日整天都是導師課（那天一堂科任都沒有、導師連上四節）＝必須級，與上面的「上午上限」各自獨立：
        // 上午上限人工課表每期破 6～15 次（只給權重），但「半天全是導師課」四期 566 個半天日只有 1 個 → 維持必須級。
        // 導師鎖課本來就排滿整個半天的不算（引擎動不了）
        if (!input.classDayFull[c.classKey]?.[d]) {
          let worstAm = 0, teachable = 0, lockAll = true
          for (const par of PARS) {
            const m = hrMask(c.classKey, d, par)
            const qs = [1, 2, 3, 4].filter(q => m.teachable[q])
            teachable = qs.length
            worstAm = Math.max(worstAm, qs.filter(q => m.hr[q]).length)
            if (qs.some(q => m.blank[q])) lockAll = false
          }
          if (teachable >= 3 && worstAm === teachable && !lockAll) {
            acc(map, 'homeroomHalfDayAll', '半天日整天都是導師課（必須級）', MUST,
              `${c.label} 週${DAY_ZH[d]}（半天）導師連上 ${teachable} 節、一堂科任課都沒有`)
          }
        }
      }
    }
  }

  // 單雙週區塊避開半天日（權重）：半天只有 4 節、其中兩節常是種子班鎖課，單雙週區塊放進另外兩節，
  // 輪到導師的那一週整個半天就是導師連上四節。114-2 人工課表 4／6 年級 21 組只有 2 組在半天日。
  if (w.biweeklyHalfDay !== 'off') {
    for (const { l, p } of placedLessons) {
      if (l.parity === 'weekly') continue
      if (input.classDayFull[l.classKey]?.[p.day]) continue
      acc(map, 'biweeklyHalfDay', '單雙週區塊排在半天日', pen(w.biweeklyHalfDay),
        `${l.classLabel} 週${DAY_ZH[p.day]}第${p.period}-${p.period + 1}節 ${l.subject}（半天日；輪到導師的那一週整個半天都是導師課）`)
    }
  }

  // 同半天兩組專科連堂（權重）：同一班同一個半天有 ≥2 組需要專科教室的連堂，每多一組扣一次。
  // 5年6班 週一上午 科技 1-2＋視藝 3-4 → 導師只剩第 5 節；磚位滿了之後引擎搬不動，得在拼的時候就避開
  if (w.specialDoublesHalf !== 'off') for (const c of input.classes) {
    const occ = st.classOcc.get(c.classKey)!
    for (const d of SCHEDULE_DAYS) for (const half of [[1, 2, 3, 4], [5, 6, 7]]) {
      const ids = new Set<string>()
      for (const q of half) {
        const id = occ.get(`${d}-${q}`); if (!id) continue
        const l = st.lessonById.get(id); if (!l || l.size !== 2) continue
        if ((st.roomPool.get(id)?.length ?? 0) > 0) ids.add(id)
      }
      if (ids.size >= 2) acc(map, 'specialDoublesHalf', '同半天兩組專科連堂', pen(w.specialDoublesHalf) * sev(ids.size - 1),
        `${c.label} 週${DAY_ZH[d]}${half[0] === 1 ? '上午' : '下午'} ${[...ids].map(id => st.lessonById.get(id)!.subject).join('＋')}`)
    }
  }

  // 科任課同日成塊（權重）——同班同日（上、下午各自計）科任課＋鎖課連成一塊，每多一塊扣一次
  if (w.classCohesion !== 'off') for (const c of input.classes) {
    const occ = st.classOcc.get(c.classKey)!
    const avail = new Set(input.classSlots[c.classKey] ?? [])
    const locks = input.lockedCells[c.classKey] ?? {}
    const hrLock = new Set(input.homeroomLocks[c.classKey] ?? [])
    for (const d of SCHEDULE_DAYS) {
      for (const seg of [[1, 2, 3, 4], [5, 6, 7]]) {
        let blocks = 0, inBlock = false
        for (const q of seg) {
          const k = `${d}-${q}`
          const teachable = avail.has(k) || k in locks
          if (!teachable) { inBlock = false; continue }
          const taken = occ.has(k) || (k in locks && !hrLock.has(k))   // 科任課或非導師鎖課＝非導師；導師上的鎖課算導師側
          if (taken) { if (!inBlock) blocks++; inBlock = true }
          else inBlock = false
        }
        if (blocks > 1) {
          acc(map, 'classCohesion', '科任課同日成塊', pen(w.classCohesion) * sev(blocks - 1),
            `${c.label} 週${DAY_ZH[d]}${seg[0] === 1 ? '上午' : '下午'}科任課分成 ${blocks} 塊（與導師課交錯）`)
        }
      }
    }
  }

  // 留白每日平衡（班級的科任課分布＝導師的每日負擔平衡）


  // 導師每日節數上限：每班每日留白（可排格−科任課）≤ N
  if (w.homeroomDailyMax.level !== 'off') {
    for (const c of input.classes) {
      for (const d of SCHEDULE_DAYS) {
        // 導師當日節數＝留白 ＋ 由導師上的鎖課（種子班國數等）；單雙週格兩種週型取較多的一週（導師週會多 2 節）
        let free = 0
        for (const par of PARS) { const m = hrMask(c.classKey, d, par); free = Math.max(free, m.hr.filter(Boolean).length) }
        // 上限：基本 N；低年段整天日（週二）用 fullDayLowN；導師個人不排課達 offBonusFrom 格者 +1
        const hm = w.homeroomDailyMax
        let limit = hm.n
        if (bandOf(c.grade) === 'low' && input.classDayFull[c.classKey]?.[d]) limit = Math.max(limit, hm.fullDayLowN)
        if ((input.classMustFill[c.classKey]?.length ?? 0) >= hm.offBonusFrom) limit += 1
        const over = free - limit
        if (over > 0) acc(map, 'homeroomDailyMax', `導師每日上限 ${hm.n}`, pen(hm.level) * sev(over), `${c.label} 週${DAY_ZH[d]}留白 ${free} 格，導師恐上超過 ${limit} 節`)
        // 絕對上限（必須級）：中高年級絕不超過 hardN；低年段整天日（週二＝低年級唯一的整天）放寬到 hardFullDayLowN——
        // 低年級一週 7～8 堂科任分五天，週二只分到 1～2 堂，導師必然多上（114 人工課表 2年9班 週二就是 6 節）
        const hardLimit = bandOf(c.grade) === 'low' && input.classDayFull[c.classKey]?.[d] ? Math.max(hm.hardN, hm.hardFullDayLowN) : hm.hardN
        if (free > hardLimit) acc(map, 'homeroomDailyMaxMust', `導師每日絕對上限 ${hardLimit}（必須級）`, MUST * (free - hardLimit), `${c.label} 週${DAY_ZH[d]}導師 ${free} 節`)
      }
    }
  }

  // ── 教師面 ──
  const hourlySet = new Set(input.hourlyTeachers ?? [])
  const substituteSet = new Set(input.substituteTeachers ?? [])
  const homeroomSet = new Set(input.homeroomTeachers ?? [])
  const classesOfTeacher = new Map<string, Set<string>>()   // 科任每天至少一節：判斷某天是否整天被不排課蓋住要看她教的班那天有哪些格
  for (const l of input.lessons) (classesOfTeacher.get(l.teacherId) ?? classesOfTeacher.set(l.teacherId, new Set()).get(l.teacherId)!).add(l.classKey)
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
          // segs 只計「起點落在上午」的空堂段（與 canPlace 同口徑）；下午的空堂不計
          for (let i = 1; i < taught.length; i++) {
            if (taught[i] - taught[i - 1] > 1 && taught[i - 1] + 1 <= MORNING_LAST) res.segs++
          }
          return res
        }
        const eo = evalDay(taughtO), ee = evalDay(taughtE)
        const worse = { over: Math.max(eo.over, ee.over), run: Math.max(eo.run, ee.run), gaps: Math.max(eo.gaps, ee.gaps), segs: Math.max(eo.segs, ee.segs) }
        if (worse.over > 0 && w.dailyMax.level !== 'off') acc(map, 'dailyMax', `每日節數上限 ${w.dailyMax.n}`, pen(w.dailyMax.level) * sev(worse.over), `${nameOf(tid)} 週${DAY_ZH[d]}超 ${worse.over} 節`)
        if (worse.run > 0 && w.consecMax.level !== 'off') acc(map, 'consecMax', `連續授課上限 ${w.consecMax.n}`, pen(w.consecMax.level) * sev(worse.run), `${nameOf(tid)} 週${DAY_ZH[d]}連續超 ${worse.run} 節`)
        if (worse.gaps > 0 && w.compact !== 'off' && !hourlySet.has(tid)) acc(map, 'compact', '減少零碎空堂', pen(w.compact) * sev(worse.gaps), `${nameOf(tid)} 週${DAY_ZH[d]}有 ${worse.gaps} 節空堂夾在課間`)
        // 硬限制：課間空堂最多一段（禁止上空上空交錯）
        if (worse.segs > 1) acc(map, 'gapAlternate', '上午空堂交錯（硬限制）', MUST * (worse.segs - 1), `${nameOf(tid)} 週${DAY_ZH[d]}上午空堂分成 ${worse.segs} 段（上空上空上）`)
      }
    }
    // ── 以「老師」為單位的規則：鐘點每週分布／孤堂日／半天一節／少節數集中 ──
    {
      const isHr = homeroomSet.has(tid)
      const taughtAt = (d: number, q: number) => { const c = occ.get(`${d}-${q}`); return Boolean(c && (c.w || c.o || c.e)) }
      const loads = SCHEDULE_DAYS.map(d => { let n = 0; for (let q = 1; q <= 7; q++) if (taughtAt(d, q)) n++; return n })
      const total7 = loads.reduce((a2, b2) => a2 + b2, 0)
      // 鐘點每週分布（分散／集中）——只有鐘點有；科任・行政的「分散」依 114-2 人工課表刪除（最重日與最輕日差 4 節最常見）
      if (hourlySet.has(tid)) {
        const cfg = w.hourlyBalance
        const r = spreadOver(cfg, loads, 3)
        // 集中模式且勾「必須級」：超過目標天數＝必須級（課務組：鐘點不超過 3 天是鐵律；權重高只扣 9 分，引擎會拿去換別的）
        if (r && cfg.mode === 'concentrate' && cfg.must) acc(map, 'hourlyBalanceMust', `鐘點超過 ${cfg.days} 天（必須級）`, MUST * r.over, `${nameOf(tid)} ${r.why}`)
        else if (r) acc(map, 'hourlyBalance', `鐘點每週分布（${DAY_MODE_LABEL[cfg.mode]}）`, pen(cfg.level) * sev(r.over), `${nameOf(tid)} ${r.why}`)
      }
      // 孤堂日：非導師老師某天只上 1 節＝來一趟只為一節課。導師整天在自己班，不算；總共只有 1 節的人本來就只能如此，不計。
      const ld = w.lonelyDay
      if (!isHr && total7 > 1) {
        const partTime = hourlySet.has(tid) || substituteSet.has(tid)
        for (const d of SCHEDULE_DAYS) {
          if (loads[d - 1] !== 1) continue
          const q = [1, 2, 3, 4, 5, 6, 7].find(q2 => taughtAt(d, q2))
          if (ld.partTimeMust && partTime) acc(map, 'lonelyDayMust', '鐘點／代理孤堂日（必須級）', MUST, `${nameOf(tid)} 週${DAY_ZH[d]}只上第 ${q} 節`)
          else if (ld.level !== 'off') acc(map, 'lonelyDay', '孤堂日（一天只上 1 節）', pen(ld.level), `${nameOf(tid)} 週${DAY_ZH[d]}只上第 ${q} 節`)
        }
        // 半天只上 1 節（該天不只這一節才算，否則已經是孤堂日）
        if (ld.halfLevel !== 'off') for (const d of SCHEDULE_DAYS) {
          if (loads[d - 1] < 2) continue
          for (const half of [[1, 2, 3, 4], [5, 6, 7]]) {
            const qs = half.filter(q2 => taughtAt(d, q2))
            if (qs.length === 1) acc(map, 'lonelyHalf', '半天只上 1 節', pen(ld.halfLevel), `${nameOf(tid)} 週${DAY_ZH[d]}${half[0] === 1 ? '上午' : '下午'}只上第 ${qs[0]} 節`)
          }
        }
      }
      // 少節數老師集中：非導師、非鐘點、總節數 ≤ N 的老師（行政兼課、輔導團）壓到 ceil(節數/4) 天內
      const lc = w.lowLoadConcentrate
      if (!isHr && !hourlySet.has(tid) && lc.level !== 'off' && total7 >= 2 && total7 <= lc.n) {
        const used = loads.filter(n => n > 0).length
        const target = Math.ceil(total7 / 4)
        if (used > target) acc(map, 'lowLoadConcentrate', `少節數老師集中（≤${lc.n} 節）`, pen(lc.level) * sev(used - target), `${nameOf(tid)} ${total7} 節分散在 ${used} 天（目標 ${target} 天內）`)
      }
      // 科任每天至少一節：非導師、非鐘點、一週 ≥ N 節的老師不該有整天沒課的日子（那天她教的班可排格全在她的不排課裡＝不算，如吳秉純週三）
      const ed = w.teacherEveryDay
      if (!isHr && !hourlySet.has(tid) && ed.level !== 'off' && total7 >= ed.n) {
        const blocked = new Set(input.teacherBlocked[tid] ?? [])
        const cks = classesOfTeacher.get(tid) ?? new Set<string>()
        for (const d of SCHEDULE_DAYS) {
          if (loads[d - 1] > 0) continue
          const open = [...cks].flatMap(ck => (input.classSlots[ck] ?? []).filter(sl => sl.startsWith(`${d}-`) && !blocked.has(sl)))
          if (!open.length) continue
          acc(map, 'teacherEveryDay', `科任每天至少一節（≥${ed.n} 節）`, pen(ed.level), `${nameOf(tid)}（${total7} 節）週${DAY_ZH[d]}整天沒課`)
        }
      }
      // 科任每週平均：正式／代理科任（總節數 > 少節數門檻）最重日減最輕日 ≤ N；整天被不排課蓋住的日子不計
      const sp = w.teacherSpread
      if (!isHr && !hourlySet.has(tid) && sp.level !== 'off' && total7 > lc.n) {
        const blocked = new Set(input.teacherBlocked[tid] ?? [])
        const cks = classesOfTeacher.get(tid) ?? new Set<string>()
        const openDays = SCHEDULE_DAYS.filter(d => [...cks].some(ck => (input.classSlots[ck] ?? []).some(sl => sl.startsWith(`${d}-`) && !blocked.has(sl))))
        if (openDays.length >= 2) {
          const ls = openDays.map(d => loads[d - 1])
          const diff = Math.max(...ls) - Math.min(...ls)
          const over = diff - sp.n
          if (over > 0) acc(map, 'teacherSpread', `科任每週平均（日差 ≤${sp.n}）`, pen(sp.level) * sev(over), `${nameOf(tid)} 最重日 ${Math.max(...ls)} 節、最輕日 ${Math.min(...ls)} 節（差 ${diff}）`)
        }
      }
    }
  })

  // 全單節老師相鄰兩堂同年級（權重）：課全是一節一節的老師，相鄰兩堂不同年級扣一次
  // （跨年級就是不同教材、不同進度，五→六一樣要換，不只跨年段才算）
  if (w.bandAdjacent !== 'off') {
    const sizeByTeacher = new Map<string, boolean>()   // 有無連堂
    for (const l of input.lessons) if (l.size === 2) sizeByTeacher.set(l.teacherId, true)
    st.teacherOcc.forEach((occ, tid) => {
      if (sizeByTeacher.get(tid)) return
      for (const d of SCHEDULE_DAYS) {
        let prev: EngineLesson | null = null, prevQ = 0
        for (let q = 1; q <= 7; q++) {
          const cell = occ.get(`${d}-${q}`)
          const id = cell?.w ?? cell?.o ?? cell?.e
          const cur = id ? st.lessonById.get(id)! : null
          if (cur && prev && q === prevQ + 1 && cur.grade !== prev.grade) {
            acc(map, 'bandAdjacent', '全單節老師相鄰同年級', pen(w.bandAdjacent), `${nameOf(tid)} 週${DAY_ZH[d]}第${prevQ}→${q}節 ${prev.classLabel}→${cur.classLabel}（跨年級）`)
          }
          if (cur) { prev = cur; prevQ = q }
        }
      }
    })
  }

  // 同半天年級夾單節（權重）：上午（1-4）／下午（5-7）內三節連續、年級 X→Y→X 且中間只夾一節別的年級。
  // 2→1→1→2（去別的年級上一整塊再回來）、隔空堂、跨午休都不算。114-2 人工課表 0 筆——學校真正守的是這條，不是「相鄰不跨年級」。
  if (w.gradeSandwich !== 'off') {
    st.teacherOcc.forEach((occ, tid) => {
      for (const d of SCHEDULE_DAYS) {
        const at = (q: number): EngineLesson | null => { const c = occ.get(`${d}-${q}`); const id = c?.w ?? c?.o ?? c?.e; return id ? st.lessonById.get(id)! : null }
        for (const q of [1, 2, 5]) {   // 三連節完全落在上午或下午之內
          const a = at(q), b = at(q + 1), c = at(q + 2)
          if (!a || !b || !c) continue
          if (a.grade === c.grade && a.grade !== b.grade) {
            acc(map, 'gradeSandwich', '同半天年級夾單節', pen(w.gradeSandwich),
              `${nameOf(tid)} 週${DAY_ZH[d]}第${q}→${q + 1}→${q + 2}節 ${a.classLabel}→${b.classLabel}→${c.classLabel}（${a.grade}年→${b.grade}年→${a.grade}年）`)
          }
        }
      }
    })
  }

  // 老師同日不混科目（權重，母開關＋子規則）：子規則列的幾科，同一位老師同一天只上其中一種
  if (w.teacherApart !== 'off') {
    const tpls = input.weights.templates.filter(t => t.template === 'teacherApart' && t.level !== 'off' && t.subjects.length >= 2)
    if (tpls.length) {
      const byTeacherDay = new Map<string, Map<string, number>>()   // `${tid}|${d}` → subject → 節數
      for (const { l, p } of placedLessons) {
        const k = `${l.teacherId}|${p.day}`
        const m = byTeacherDay.get(k) ?? byTeacherDay.set(k, new Map()).get(k)!
        m.set(l.subject, (m.get(l.subject) ?? 0) + l.size)
      }
      byTeacherDay.forEach((subs, k) => {
        const [tid, d] = k.split('|')
        for (const t of tpls) {
          const hit = t.subjects.filter(sb => subs.has(sb))
          if (hit.length < 2) continue
          // 以「較少那一邊」的節數計次（同「同型態同日」）：混 3＋1 扣 1 次、混 3＋3 扣 3 次——一天只扣一次的話牽引力太弱
          const counts = hit.map(sb => subs.get(sb)!).sort((x, y) => x - y)
          const times = counts.slice(0, -1).reduce((x, y) => x + y, 0)
          acc(map, `tpl-tapart-${t.id}`, `老師同日不混科目：${t.subjects.join('／')}`, pen(t.level) * sev(times), `${nameOf(tid)} 週${DAY_ZH[Number(d)]} ${hit.map(sb => `${sb}${subs.get(sb)}`).join('＋')}`)
        }
      })
    }
  }

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
        acc(map, 'batchType', '同型態同日', pen(w.batchType) * sev(Math.min(e.dbl, e.sgl)),
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
      if (hourlySet.has(tid)) return   // 鐘點老師不計走動：對她們「多來一天」遠比「多走幾步」痛，走動罰會把課推散到不同天
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
          acc(map, 'walkCost', '走動成本', pen(w.walkCost) * sev(Math.min(dist - 1, 9)) * (relaxed ? 0.5 : 1),
            `${nameOf(tid)} 週${DAY_ZH[d]}第${a2.q}→${b2.q}節跨教室（距離 ${dist}${note}）`)
        }
      }
    })
  }

  // 同半天跨區來回（權重，預設高）：與「年級夾單節」同口徑，看教室設定的「區」（幾棟合成一區；未填＝每棟自成一區）。
  // 同一區的棟之間跑班可以接受，課務組：千萬不要讓老師來回跨區。用實際分配到的教室；沒進專科教室＝原班教室
  if (w.zoneSandwich !== 'off') {
    const areaOf = (l: EngineLesson): string | null => {
      const rid = roomOf.get(l.id)
      if (rid) return roomById.get(rid)?.area ?? null
      return input.classRoom[l.classKey]?.area ?? null
    }
    st.teacherOcc.forEach((occ, tid) => {
      if (hourlySet.has(tid)) return
      for (const d of SCHEDULE_DAYS) {
        const at = (q: number): EngineLesson | null => { const c = occ.get(`${d}-${q}`); const id = c?.w ?? c?.o ?? c?.e; return id ? st.lessonById.get(id)! : null }
        for (const q of [1, 2, 5]) {
          const a = at(q), b = at(q + 1), c = at(q + 2)
          if (!a || !b || !c || a.id === b.id || b.id === c.id) continue
          const za = areaOf(a), zb = areaOf(b), zc = areaOf(c)
          if (za && zb && zc && za === zc && za !== zb) {
            acc(map, 'zoneSandwich', '同半天跨區來回', pen(w.zoneSandwich),
              `${nameOf(tid)} 週${DAY_ZH[d]}第${q}→${q + 1}→${q + 2}節 ${za}→${zb}→${za}（${a.classLabel}→${b.classLabel}→${c.classLabel}）`)
          }
        }
      }
    })
  }

  // 小下課跨區（權重）：相鄰兩節不同區、中間只有十分鐘小下課＝一筆；大下課（第 n 節後）、午休（第 4 節後）、隔空堂不罰。
  // 一定得跨區的老師（同時教兩個年段），引擎會把跨區擺到大下課或午休，或中間留一堂——人工課表就是這樣排的。
  if (w.shortBreakCross.level !== 'off') {
    const areaOf = (l: EngineLesson): string | null => {
      const rid = roomOf.get(l.id)
      if (rid) return roomById.get(rid)?.area ?? null
      return input.classRoom[l.classKey]?.area ?? null
    }
    const big = w.shortBreakCross.n
    st.teacherOcc.forEach((occ, tid) => {
      if (hourlySet.has(tid)) return
      for (const d of SCHEDULE_DAYS) {
        const at = (q: number): EngineLesson | null => { const c = occ.get(`${d}-${q}`); const id = c?.w ?? c?.o ?? c?.e; return id ? st.lessonById.get(id)! : null }
        for (let q = 1; q <= 6; q++) {
          if (q === big || q === MORNING_LAST) continue   // 大下課、午休：有時間走
          const a = at(q), b = at(q + 1)
          if (!a || !b || a.id === b.id) continue
          const za = areaOf(a), zb = areaOf(b)
          if (za && zb && za !== zb) acc(map, 'shortBreakCross', '小下課跨區', pen(w.shortBreakCross.level), `${nameOf(tid)} 週${DAY_ZH[d]}第${q}→${q + 1}節 ${za}→${zb}（${a.classLabel}→${b.classLabel}，只有十分鐘）`)
        }
      }
    })
  }

  // 衝堂防護（必須級）：同師／同班同一格兩堂課。canPlace 本來就擋，但定向修補的「還原」若在別堂課占走原格後才發生，就會悄悄疊在一起
  // （v21 實測 粘瑋竹 週三第 2 節 6年11班＋6年9班）。teacherOcc 一格只存一個 id、後放的會蓋掉先放的，所以要從 pos 反查。
  {
    const byT = new Map<string, string[]>(), byC = new Map<string, string[]>()
    st.pos.forEach((p, id) => {
      const l = st.lessonById.get(id); if (!l) return
      for (let i = 0; i < l.size; i++) {
        const k = `${p.day}-${p.period + i}|${l.parity}`
        ;(byT.get(`${l.teacherId}|${k}`) ?? byT.set(`${l.teacherId}|${k}`, []).get(`${l.teacherId}|${k}`)!).push(id)
        ;(byC.get(`${l.classKey}|${k}`) ?? byC.set(`${l.classKey}|${k}`, []).get(`${l.classKey}|${k}`)!).push(id)
      }
    })
    // 同格的 weekly 與 odd／even 也衝；這裡先抓同 parity 的重疊（weekly 對 odd／even 的重疊由 canPlace 擋，實測未見漏網）
    byT.forEach((ids, k) => { if (ids.length > 1) { const [tid, sl] = k.split('|'); acc(map, 'clash', '老師衝堂（引擎內部錯誤）', MUST * (ids.length - 1), `${nameOf(tid)} ${slotZh(...(sl.split('-').map(Number) as [number, number]))}：${ids.map(id => st.lessonById.get(id)!.classLabel).join('＋')}`) } })
    byC.forEach((ids, k) => { if (ids.length > 1) { const [ck2, sl] = k.split('|'); acc(map, 'clash', '班級衝堂（引擎內部錯誤）', MUST * (ids.length - 1), `${ck2} ${slotZh(...(sl.split('-').map(Number) as [number, number]))}：${ids.map(id => st.lessonById.get(id)!.subject).join('＋')}`) } })
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
  private singleOnlyTeachers = new Set<string>()   // 全單節老師（沒有任何連堂）：「相鄰同年級」只看這些人
  private frozen = new Set<string>()               // 凍結的課（自然／科技教室優先求解定案）：局部搜尋不得搬動、不得逐出
  notes: string[] = []                              // 給使用者看的說明（降級紀錄）
  private get roomDayPref() { return this.st.roomDayPref }   // lessonId → 這堂課（管理教室的課）認領的日子：同一間教室的管理者先把週一～五切成連續區塊各自認領（放在 State 上，canPlace 對自然教室當硬限制）
  private anchored = new Set<string>()          // 錨定課：時間極受限老師（不排課多／負載比高）的課，先排且不被別堂逐出——人工排課的「先把行政／輔導團的課釘住」
  private hrBands = new Set<ReturnType<typeof bandOf>>()   // 導師連上上限適用年段
  private hrRunN = 3                                       // 導師連上上限節數

  /** @param initial 熱啟動落點（診斷探測／重排續跑用）：以既有解為搜尋起點，不合法的落點靜默略過，
   *  其餘課照常走建構流程補齊。 */
  constructor(input0: EngineInput, initial?: { id: string; day: number; period: number; teacherId?: string; teacherName?: string }[]) {
    // 課物件要複製：自動配班對調會改 lesson 的 teacherId，同一份 input 會被多個種子／保底重複使用，不能互相污染
    const input: EngineInput = { ...input0, lessons: input0.lessons.map(l => ({ ...l })) }
    this.input = input
    this.rnd = mulberry32(input.seed)
    this.st = new State(input)

    if (initial?.length) {
      // 熱啟動先套用原解的配班（自動配班對調的結果跟著落點一起帶過來），再放課
      for (const w of initial) {
        const l = this.st.lessonById.get(w.id)
        if (l && w.teacherId && w.teacherId !== l.teacherId) this.st.rebindTeacher(l, w.teacherId, w.teacherName ?? l.teacherName)
      }
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
    // 連堂配對容量比：同一位老師在同一組年段可排格裡要放的連堂數 ÷ 那組格子最多能放幾組相鄰兩格（不跨午休）。
    // 例：三年級科任格＝週一 3-7、週二 4-7、週四 3-7、週五 3-4，扣掉老師不排課，最多 7 組；她要排 7 組三年級視藝連堂
    // ＝比 1.0——只要別班的一堂單節卡在中間就永遠湊不成對。這種老師必須趁課表全空時整批落位（錨定），事後喬不回來。
    const pairCap = (slots: Set<string>) => {
      let n = 0
      for (const d of SCHEDULE_DAYS) for (let q = 1; q < 7; q++) {
        if (q === MORNING_LAST) continue
        if (slots.has(`${d}-${q}`) && slots.has(`${d}-${q + 1}`)) { n++; q++ }
      }
      return n
    }
    const dblGroups = new Map<string, { slots: Set<string>; n: number }>()   // `${tid}|${slotsSig}` → 連堂數
    for (const l of input.lessons) {
      if (l.size !== 2) continue
      const blocked = input.teacherBlocked[l.teacherId] ?? []
      const usable = (input.classSlots[l.classKey] ?? []).filter(s => !blocked.includes(s))
      const key = `${l.teacherId}|${usable.slice().sort().join(',')}`
      const g = dblGroups.get(key) ?? dblGroups.set(key, { slots: new Set(usable), n: 0 }).get(key)!
      g.n++
    }
    // 兩種量法取較緊者：同一組格子（同年段同鎖課）內的連堂數 ÷ 該組配對容量；全部連堂數 ÷ 全部可用格聯集的配對容量
    // （後者抓「三年級 2 組＋五年級 10 組＝12 組，只有四天可上＝一天 3 組剛好 12」這種跨年級加總的緊）
    const pairRatio = new Map<string, number>()
    const dblUnion = new Map<string, { slots: Set<string>; n: number }>()
    dblGroups.forEach((g, key) => {
      const tid = key.split('|')[0]
      if (g.n >= 2) pairRatio.set(tid, Math.max(pairRatio.get(tid) ?? 0, g.n / Math.max(1, pairCap(g.slots))))
      const u = dblUnion.get(tid) ?? dblUnion.set(tid, { slots: new Set(), n: 0 }).get(tid)!
      g.slots.forEach(x => u.slots.add(x)); u.n += g.n
    })
    dblUnion.forEach((u, tid) => { if (u.n >= 2) pairRatio.set(tid, Math.max(pairRatio.get(tid) ?? 0, u.n / Math.max(1, pairCap(u.slots)))) })
    const pairTight = new Set(Array.from(pairRatio.entries()).filter(([, r]) => r >= 0.85).map(([tid]) => tid))
    this.pairTight = pairTight
    for (const l of input.lessons) if (blockedOf(l.teacherId) >= 10 || teacherRatio(l.teacherId) >= 0.85 || pairTight.has(l.teacherId)) this.anchored.add(l.id)
    // 專科教室連堂（自然／科技）是最稀缺的資源：三間教室 42 個磚位對 42 組連堂，100% 用滿——
    // 一定要先排（像人工先拼磚），不然節數少的老師（如陳慧嘉 6 節）排到最後磚位全沒了，每個種子都剩她那堂
    const difficulty = (l: EngineLesson) =>
      (l.size === 2 ? 100 : 0) + (l.parity !== 'weekly' ? 50 : 0)
      + (l.size === 2 && (this.st.roomPool.get(l.id)?.length ?? 0) > 0 ? 400 : 0)
      + blockedOf(l.teacherId) * 3
      + (input.teacherMustTeach[l.teacherId]?.length ?? 0) * 3
      + (input.classMustFill[l.classKey]?.length ?? 0) * 2
      + teacherLoad[l.teacherId]
    // 建構期的「老師側」偏好（便宜的局部判斷，不算整張課表）：
    // 這兩條規則的地形是平的——某天 3 節英語＋1 節國際教育，把國際教育搬到另一個也有英語的日子還是混，分數不變，
    // 事後局部搜尋永遠走不過去；人工是「一開始就決定週一國際教育日、週二英語日」再往裡填。所以要在放的當下就避開。
    const w = input.weights
    const cpen = (lv: WeightLevel) => lv === 'off' ? 0 : Number.isFinite(WEIGHT_PENALTY[lv]) ? WEIGHT_PENALTY[lv] : 50   // 建構期的偏好分：必須級也只當「很大」，不能是 Infinity
    const apartPairs: { subjects: string[]; pen: number }[] = w.builtin.teacherApart === 'off' ? []
      : w.templates.filter(t => t.template === 'teacherApart' && t.level !== 'off' && t.subjects.length >= 2).map(t => ({ subjects: t.subjects, pen: cpen(t.level) }))
    const bandPen = cpen(w.builtin.bandAdjacent)
    const roomHalfPen = cpen(w.builtin.roomHalfDay)
    const hasDouble = new Set(input.lessons.filter(x => x.size === 2).map(x => x.teacherId))
    for (const x of input.lessons) if (!hasDouble.has(x.teacherId)) this.singleOnlyTeachers.add(x.teacherId)
    // 專科教室「先分天再填」：多位管理者共用一間教室時，依各自在這間教室的節數比例，把週一～五切成連續區塊
    // （甲＝一二三、乙＝三四五，邊界日共用）——人工排課就是先講好「你一三五、我二四」再填；邊排邊偏好只能得到局部最佳。
    // 順序吃種子（不同種子試不同的先後），只是偏好不是硬性：她的班級可排格塞不進去時仍可外溢
    if (roomHalfPen) {
      const byRoomTeacher = new Map<string, Map<string, EngineLesson[]>>()
      for (const x of input.lessons) {
        const mine = this.st.mgrRooms.get(x.id)
        if (!mine || mine.length !== 1) continue
        const m = byRoomTeacher.get(mine[0].id) ?? byRoomTeacher.set(mine[0].id, new Map()).get(mine[0].id)!
        ;(m.get(x.teacherId) ?? m.set(x.teacherId, []).get(x.teacherId)!).push(x)
      }
      byRoomTeacher.forEach((m, rid) => {
        if (m.size < 2) return
        const room = input.rooms.find(r => r.id === rid)
        const off = new Set(room?.offSlots ?? [])
        // 每位老師每天在這間教室最多能放幾組「連堂位」（她的班級可排格 ∩ 教室可用格，相鄰兩格不跨午休；單節算半組）
        const pairsOn = (slots: Set<string>, d: number) => {
          let n = 0
          for (let q = 1; q < 7; q++) {
            if (q === MORNING_LAST) continue
            if (slots.has(`${d}-${q}`) && slots.has(`${d}-${q + 1}`) && !off.has(`${d}-${q}`) && !off.has(`${d}-${q + 1}`)) { n++; q++ }
          }
          return n
        }
        const teacherSlots = new Map<string, Set<string>>()
        m.forEach((ls, tid) => { const u = new Set<string>(); ls.forEach(x => (input.classSlots[x.classKey] ?? []).forEach(sl => u.add(sl))); teacherSlots.set(tid, u) })
        const allSlots = new Set<string>(); teacherSlots.forEach(u => u.forEach(sl => allSlots.add(sl)))
        const roomCap = SCHEDULE_DAYS.map(d => pairsOn(allSlots, d))          // 教室每天最多幾組
        const need = new Map<string, number>()                                  // 每位老師要幾組（單節算 0.5）
        m.forEach((ls, tid) => need.set(tid, ls.reduce((b, x) => b + x.size / 2, 0)))
        const totalNeed = Array.from(need.values()).reduce((a, b) => a + b, 0)
        const totalCap = roomCap.reduce((a, b) => a + b, 0)
        // 依序認領：從週一開始吃，吃到夠為止；邊界日剩下的容量留給下一位。老師順序吃種子（不同種子試不同先後）。
        // 老師順序不再隨機：誰「週末（四、五）的位子少」誰先從週一開始認領，週末位子多的墊後——
        // 四年級週五沒下午 → 許老師先（一二三）、五年級可用週五下午 → 陳老師後（三四五）；三年級同理先、六年級後。
        // 這是人排的邏輯：把只能用早段的人放早段，能用晚段的人放晚段。平手才隨機
        const lateMinusEarly = (tid: string) => {
          const u = teacherSlots.get(tid)!
          return (pairsOn(u, 4) + pairsOn(u, 5)) - (pairsOn(u, 1) + pairsOn(u, 2))
        }
        // 平手（早晚段位子一樣多）→ 班級彈性小的老師先（四年級種子班只能用 1-2／下午的許老師，排在五年級班都很寬的陳老師前面）
        const flexibility = (tid: string) => (m.get(tid) ?? []).reduce((acc, x) => { const u = new Set(this.input.classSlots[x.classKey] ?? []); return acc + SCHEDULE_DAYS.reduce((a2, d) => a2 + pairsOn(u, d), 0) }, 0)
        const order = Array.from(m.keys()).sort((a, b) => (lateMinusEarly(a) - lateMinusEarly(b)) || (flexibility(a) - flexibility(b)) || (this.rnd() - 0.5))
        order.forEach((tid, i) => this.roomTeacherRank.set(`${rid}|${tid}`, i))
        const used = [0, 0, 0, 0, 0, 0]   // 教室每天已被前面的老師吃掉幾組
        const quota = new Map<string, number>()   // `${tid}|${d}` → 這位老師這天分到幾組
        let cursor = 1
        let feasible = totalNeed <= totalCap + 1e-9
        const assign = new Map<string, Set<number>>()
        for (const tid of order) {
          let left = need.get(tid)!
          const days = new Set<number>()
          const mySlots = teacherSlots.get(tid)!
          while (left > 1e-9 && cursor <= 5) {
            const d = cursor
            const capHere = Math.min(roomCap[d - 1] - used[d], pairsOn(mySlots, d))
            if (capHere <= 1e-9) { cursor++; continue }            // 這天她放不了（教室滿／她的班沒格）→ 跳過
            const take = Math.min(capHere, left)
            days.add(d); used[d] += take; left -= take
            quota.set(`${tid}|${d}`, take)   // 她這天最多放幾組（邊界日只分到一部分，多放就會把下一位擠出去）
            if (used[d] >= roomCap[d - 1] - 1e-9) cursor++          // 這天教室吃滿 → 下一位從下一天起
            else if (left <= 1e-9) break                            // 她夠了、這天還有剩 → 下一位從同一天接（邊界日共用）
            else cursor++                                           // 她這天能放的都放了還不夠 → 下一天（剩的容量放棄，避免別人插進她的區塊）
          }
          if (left > 1e-9) feasible = false
          if (!days.size) days.add(Math.min(cursor, 5))
          assign.set(tid, days)
        }
        // 只當建構偏好、不當硬限制：教室常常 100% 滿載（14 組連堂／14 個位子），認領日子當硬限制會讓一半種子排不完
        // （實測未排 2～7），而保底一鬆綁結構就全沒了；偏好＋交接計分＋定向修補是目前可行性與集中度的平衡點
        const hardRoom = false && feasible && input.weights.hardParams.noReturnSubjects.includes(room?.subject ?? '')
        m.forEach((ls, tid) => { const days = assign.get(tid)!; for (const x of ls) { this.st.roomDayPref.set(x.id, days); if (hardRoom) this.st.roomDayHard.add(x.id); for (const d of days) this.roomDayQuota.set(`${x.id}|${d}`, quota.get(`${tid}|${d}`) ?? 0) } })
      })
    }
    const teacherSidePenalty = (l: EngineLesson, p: Placement): number => {
      const tOcc = this.st.teacherOcc.get(l.teacherId)
      if (!tOcc) return 0
      let pen = 0
      // ① 老師同日不混科目：當天已有另一類 → 罰；當天已有同類 → 小小獎勵（把同類聚在同一天）
      if (apartPairs.length) {
        const daySubjects = new Set<string>()
        for (let q = 1; q <= 7; q++) { const cell = tOcc.get(`${p.day}-${q}`); const id = cell?.w ?? cell?.o ?? cell?.e; if (id) daySubjects.add(this.st.lessonById.get(id)!.subject) }
        for (const ap of apartPairs) {
          if (!ap.subjects.includes(l.subject)) continue
          const others = ap.subjects.filter(sb => sb !== l.subject && daySubjects.has(sb))
          if (others.length) pen += ap.pen * 2
          else if (daySubjects.has(l.subject)) pen -= 1
        }
      }
      // ③ 專科教室老師集中（只看有管理教室者：她的教室是確定的）：
      //    今天教室已有別人 → 重罰（同半天再加罰）；今天已有自己 → 大獎勵（把這一天填滿）；
      //    今天沒人：前後一天有自己 → 小罰（把連段延長）、否則 → 罰（開孤立的新一天，之後別人插進來就是兩次交接）；
      //    再加上「放這裡會讓一週交接多幾次」（別人已放好的情況）
      if (roomHalfPen) {
        const mine = this.st.mgrRooms.get(l.id)
        if (mine && mine.length === 1) {
          const rid = mine[0].id
          const occ = this.st.roomOcc.get(rid)
          const teacherAt = (d: number, q: number) => { const cell = occ?.get(`${d}-${q}`); const id = cell?.w ?? cell?.o ?? cell?.e; return id && id !== ROOM_OFF ? this.st.lessonById.get(id)?.teacherId : undefined }
          const half = p.period <= MORNING_LAST ? [1, 2, 3, 4] : [5, 6, 7]
          let otherDay = false, sameDay = false, otherHalf = false, adjDay = false
          for (let q = 1; q <= 7; q++) {
            const t = teacherAt(p.day, q); if (!t) continue
            if (t === l.teacherId) sameDay = true; else { otherDay = true; if (half.includes(q)) otherHalf = true }
          }
          for (const d of [p.day - 1, p.day + 1]) if (d >= 1 && d <= 5) for (let q = 1; q <= 7; q++) if (teacherAt(d, q) === l.teacherId) { adjDay = true; break }
          // 偏好分要節制：太重會扭曲建構、讓可行性掉下來（實測 +3pen 的認領日罰分讓五個種子全排不完）
          if (otherDay) pen += roomHalfPen + (otherHalf ? roomHalfPen * 0.5 : 0)
          else if (sameDay) pen -= roomHalfPen
          else pen += adjDay ? 0 : roomHalfPen * 0.5
          const pref = this.roomDayPref.get(l.id)
          if (pref) {
            pen += pref.has(p.day) ? -roomHalfPen * 0.5 : roomHalfPen * 2   // 先分好的日子：在自己的區塊裡加分、跑到別人的區塊扣分（×2：一組跑出區塊＝多一次交接）
            // 邊界日配額：她這天只分到 1 組（週三上午一組留給下一位），已經放了就別再放——否則把下一位擠出她的區塊
            const q = this.roomDayQuota.get(`${l.id}|${p.day}`)
            if (q !== undefined) {
              let mineToday = 0
              for (let qq = 1; qq <= 7; qq++) if (teacherAt(p.day, qq) === l.teacherId) mineToday += 0.5
              if (mineToday + l.size / 2 > q + 1e-9) pen += roomHalfPen * 2
            }
          }
          const delta = this.st.roomTransitions(rid, l, p) - this.st.roomTransitions(rid)
          if (delta > 0) pen += roomHalfPen * delta
        }
      }
      // ② 全單節老師相鄰同年級：前後相鄰那格若是別的年級 → 罰
      if (bandPen && l.size === 1 && !hasDouble.has(l.teacherId)) {
        for (const q of [p.period - 1, p.period + 1]) {
          const cell = tOcc.get(`${p.day}-${q}`); const id = cell?.w ?? cell?.o ?? cell?.e
          if (id) pen += this.st.lessonById.get(id)!.grade !== l.grade ? bandPen : -bandPen   // 同年級相鄰給獎勵，才會「聚」起來，不只是「躲」
        }
      }
      return pen
    }
    // ── 第零階段：自然／科技教室優先（hardParams.roomBlockSubjects）──
    // 實驗器材的緣故：一間教室一週時間軸上，每位管理者只占一個連續區塊、不交錯（甲一二三、乙三四五）；
    // 同一位老師區塊裡年級也連續（六年級全部上完才開始四年級，跨天也算）。
    // 做法＝課表全空時先為每間教室做精確搜尋（老師先後 × 年級先後 × 落點，時間軸單調前進），放得下就定案並凍結；
    // 放不下自動降級：先放寬「年級連續」、再放寬「老師不交錯」交回一般排法，並把原因記在 notes。鎖課本來就不在可排格裡，自動優先。
    if (!initial?.length) this.solveRoomBlocks()

    // ── 前置階段：先排「科任教室」，不是先排課 ──
    // 教室數量固定、常常剛好夠用（如自然三間各 14 組對容量 14），排在後面就再也塞不進去。
    // 因此趁課表全空時，把所有要進專科教室的課先用回溯法填進教室：
    //   第一輪：每間教室的管理教師 → 填自己那間（依需求最滿的教室先）；
    //   第二輪：沒有管理教室的老師 → 填整科剩下的教室格（可跨間）。
    // 這些課之後仍可換時段（鎖的是教室歸屬，不是時段），但 canPlace 保證換到哪都有教室。
    {
      const fillBatch = (todo0: EngineLesson[], ok: (l: EngineLesson) => boolean) => {
        // 同一位老師的課排在一起（老師順序隨種子）：她先把自己教室的整個半天占滿，下一位再接——同教室同半天才會是同一位老師
        const tOrder = new Map<string, number>()
        for (const l of todo0) if (!tOrder.has(l.teacherId)) {
          const rid = (this.st.mgrRooms.get(l.id) ?? [])[0]?.id
          const rank = rid !== undefined ? this.roomTeacherRank.get(`${rid}|${l.teacherId}`) : undefined
          tOrder.set(l.teacherId, rank !== undefined ? rank : 10 + this.rnd())   // 有認領日子的依認領順序（週一那位先填），其餘隨機
        }
        const todo = todo0.filter(l => !this.st.pos.has(l.id))
          .sort((x, y) => (tOrder.get(x.teacherId)! - tOrder.get(y.teacherId)!) || (y.size - x.size) || (classSlack(x.classKey) - classSlack(y.classKey)) || (this.rnd() - 0.5))
        let nodes = 0
        const dfs = (i: number): boolean => {
          if (i >= todo.length) return true
          if (++nodes > 20000) return false
          const l = todo[i]
          // 候選格子打散：前置階段若不吃種子，五個種子會排出完全相同的教室配置，多起點就失去意義
          const cands = this.st.candidates(l)
          for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(this.rnd() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]] }
          const tsp = new Map(cands.map(p => [p, teacherSidePenalty(l, p)]))
          cands.sort((a, b) => tsp.get(a)! - tsp.get(b)!)   // 打散後再依老師側偏好排序（穩定排序保留隨機性當平手順序）
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
      // 第零輪：連堂配對容量緊（比 ≥0.85）且不進專科教室的老師 → 整批先落位。她們的「相鄰兩格」跟教室一樣是稀缺資源，
      // 排在教室之後就會被別科的單節卡在中間，最後一組永遠湊不成對（三年級視藝就是這樣）。
      // 整批＝她所有的連堂（進不進教室都算，canPlace 本來就要求要進教室的課有教室），最緊的老師先
      const roomsByTight = [...input.rooms].map(r => {
        const ls = input.lessons.filter(l => l.subject === r.subject && r.managerIds.includes(l.teacherId)
          && shouldUseRoom(input.weights, l.subject, l.grade, l.size))
        return { r, ls, tight: Math.max(0, ...r.managerIds.map(id => pairRatio.get(id) ?? 0)) }
      }).filter(x => x.ls.length > 0)
        .sort((x, y) => (Number(y.tight >= 0.85) - Number(x.tight >= 0.85)) || (y.ls.length - x.ls.length) || (this.rnd() - 0.5))   // 需求最滿的教室先；同樣滿的隨機
      // 第零輪（甲）：不回頭科目（自然）的教室最先——實驗器材的緣故自然優先；趁課表全空時照「先分天」的區塊填，
      // 否則別科的緊老師（資訊教室）先把五年級上午格吃掉，許老師週二就少一格、第 7 組被擠到週四
      const priority = new Set(input.weights.hardParams.noReturnSubjects)
      for (const { r, ls } of roomsByTight.filter(x => priority.has(x.r.subject))) fillBatch(ls, l => this.st.roomOf.get(l.id) === r.id)
      const tightTeachers = Array.from(pairTight).sort((x, y) => (pairRatio.get(y)! - pairRatio.get(x)!) || (this.rnd() - 0.5))
      for (const tid of tightTeachers) fillBatch(input.lessons.filter(l => l.teacherId === tid && l.size === 2), () => true)
      // 第一輪：管理教師 → 自己的教室（管理者裡有連堂緊的老師的教室先）
      for (const { r, ls } of roomsByTight.filter(x => !priority.has(x.r.subject))) fillBatch(ls, l => this.st.roomOf.get(l.id) === r.id)
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
          // 候選順序加一點隨機（種子可重現），避免每個種子走同一條死路；再依老師側偏好排序
          for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(this.rnd() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]] }
          const tsp = new Map(cands.map(p => [p, teacherSidePenalty(l, p)]))
          cands.sort((a, b) => tsp.get(a)! - tsp.get(b)!)
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

    // 第零步 A0：必排格「整段」回溯（見 solveMustRuns）。
    // 試過把這一步提前到專科教室階段之前（全部提前、只提前最搶手的組都試過）：
    // 必須級確實降下來，但教室的位子被吃掉，未排反而升到 1～4、一顆都沒成功——所以維持在教室階段之後。
    this.solveMustRuns(1)

    // 第零步 A：必排格覆蓋——同一時段多班互搶老師是配對問題，
    // 用二部圖最大匹配（Kuhn 增廣路徑）保證可配就配到（A0 解不掉的殘局才輪到這裡）
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
    // 註：課務組口述的人工順序是「有教室的連堂 → 英語 → 表藝 → 社會連堂 → 單節」按科目層級橫掃全校。
    //     拿它當主排序實測過：8 顆種子 0 顆成功（原本 2 顆），連原本穩定成功的 17、63 都掛掉——
    //     人工掃科目時是邊掃邊回頭改，我們這一步是一次性貪婪，硬套會把「洞少的班先排完」這個補償機制拆掉。
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
        const score = -coverMust * 1000 + (p.period <= 4 ? 5 : 0) + teacherSidePenalty(l, p) + this.rnd()
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
    for (let k = 0; k < this.input.classes.length * 2; k++) this.tryFixHomeroomMin()
    for (let k = 0; k < this.input.classes.length; k++) this.tryFixHomeroomDouble()
    for (let k = 0; k < this.input.classes.length; k++) this.tryFixHomeroomMorningMax()
    for (let k = 0; k < this.input.classes.length; k++) this.tryFixHomeroomDailyMax()
    for (let k = 0; k < this.input.classes.length; k++) this.tryFixHalfDayAllHomeroom()
    for (let k = 0; k < 6; k++) this.tryFixHourlyDays()
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
      const hrLock = new Set(this.input.homeroomLocks[c.classKey] ?? [])
      for (const d of SCHEDULE_DAYS) for (const seg of [[1, 2, 3, 4], [5, 6, 7]]) {
        const cells = seg.map(q => `${d}-${q}`).filter(k => avail.includes(k) || k in locks)
        const taken = cells.map(k => cOcc.has(k) || (k in locks && !hrLock.has(k)))
        const first = taken.indexOf(true), last = taken.lastIndexOf(true)
        if (first < 0) continue
        for (let i = first + 1; i < last; i++) if (!taken[i] && !mustLeave.includes(cells[i])) holes.push({ classKey: c.classKey, slot: cells[i] })
      }
    }
    if (!holes.length) return
    const h = holes[Math.floor(this.rnd() * holes.length)]
    const p = parseSlotKey(h.slot)
    const ls = (this.lessonsByClass.get(h.classKey) ?? []).filter(l => l.size === 1 && this.st.pos.has(l.id) && !this.frozen.has(l.id))
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

  /** 定向搬動共用：把 l 搬到符合 want 的候選格（直接搬；不行就與同班另一位老師的同型態課互換），
   *  全域分數 accept 才採用。老師側規則（同日不混科目、相鄰同年級）地形是平的，隨機搬動走不出去，必須定向。 */
  private directedMove(l: EngineLesson, want: (p: Placement) => boolean): boolean {
    const from = this.st.pos.get(l.id)
    if (!from || this.frozen.has(l.id)) return false
    const bMust = this.mustSetByClass.get(l.classKey)
    if (bMust && bMust.has(`${from.day}-${from.period}`)) return false
    // ① 直接搬
    this.st.remove(l)
    const cands = this.st.candidates(l).filter(p => !(p.day === from.day && p.period === from.period) && want(p))
    const start = Math.floor(this.rnd() * Math.max(1, cands.length))
    for (let k = 0; k < cands.length; k++) {
      const p = cands[(start + k) % cands.length]
      this.st.place(l, p)
      const sc = scoreState(this.st)
      if (this.accept(sc)) { this.take(sc); return true }
      this.st.remove(l)
    }
    this.st.place(l, from)
    // ② 與同班另一位老師的同型態課互換
    const partners = (this.lessonsByClass.get(l.classKey) ?? []).filter(x =>
      x.id !== l.id && x.teacherId !== l.teacherId && x.size === l.size && x.parity === l.parity && this.st.pos.has(x.id) && !this.frozen.has(x.id) && want(this.st.pos.get(x.id)!))
    const s2 = Math.floor(this.rnd() * Math.max(1, partners.length))
    for (let k = 0; k < partners.length; k++) {
      const l2 = partners[(s2 + k) % partners.length]
      const p2 = this.st.pos.get(l2.id)!
      const b2 = this.mustSetByClass.get(l2.classKey)
      if (b2 && b2.has(`${p2.day}-${p2.period}`)) continue
      this.st.remove(l); this.st.remove(l2)
      let done = false
      if (this.st.canPlace(l, p2)) {
        this.st.place(l, p2)
        if (this.st.canPlace(l2, from)) {
          this.st.place(l2, from)
          const sc = scoreState(this.st)
          if (this.accept(sc)) { this.take(sc); done = true }
          else this.st.remove(l2)
        }
        if (!done) this.st.remove(l)
      }
      if (done) return true
      this.st.place(l, from); this.st.place(l2, p2)
    }
    // ③ 與同一間教室裡別位老師的同型態課互換（教室快滿時，兩位管理者的連堂只能對調半天，搬不動）
    const rid = this.st.roomOf.get(l.id)
    if (rid) {
      const mates: EngineLesson[] = []
      this.st.pos.forEach((pp, id) => {
        if (id === l.id || this.frozen.has(id) || this.st.roomOf.get(id) !== rid) return
        const x = this.st.lessonById.get(id)!
        if (x.teacherId !== l.teacherId && x.size === l.size && x.parity === l.parity && want(pp)) mates.push(x)
      })
      const s3 = Math.floor(this.rnd() * Math.max(1, mates.length))
      for (let k = 0; k < mates.length; k++) {
        const l2 = mates[(s3 + k) % mates.length]
        const p2 = this.st.pos.get(l2.id)!
        const b2 = this.mustSetByClass.get(l2.classKey)
        if (b2 && b2.has(`${p2.day}-${p2.period}`)) continue
        this.st.remove(l); this.st.remove(l2)
        let done = false
        if (this.st.canPlace(l, p2)) {
          this.st.place(l, p2)
          if (this.st.canPlace(l2, from)) {
            this.st.place(l2, from)
            const sc = scoreState(this.st)
            if (this.accept(sc)) { this.take(sc); done = true }
            else this.st.remove(l2)
          }
          if (!done) this.st.remove(l)
        }
        if (done) return true
        this.st.place(l, from); this.st.place(l2, p2)
      }
    }
    return false
  }

  /** 老師同日不混科目定向修補（權重）：找一個「同一天混了兩類」的老師日，把少數那一類的一堂課
   *  搬到這位老師「當天沒有另一類」的日子。 */
  private tryFixTeacherApart() {
    const w = this.input.weights
    if (w.builtin.teacherApart === 'off') return
    const tpls = w.templates.filter(t => t.template === 'teacherApart' && t.level !== 'off' && t.subjects.length >= 2)
    if (!tpls.length) return
    const byTeacherDay = new Map<string, Map<string, EngineLesson[]>>()
    this.st.pos.forEach((p, id) => {
      const l = this.st.lessonById.get(id)!
      const k = `${l.teacherId}|${p.day}`
      const m = byTeacherDay.get(k) ?? byTeacherDay.set(k, new Map()).get(k)!
      ;(m.get(l.subject) ?? m.set(l.subject, []).get(l.subject)!).push(l)
    })
    const mixed: { tid: string; minority: EngineLesson[]; tpl: string[] }[] = []
    byTeacherDay.forEach((subs, k) => {
      const tid = k.split('|')[0]
      for (const t of tpls) {
        const hit = t.subjects.filter(sb => subs.has(sb))
        if (hit.length < 2) continue
        const sorted = hit.slice().sort((a, b) => subs.get(a)!.length - subs.get(b)!.length)
        mixed.push({ tid, minority: subs.get(sorted[0])!, tpl: t.subjects })
      }
    })
    if (!mixed.length) return
    const m = mixed[Math.floor(this.rnd() * mixed.length)]
    const l = m.minority[Math.floor(this.rnd() * m.minority.length)]
    const from = this.st.pos.get(l.id)!
    this.directedMove(l, p => {
      if (p.day === from.day) return false
      const subs = byTeacherDay.get(`${m.tid}|${p.day}`)
      return !subs || !m.tpl.some(sb => sb !== l.subject && subs.has(sb))
    })
  }

  /** 全單節老師相鄰同年級定向修補（權重）：找一對「相鄰但不同年級」的課，把其中一堂搬到
   *  「旁邊是同年級、且不會製造新的跨年級相鄰」的格子。 */
  private tryFixBandAdjacent() {
    if (this.input.weights.builtin.bandAdjacent === 'off') return
    const bad: EngineLesson[] = []
    this.singleOnlyTeachers.forEach(tid => {
      const occ = this.st.teacherOcc.get(tid)
      if (!occ) return
      for (const d of SCHEDULE_DAYS) for (let q = 1; q < 7; q++) {
        const c1 = occ.get(`${d}-${q}`), c2 = occ.get(`${d}-${q + 1}`)
        const i1 = c1?.w ?? c1?.o ?? c1?.e, i2 = c2?.w ?? c2?.o ?? c2?.e
        if (!i1 || !i2) continue
        const a = this.st.lessonById.get(i1)!, b = this.st.lessonById.get(i2)!
        if (a.grade !== b.grade) bad.push(this.rnd() < 0.5 ? a : b)
      }
    })
    if (!bad.length) return
    const l = bad[Math.floor(this.rnd() * bad.length)]
    const occ = this.st.teacherOcc.get(l.teacherId)!
    this.directedMove(l, p => {
      let same = 0
      for (const q of [p.period - 1, p.period + 1]) {
        const c = occ.get(`${p.day}-${q}`); const id = c?.w ?? c?.o ?? c?.e
        if (!id || id === l.id) continue
        if (this.st.lessonById.get(id)!.grade !== l.grade) return false
        same++
      }
      return same > 0
    })
  }

  /** 必排格「整段」回溯：把每班的必排格切成連續段，同一天節次重疊的段（＝搶同一批老師與專科教室）一起解。
   *  @param minClasses 只處理班數 ≥ 這個數的組——最搶手的組要在專科教室階段之前先配掉，其餘留到之後。 */
  private solveMustRuns(minClasses: number) {
      // 每組各自的預算（一組難解不能把別組餓死——種子 42 就是週一 6-7 那組吃光全域預算，六年級那組根本沒輪到）
      const G_NODES = 60_000, G_MS = 600, A_MS = 6000
      const aT0 = Date.now()
      type MustRun = { classKey: string; day: number; periods: number[] }
      const runs: MustRun[] = []
      this.mustSetByClass.forEach((set, ck) => {
        const occ0 = this.st.classOcc.get(ck)
        const list = Array.from(set).map(parseSlotKey).sort((a, b) => a.day - b.day || a.period - b.period)
        let cur: MustRun | null = null
        for (const q of list) {
          if (occ0?.has(`${q.day}-${q.period}`)) { cur = null; continue }   // 已被鎖課／熱啟動蓋掉
          if (cur && cur.day === q.day && q.period === cur.periods[cur.periods.length - 1] + 1) cur.periods.push(q.period)
          else { cur = { classKey: ck, day: q.day, periods: [q.period] }; runs.push(cur) }
        }
      })
      // 分組：同一天、節次有重疊的段併成一組——它們在搶同一批老師與專科教室，分開解等於各自為政
      // （六年級有的班是 週四 6-7、有的只剩 週四 7，照段型分會拆成兩組，那正是排不出來的原因）
      const groups: MustRun[][] = []
      const byDay = new Map<number, MustRun[]>()
      for (const r of runs) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r])
      byDay.forEach(list => {
        const comp: MustRun[][] = []
        for (const r of list) {
          const hit = comp.filter(c => c.some(x => x.periods.some(q => r.periods.includes(q))))
          for (const h of hit) comp.splice(comp.indexOf(h), 1)
          comp.push([r, ...hit.flat()])
        }
        for (const c of comp) groups.push(c)
      })
      groups.sort((a, b) => b.length - a.length)
      if (A0_TRACE.on) A0_TRACE.lines.push(`A0 ${groups.length} 組：` + groups.slice(0, 6).map(g => `${g[0].day}/${Array.from(new Set(g.flatMap(r => r.periods))).sort().join('-')}×${g.length}班`).join('、'))
      for (const g of groups) {
        if (g.length < minClasses) continue
        if (Date.now() - aT0 > A_MS) { if (A0_TRACE.on) A0_TRACE.lines.push('A0 總時間用完，剩餘組未處理'); break }
        const before = new Set(this.st.pos.keys())
        const gT0 = Date.now()
        let nodes = 0
        const over = () => nodes > G_NODES || Date.now() - gT0 > G_MS
        const poolOf = (ck: string) => (this.lessonsByClass.get(ck) ?? []).filter(l => !this.st.pos.has(l.id) && !this.frozen.has(l.id))
        /** 這一段目前第一個還沒蓋到的節次；全蓋到回 null */
        const nextGap = (r: MustRun) => r.periods.find(q => !this.st.classOcc.get(r.classKey)?.has(`${r.day}-${q}`)) ?? null
        /** 這一段眼前有幾種放法（給「選擇最少的先決定」用） */
        const optionCount = (r: MustRun) => {
          const per = nextGap(r)
          if (per === null) return Infinity   // 已解決，排到最後
          let n = 0
          for (const l of poolOf(r.classKey)) {
            const tries: Placement[] = l.size === 2 ? [{ day: r.day, period: per }, { day: r.day, period: per - 1 }] : [{ day: r.day, period: per }]
            for (const q of tries) if (q.period >= 1 && this.st.canPlace(l, q)) n++
          }
          return n
        }
        const cover = (r: MustRun, then: () => boolean): boolean => {
          if (over()) return false
          const per = nextGap(r)
          if (per === null) return then()
          nodes++
          const nextAlso = r.periods.includes(per + 1)
          // 不佔專科教室的科目先試。人工課表四期都是這個形狀：共同不排課那一格的主力是
          // 社會／體育／英語／健康，需教室的科目只補到剛好等於教室數。逆推沙盒也一樣：
          // 成功的種子在六年級週四第 7 節一組 6-7 連堂都沒用（音樂、表藝、自然各只 1 班），
          // 失敗的種子用了三組連堂把資訊教室、自然教室塔滿，三年級的智慧連堂就塔不進去了。
          // （專科教室的使用率本來就接近 100%，多占兩節就是別人排不進去。）
          const roomy = (l: EngineLesson) => Number((this.st.roomPool.get(l.id)?.length ?? 0) > 0)
          const pool = poolOf(r.classKey).sort((a, b) =>
            (roomy(a) - roomy(b))
            || (nextAlso ? b.size - a.size : a.size - b.size) || (this.rnd() - 0.5))
          for (const l of pool) {
            const tries: Placement[] = l.size === 2 ? [{ day: r.day, period: per }, { day: r.day, period: per - 1 }] : [{ day: r.day, period: per }]
            for (const q of tries) {
              if (q.period < 1 || !this.st.canPlace(l, q)) continue
              this.st.place(l, q)
              if (cover(r, then)) return true
              this.st.remove(l)
              if (over()) return false
            }
          }
          return false
        }
        // 最受限的段先決定（每一層重算）：選擇少的先做，死路才會早點被發現，不會像原本那樣一路試到預算燒光
        const solve = (rest: MustRun[]): boolean => {
          if (!rest.length) return true
          if (over()) return false
          let bi = -1, bn = Infinity
          for (let i = 0; i < rest.length; i++) {
            const c = optionCount(rest[i])
            if (c === 0) return false            // 有段已經沒得放 → 立刻回溯
            if (c !== Infinity && c < bn) { bn = c; bi = i }
          }
          if (bi < 0) return true                // 全部都已被蓋掉
          return cover(rest[bi], () => solve(rest.filter((_, i) => i !== bi)))
        }
        const okA0 = solve(g)
        if (A0_TRACE.on && g.length > 1) A0_TRACE.lines.push(`  ${g[0].day}/${Array.from(new Set(g.flatMap(r => r.periods))).sort().join('-')} ×${g.length}班 → ${okA0 ? '解出' : '失敗'}（節點 ${nodes}、${Date.now() - gT0}ms）`)
        if (!okA0) for (const id of Array.from(this.st.pos.keys())) if (!before.has(id)) this.st.remove(this.st.lessonById.get(id)!)
      }
  }

  /** 自然／科技教室優先求解（見建構子註解）。每間教室：老師順序的排列 × 每位老師年級順序的排列 → 依序列
   *  把課沿時間軸（週一第 1 節 → 週五第 7 節）單調往後放，同一組（同師同年級）裡的課誰先誰後由回溯決定。 */
  private solveRoomBlocks() {
    const subjects = this.input.weights.hardParams.roomBlockSubjects
    if (!subjects.length) return
    const rooms = this.input.rooms.filter(r => subjects.includes(r.subject) && r.managerIds.length > 0)
      .sort((a, b) => (subjects.indexOf(a.subject) - subjects.indexOf(b.subject)) || (this.rnd() - 0.5))   // 清單順序＝優先序（自然先）
    const tl = (p: Placement) => (p.day - 1) * 7 + p.period
    const perms = <T,>(xs: T[]): T[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r]))
    for (const room of rooms) {
      const roomLessons = () => this.input.lessons.filter(l => !this.st.pos.has(l.id) && (this.st.mgrRooms.get(l.id) ?? [])[0]?.id === room.id)
      if (!roomLessons().length) continue
      // 預先對調：這間教室管理者的自動配班裡，落點很少的班（種子班：每天 3-4 都鎖給國數）換成同科同年級別位老師手上落點多的班——
      // 「只要沒有手動指定的配班都可以調」。每換一班記一筆說明；整間最後還是放不進才復原
      const preUndo: (() => void)[] = []
      this.curGroups = null
      for (const l of roomLessons()) {
        if (!l.autoAssigned || l.size !== 2) continue
        const myN = this.st.candidates(l).length
        let best: EngineLesson | null = null, bestN = myN + 3
        for (const p of this.swapPartners(l)) { const n = this.st.candidates(p).length; if (n > bestN) { best = p; bestN = n } }
        if (best) { const u = this.swapAssignment(l, best); if (u) preUndo.push(u) }
      }
      const lessons = roomLessons()
      const byTeacher = new Map<string, EngineLesson[]>()
      for (const l of lessons) (byTeacher.get(l.teacherId) ?? byTeacher.set(l.teacherId, []).get(l.teacherId)!).push(l)
      const teachers = Array.from(byTeacher.keys()).sort(() => this.rnd() - 0.5)
      const teacherOrders = teachers.length <= 3 ? perms(teachers) : [teachers, [...teachers].reverse()]
      // 一組序列＝[[同師同年級的課], ...]；回溯沿時間軸單調放
      const roomT0 = Date.now()
      this.curGroups = null
      const trySequence = (groups: EngineLesson[][], nodeCap: number, msCap = 100): boolean => {
        this.curGroups = groups
        let nodes = 0
        const t0 = Date.now()
        const placedHere: EngineLesson[] = []
        // 沿時間軸走：每一步決定「下一個可用的時間點」放哪一堂（或空著跳過）。分支＝能放在那個時間點的課數＋1，
        // 比「任一堂 × 任一格」的分支小得多；並做前瞻：剩下的每一堂在 cursor 之後都還要有位子，否則剪枝
        const dfs = (gi: number, cursor: number): boolean => {
          if (gi >= groups.length) return true
          if (++nodes > nodeCap || Date.now() - t0 > msCap) return false   // 每次嘗試有時間上限
          const remaining = groups[gi].filter(l => !this.st.pos.has(l.id))
          if (!remaining.length) return dfs(gi + 1, cursor)
          const optsOf = new Map<EngineLesson, Placement[]>()
          let earliest = Infinity
          for (const l of remaining) {
            const ps = this.st.candidates(l).filter(p => tl(p) > cursor)
            if (!ps.length) {
              // 前瞻：這堂已經沒位子 → 若是自動配班，試著跟同科同年級另一位老師的自動配班對調（那一班的格子形狀可能合）
              if (!l.autoAssigned) return false
              for (const partner of this.swapPartners(l)) {
                const undo = this.swapAssignment(l, partner)
                if (!undo) continue
                const ok = this.st.candidates(partner).some(p => tl(p) > cursor) && dfs(gi, cursor)   // partner 現在是這位老師的課、在這一組裡
                if (ok) return true
                undo()
              }
              return false
            }
            optsOf.set(l, ps)
            for (const p of ps) earliest = Math.min(earliest, tl(p))
          }
          // 後面的組也要還有位子（粗略前瞻：只看每組第一堂）
          for (let gj = gi + 1; gj < groups.length; gj++) {
            const probe = groups[gj].find(l => !this.st.pos.has(l.id))
            if (probe && !this.st.candidates(probe).some(p => tl(p) > cursor)) return false
          }
          // 在最早的時間點：試每一堂能放這裡的（隨機順序），再試跳過這個時間點
          const here = remaining.filter(l => optsOf.get(l)!.some(p => tl(p) === earliest)).sort(() => this.rnd() - 0.5)
          for (const l of here) {
            const p = optsOf.get(l)!.find(pp => tl(pp) === earliest)!
            this.st.place(l, p); placedHere.push(l)
            if (dfs(gi, earliest + l.size - 1)) return true
            this.st.remove(l); placedHere.pop()
          }
          return dfs(gi, earliest)   // 跳過這個時間點
        }
        const ok = dfs(0, 0)
        if (!ok) { for (const l of placedHere) if (this.st.pos.has(l.id)) this.st.remove(l); placedHere.length = 0 }
        return ok
      }
      const label = `${room.label}（${teachers.map(t => this.input.lessons.find(l => l.teacherId === t)?.teacherName ?? t).join('、')}）`
      let done = false
      // 第一層：老師不交錯 ＋ 年級連續
      outer: for (const to of teacherOrders) {
        const gradeOrders = to.map(tid => {
          const byG = new Map<number, EngineLesson[]>()
          for (const l of byTeacher.get(tid)!) (byG.get(l.grade) ?? byG.set(l.grade, []).get(l.grade)!).push(l)
          return perms(Array.from(byG.keys())).map(gs => gs.map(g => byG.get(g)!))
        })
        // 各老師年級排列的笛卡兒積（上限 24 種，避免爆炸）
        let combos: EngineLesson[][][] = [[]]
        for (const go of gradeOrders) combos = combos.flatMap(c => go.map(gs => [...c, ...gs])).slice(0, 24)
        for (const groups of combos) { if (Date.now() - roomT0 > 600) break outer; if (trySequence(groups, 3000)) { done = true; break outer } }
      }
      if (!done) {
        // 第二層：老師不交錯，年級可混
        for (const to of teacherOrders) { if (Date.now() - roomT0 > 2500) break; if (trySequence(to.map(tid => byTeacher.get(tid)!), 20000, 400)) { done = true; this.notes.push(`${label}：年級連續排不進，已放寬為只要求老師不交錯`); break } }
      }
      if (!done) { for (const u of preUndo.reverse()) u(); this.notes.push(`${label}：老師不交錯也排不進，這間改為一般排法（回頭仍是硬限制）`); continue }
      // 定案的課設為錨定（不被非錨定課逐出）。不完全凍結：完全凍結實測會讓五個種子都剩 1～4 堂排不完、保底又救不回，
      // 最後整份課表退回沒有結構的純可行解；錨定＋「老師集中」高權重＋認領日偏好已足以讓結構大致保留，真的擠不下才讓步（自動降級）
      for (const l of this.input.lessons) if (this.st.pos.has(l.id) && (this.st.mgrRooms.get(l.id) ?? [])[0]?.id === room.id) this.anchored.add(l.id)
    }
    this.curGroups = null
  }
  private roomTeacherRank = new Map<string, number>()   // `${rid}|${tid}` → 先分天的老師順序（0＝從週一開始認領）
  private roomDayQuota = new Map<string, number>()      // `${lessonId}|${day}` → 這位老師在這間教室這天分到幾組（連堂＝1、單節＝0.5）
  private curGroups: EngineLesson[][] | null = null
  private pairTight = new Set<string>()   // 連堂配對容量緊的老師（見建構子）：不能把難排的班再丟給她
  /** 可與 l 對調的課：同科同年級同型態、也是自動配班、屬於別位老師、兩班這科的課都還沒排也沒凍結、兩班課的形狀相同 */
  private swapPartners(l: EngineLesson): EngineLesson[] {
    const grp = (x: EngineLesson) => this.input.lessons.filter(y => y.classKey === x.classKey && y.subject === x.subject)
    const shape = (ls: EngineLesson[]) => ls.map(y => `${y.size}${y.parity}`).sort().join(',')
    const mine = grp(l)
    if (mine.some(y => this.st.pos.has(y.id) || this.frozen.has(y.id))) return []
    const myShape = shape(mine)
    const seen = new Set<string>()
    const out: EngineLesson[] = []
    for (const y of this.input.lessons) {
      if (y.subject !== l.subject || y.grade !== l.grade || y.size !== l.size || y.parity !== l.parity) continue
      if (y.teacherId === l.teacherId || !y.autoAssigned || y.classKey === l.classKey || seen.has(y.classKey)) continue
      if (this.pairTight.has(y.teacherId) && !this.pairTight.has(l.teacherId)) continue   // 對方已經很緊（教室滿載）→ 不把難排的班丟過去
      seen.add(y.classKey)
      const theirs = grp(y)
      if (theirs.some(z => this.st.pos.has(z.id) || this.frozen.has(z.id))) continue
      if (shape(theirs) !== myShape) continue
      out.push(y)
    }
    return out.sort(() => this.rnd() - 0.5)
  }
  /** 對調兩班這科的授課老師（整班這科的所有課一起換），並把目前序列組裡的 l 換成 partner。回傳復原函式。 */
  private swapAssignment(l: EngineLesson, partner: EngineLesson): (() => void) | null {
    const grp = (x: EngineLesson) => this.input.lessons.filter(y => y.classKey === x.classKey && y.subject === x.subject)
    const A = { id: l.teacherId, name: l.teacherName }, B = { id: partner.teacherId, name: partner.teacherName }
    const mine = grp(l), theirs = grp(partner)
    for (const y of mine) this.st.rebindTeacher(y, B.id, B.name)
    for (const y of theirs) this.st.rebindTeacher(y, A.id, A.name)
    // 序列組：把 l 換成 partner（同型態）
    const swaps: { g: EngineLesson[]; i: number; was: EngineLesson }[] = []
    if (this.curGroups) for (const g of this.curGroups) {
      const i = g.indexOf(l), j = g.indexOf(partner)
      if (i >= 0) { g[i] = partner; swaps.push({ g, i, was: l }) }
      if (j >= 0) { g[j] = l; swaps.push({ g, i: j, was: partner }) }   // partner 的老師若也是這間教室的管理者（後面的組），她的組換成 l
    }
    this.notes.push(`自動配班對調：${l.classLabel} ${l.subject} ${A.name}→${B.name}、${partner.classLabel} ${partner.subject} ${B.name}→${A.name}`)
    const noteIdx = this.notes.length - 1
    return () => {
      for (const y of mine) this.st.rebindTeacher(y, A.id, A.name)
      for (const y of theirs) this.st.rebindTeacher(y, B.id, B.name)
      for (const sw of swaps) sw.g[sw.i] = sw.was
      this.notes.splice(noteIdx, 1)
    }
  }

  /** 專科教室老師集中定向修補（權重）：挑一間交接次數超過（老師數 − 1）的教室，找出「不在自己主要連段裡」的那一小段課，
   *  搬到能讓這間教室一週交接次數變少的格子（接在自己的日子旁邊）。只處理有管理教室者（教室確定）。 */
  private tryFixRoomHalf() {
    if (this.input.weights.builtin.roomHalfDay === 'off') return
    // 每間教室：時間軸上的連段（跨天），每段的課
    const byRoom = new Map<string, Map<string, EngineLesson>>()   // rid → `${d}-${q}` → lesson
    this.st.pos.forEach((p, id) => {
      const rid = this.st.roomOf.get(id); if (!rid) return
      const l = this.st.lessonById.get(id)!
      const m = byRoom.get(rid) ?? byRoom.set(rid, new Map()).get(rid)!
      for (const s of this.st.slotsOf(l, p)) m.set(s, l)
    })
    const bad: { rid: string; ls: EngineLesson[] }[] = []
    byRoom.forEach((m, rid) => {
      const runs: { tid: string; ls: EngineLesson[] }[] = []
      for (const d of SCHEDULE_DAYS) for (let q = 1; q <= 7; q++) {
        const l = m.get(`${d}-${q}`); if (!l) continue
        const last = runs[runs.length - 1]
        if (last && last.tid === l.teacherId) { if (!last.ls.includes(l)) last.ls.push(l) } else runs.push({ tid: l.teacherId, ls: [l] })
      }
      const byT = new Map<string, typeof runs>()
      for (const r of runs) (byT.get(r.tid) ?? byT.set(r.tid, []).get(r.tid)!).push(r)
      byT.forEach(rs => {
        if (rs.length < 2) return
        // 除了最大那段，其餘每段都是「多餘交接」的來源；小段優先
        const sorted = rs.slice().sort((a, b) => a.ls.length - b.ls.length)
        for (const r of sorted.slice(0, -1)) {
          const ls = r.ls.filter(l => (this.st.mgrRooms.get(l.id) ?? []).length === 1)
          if (ls.length) bad.push({ rid, ls })
        }
      })
    })
    if (!bad.length) return
    const b = bad[Math.floor(this.rnd() * bad.length)]
    const l = b.ls[Math.floor(this.rnd() * b.ls.length)]
    const from = this.st.pos.get(l.id)!
    // 現況交接數（把 l 拿掉後的基準）＝ roomTransitions 不含 l
    this.st.remove(l)
    const base = this.st.roomTransitions(b.rid)
    const okAt = (p: Placement) => this.st.roomTransitions(b.rid, l, p) - base < this.st.roomTransitions(b.rid, l, from) - base
    this.st.place(l, from)
    this.directedMove(l, p => okAt(p))
  }

  /** 導師連上定向修補（硬限制）：找出班級同日連續留白超過上限的段，把該班某堂課搬進段中把它切成兩截。
   *  與必排格補洞同套路（直接搬 → 逐出式），差別只在目標格由「必排格」換成「切點」。
   *  沒有這一步時，「同科不隔天」等權重會把科任課全推去一三五，讓某些班的週二整天沒有科任課可切。 */
  private tryFixHomeroomRun() {
    if (!this.hrBands.size || this.input.weights.builtin.homeroomRun === 'off') return
    const n = this.hrRunN
    const targets: { classKey: string; day: number; period: number }[] = []
    for (const c of this.input.classes) {
      if (!this.hrBands.has(bandOf(c.grade))) continue
      const occ = this.st.classOcc.get(c.classKey)!
      const avail = new Set(this.input.classSlots[c.classKey] ?? [])
      const locks = this.input.lockedCells[c.classKey] ?? {}
      const hrLock = new Set(this.input.homeroomLocks[c.classKey] ?? [])
      const mustLeave = this.input.classMustLeave?.[c.classKey] ?? []
      for (const d of SCHEDULE_DAYS) {
        let start = -1, run = 0
        for (let q = 1; q <= 8; q++) {
          const k = `${d}-${q}`
          const teachable = q <= 7 && (avail.has(k) || k in locks)
          const blank = teachable && !occ.has(k) && (!(k in locks) || hrLock.has(k))
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
    this.coverTarget(targets[Math.floor(this.rnd() * targets.length)])
  }

  /** 上午導師課上限定向修補：上午導師超過上限的班日，挑一格上午留白（優先連段中間）把該班一堂科任課放進去。 */
  private tryFixHomeroomMorningMax() {
    const mm = this.input.weights.builtin.homeroomMorningMax
    if (mm.level === 'off') return
    const targets: { classKey: string; day: number; period: number }[] = []
    for (const c of this.input.classes) {
      const occ = this.st.classOcc.get(c.classKey)!
      const avail = new Set(this.input.classSlots[c.classKey] ?? [])
      const locks = this.input.lockedCells[c.classKey] ?? {}
      const hrLock = new Set(this.input.homeroomLocks[c.classKey] ?? [])
      const mustLeave = this.input.classMustLeave?.[c.classKey] ?? []
      for (const d of SCHEDULE_DAYS) {
        const lockAm = [1, 2, 3, 4].filter(q => hrLock.has(`${d}-${q}`)).length
        const allowed = Math.max(mm.n, lockAm)
        // 與計分同口徑：取較少的一週（科任週）——視藝導師週多出的兩節不算
        let worstAm = 99; let blanks: number[] = []
        for (const par of ['o', 'e'] as const) {
          let am = 0; const bl: number[] = []
          for (const q of [1, 2, 3, 4]) {
            const k = `${d}-${q}`
            const teachable = avail.has(k) || (k in locks)
            if (!teachable) continue
            if (k in locks) { if (hrLock.has(k)) am++; continue }
            const id = occ.get(k)
            if (!id) { am++; if (!mustLeave.includes(k)) bl.push(q); continue }
            const p = this.st.lessonById.get(id)?.parity ?? 'weekly'
            if (p !== 'weekly' && p[0] !== par) am++
          }
          if (am < worstAm) { worstAm = am; blanks = bl }
        }
        if (worstAm > allowed && blanks.length) {
          // 優先挑夾在中間的留白（把連段切開），否則隨便一格
          const mid = blanks.filter(q => q > 1 && q < 4)
          const pick = (mid.length ? mid : blanks)[Math.floor(this.rnd() * (mid.length ? mid : blanks).length)]
          targets.push({ classKey: c.classKey, day: d, period: pick })
        }
      }
    }
    if (!targets.length) return
    this.coverTarget(targets[Math.floor(this.rnd() * targets.length)])
  }

  /** 導師每日絕對上限定向修補：導師一天超過 hardN 的班日（低年級週二 6 節最常見），挑一格當天留白把該班一堂科任課放進去。 */
  private tryFixHomeroomDailyMax() {
    const hm = this.input.weights.builtin.homeroomDailyMax
    const hardOf = (g: number, d: number, ck: string) => bandOf(g) === 'low' && this.input.classDayFull[ck]?.[d] ? Math.max(hm.hardN, hm.hardFullDayLowN) : hm.hardN
    const targets: { classKey: string; day: number; period: number }[] = []
    for (const c of this.input.classes) {
      const occ = this.st.classOcc.get(c.classKey)!
      const avail = new Set(this.input.classSlots[c.classKey] ?? [])
      const locks = this.input.lockedCells[c.classKey] ?? {}
      const hrLock = new Set(this.input.homeroomLocks[c.classKey] ?? [])
      const mustLeave = this.input.classMustLeave?.[c.classKey] ?? []
      for (const d of SCHEDULE_DAYS) {
        let worst = 0; let blanks: number[] = []
        for (const par of ['o', 'e'] as const) {
          let n = 0; const bl: number[] = []
          for (let q = 1; q <= 7; q++) {
            const k = `${d}-${q}`
            const teachable = avail.has(k) || (k in locks)
            if (!teachable) continue
            if (k in locks) { if (hrLock.has(k)) n++; continue }
            const id = occ.get(k)
            if (!id) { n++; if (!mustLeave.includes(k)) bl.push(q); continue }
            const p = this.st.lessonById.get(id)?.parity ?? 'weekly'
            if (p !== 'weekly' && p[0] !== par) n++
          }
          if (n > worst) { worst = n; blanks = bl }
        }
        if (worst > hardOf(c.grade, d, c.classKey) && blanks.length) targets.push({ classKey: c.classKey, day: d, period: blanks[Math.floor(this.rnd() * blanks.length)] })
      }
    }
    if (!targets.length) return
    this.coverTarget(targets[Math.floor(this.rnd() * targets.length)])
  }

  /** 半天日整個半天都是導師課（必須級）定向修補：這種半天多半是「單雙週區塊 1-2＋種子班鎖課 3-4」，
   *  半天內一格空的都沒有，塞不進科任課——只能把那組單雙週區塊整組搬到整天日。 */
  private tryFixHalfDayAllHomeroom() {
    const mm = this.input.weights.builtin.homeroomMorningMax
    if (mm.level === 'off') return
    const moveTargets: EngineLesson[] = []                                   // 半天裡的單雙週區塊：搬去整天日
    const coverTargets: { classKey: string; day: number; period: number }[] = []   // 半天裡有真空格：塞一堂科任課進去
    for (const c of this.input.classes) {
      for (const d of SCHEDULE_DAYS) {
        if (this.input.classDayFull[c.classKey]?.[d]) continue
        const occ = this.st.classOcc.get(c.classKey)!
        const avail = new Set(this.input.classSlots[c.classKey] ?? [])
        const locks = this.input.lockedCells[c.classKey] ?? {}
        const hrLock = new Set(this.input.homeroomLocks[c.classKey] ?? [])
        const mustLeave = this.input.classMustLeave?.[c.classKey] ?? []
        const qs = [1, 2, 3, 4].filter(q => avail.has(`${d}-${q}`) || (`${d}-${q}` in locks))
        if (qs.length < 3) continue
        let allHr = false
        const blanks: number[] = []
        for (const par of ['o', 'e'] as const) {
          let n = 0
          for (const q of qs) {
            const k = `${d}-${q}`
            if (k in locks) { if (hrLock.has(k)) n++; continue }
            const id = occ.get(k)
            if (!id) { n++; if (par === 'o' && !mustLeave.includes(k)) blanks.push(q); continue }
            const p = this.st.lessonById.get(id)?.parity ?? 'weekly'
            if (p !== 'weekly' && p[0] !== par) n++
          }
          if (n === qs.length) allHr = true
        }
        if (!allHr) continue
        let bi: EngineLesson | null = null
        for (const q of qs) {
          const id = occ.get(`${d}-${q}`); if (!id) continue
          const l = this.st.lessonById.get(id)
          if (l && l.parity !== 'weekly' && !this.frozen.has(l.id)) { bi = l; break }
        }
        if (bi) moveTargets.push(bi)
        else if (blanks.length) coverTargets.push({ classKey: c.classKey, day: d, period: blanks[Math.floor(this.rnd() * blanks.length)] })
      }
    }
    if (moveTargets.length && (!coverTargets.length || this.rnd() < 0.6)) {
      const l = moveTargets[Math.floor(this.rnd() * moveTargets.length)]
      const wantFull = (p: Placement) => Boolean(this.input.classDayFull[l.classKey]?.[p.day])
      if (this.directedMove(l, wantFull)) return
      this.relocateWithEject(l, wantFull)
      return
    }
    if (coverTargets.length) this.coverTarget(coverTargets[Math.floor(this.rnd() * coverTargets.length)])
  }

  /** 把 t 班的某一堂科任課放進 (t.day, t.period)：先直接搬，搬不動再逐出式。導師連上／上午上限的修補共用。 */
  private coverTarget(t: { classKey: string; day: number; period: number }) {
    const mustSet = this.mustSetByClass.get(t.classKey) ?? new Set<string>()
    const lessons = (this.lessonsByClass.get(t.classKey) ?? [])
    if (!lessons.length) return
    const off = Math.floor(this.rnd() * lessons.length)
    for (let j = 0; j < lessons.length; j++) {
      const l = lessons[(off + j) % lessons.length]
      if (this.frozen.has(l.id)) continue
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

  /** 導師每日下限定向修補：找出「整天導師不足 2／半天不足 1」的班日（單雙週取較少的一週），
   *  把該班當天的一堂科任課搬到別天（直接搬或與同班別師同型態課互換）。沒有這一步時，這條必須級只會扣分、
   *  搜尋靠隨機很難剛好把那一天清出導師格（5年10班 週一實測卡住）。 */
  private tryFixHomeroomMin() {
    const hm = this.input.weights.builtin.homeroomDailyMin
    if (hm.level === 'off') return
    const targets: { classKey: string; day: number }[] = []
    for (const c of this.input.classes) {
      const occ = this.st.classOcc.get(c.classKey)!
      const avail = new Set(this.input.classSlots[c.classKey] ?? [])
      const locks = this.input.lockedCells[c.classKey] ?? {}
      const hrLock = new Set(this.input.homeroomLocks[c.classKey] ?? [])
      const mustFill = new Set(this.input.classMustFill[c.classKey] ?? [])
      for (const d of SCHEDULE_DAYS) {
        let possible = 0
        const hrBy = { o: 0, e: 0 }
        for (let q = 1; q <= 7; q++) {
          const k = `${d}-${q}`
          const teachable = avail.has(k) || (k in locks)
          if (!teachable) continue
          if (k in locks) { if (hrLock.has(k)) { possible++; hrBy.o++; hrBy.e++ } continue }
          if (!mustFill.has(k)) possible++
          const id = occ.get(k)
          if (!id) { hrBy.o++; hrBy.e++; continue }
          const p = this.st.lessonById.get(id)?.parity ?? 'weekly'
          if (p === 'odd') hrBy.e++; else if (p === 'even') hrBy.o++
        }
        if (!possible) continue
        const full = this.input.classDayFull[c.classKey]?.[d]
        const need = Math.min(full ? hm.full : hm.half, possible)
        if (Math.min(hrBy.o, hrBy.e) < need) targets.push({ classKey: c.classKey, day: d })
      }
    }
    if (!targets.length) return
    const t = targets[Math.floor(this.rnd() * targets.length)]
    const lessons = (this.lessonsByClass.get(t.classKey) ?? []).filter(l => { const p = this.st.pos.get(l.id); return p && p.day === t.day && !this.frozen.has(l.id) })
    if (!lessons.length) return
    const off = Math.floor(this.rnd() * lessons.length)
    for (let j = 0; j < lessons.length; j++) {
      const l = lessons[(off + j) % lessons.length]
      if (this.directedMove(l, p => p.day !== t.day)) return
    }
    // 直接搬都失敗（常見：連堂在別天找不到班空＋師空＋教室空的位置）→ 逐出式搬家
    for (let j = 0; j < lessons.length; j++) {
      const l = lessons[(off + j) % lessons.length]
      if (this.relocateWithEject(l, p => p.day !== t.day)) return
    }
  }

  /** 導師連堂位定向修補（必須級）：導師自上有連堂科目的班，科任課把留白切到連一組「同半天連續兩格」都不剩時，
   *  找一堂「旁邊就是一格留白」的科任課搬去別的半天——搬走後那兩格就連成一組。 */
  private tryFixHomeroomDouble() {
    const targets: { classKey: string; lessons: EngineLesson[]; day: number; half: number[] }[] = []
    for (const c of this.input.classes) {
      const need = this.input.homeroomDoubleNeed?.[c.classKey]
      if (!need?.pairs) continue
      const occ = this.st.classOcc.get(c.classKey)!
      const blank = new Set((this.input.classSlots[c.classKey] ?? []).filter(sl => !occ.has(sl)))
      let pairs = 0
      const singles: { day: number; half: number[]; q: number }[] = []   // 孤零零一格留白（旁邊搬走一堂就成對）
      for (const d of SCHEDULE_DAYS) for (const half of [[1, 2, 3, 4], [5, 6, 7]]) {
        let run = 0, start = 0
        for (const q of [...half, 0]) {
          if (q && blank.has(`${d}-${q}`)) { if (!run) start = q; run++ }
          else { pairs += Math.floor(run / 2); if (run === 1) singles.push({ day: d, half, q: start }); run = 0 }
        }
      }
      if (pairs >= need.pairs) continue
      for (const sg of singles) {
        const nb = [sg.q - 1, sg.q + 1].filter(q => sg.half.includes(q))
        const ls = nb.map(q => occ.get(`${sg.day}-${q}`)).filter((id): id is string => Boolean(id)).map(id => this.st.lessonById.get(id)!).filter(l => !this.frozen.has(l.id))
        if (ls.length) targets.push({ classKey: c.classKey, lessons: ls, day: sg.day, half: sg.half })
      }
      if (!singles.length) {   // 連孤格都沒有（整半天塞滿）：隨便挑那班一堂課搬走也行
        const any = (this.lessonsByClass.get(c.classKey) ?? []).filter(l => this.st.pos.has(l.id) && !this.frozen.has(l.id))
        if (any.length) targets.push({ classKey: c.classKey, lessons: any, day: 0, half: [] })
      }
    }
    if (!targets.length) return
    const t = targets[Math.floor(this.rnd() * targets.length)]
    const off = Math.floor(this.rnd() * t.lessons.length)
    for (let j = 0; j < t.lessons.length; j++) {
      const l = t.lessons[(off + j) % t.lessons.length]
      if (this.directedMove(l, p => !(p.day === t.day && t.half.includes(p.period)))) return
    }
    for (let j = 0; j < t.lessons.length; j++) {
      const l = t.lessons[(off + j) % t.lessons.length]
      if (this.relocateWithEject(l, p => !(p.day === t.day && t.half.includes(p.period)))) return
    }
  }

  /** 鐘點天數定向修補（必須級）：鐘點老師到校天數超過目標時，把課最少那一天的課搬到她已經有課的日子。 */
  private tryFixHourlyDays() {
    const cfg = this.input.weights.builtin.hourlyBalance
    if (cfg.mode !== 'concentrate' || cfg.level === 'off') return
    for (const tid of this.input.hourlyTeachers ?? []) {
      const mine = this.input.lessons.filter(l => l.teacherId === tid && this.st.pos.has(l.id) && !this.frozen.has(l.id))
      const byDay = new Map<number, EngineLesson[]>()
      for (const l of mine) { const d = this.st.pos.get(l.id)!.day; byDay.set(d, [...(byDay.get(d) ?? []), l]) }
      if (byDay.size <= Math.max(1, cfg.days)) continue
      const days = [...byDay.entries()].sort((a, b) => a[1].length - b[1].length)
      const [dMin, ls] = days[0]
      const keep = new Set(days.slice(1).map(([d]) => d))
      for (const l of ls) { if (this.directedMove(l, p => keep.has(p.day))) return }
      for (const l of ls) { if (this.relocateWithEject(l, p => keep.has(p.day))) return }
    }
  }

  /** 教室阻擋者：l 需要專科教室、而 slots 上它能用的教室都被別堂課占住時，挑占用最少的一間，回傳那些占用課的 id（要被逐出去換位子）。
   *  已有教室可用回 null（不需要逐出）；每間都有管理者的課／不排課占住 → 回 undefined（逐出不了）。
   *  自然／科技教室連堂位 42／42 全用滿：最後一堂連堂排不進去時，擋路的不是老師也不是班級，是教室——逐出鏈要看得到它才接得上。 */
  private roomBlockersFor(l: EngineLesson, slots: string[], depth: number): Set<string> | null | undefined {
    const pool = this.st.roomPool.get(l.id)
    if (!pool || !pool.length) return null
    let best: Set<string> | undefined
    for (const r of pool) {
      const occ = this.st.roomOcc.get(r.id); if (!occ) continue
      const ids = new Set<string>(); let bad = false
      for (const sl of slots) {
        const cell = occ.get(sl); if (!cell) continue
        for (const id of [cell.w, l.parity !== 'even' ? cell.o : undefined, l.parity !== 'odd' ? cell.e : undefined]) {
          if (!id || id === l.id) continue
          if (id === ROOM_OFF || isMgrLesson(this.st, id, r.id)) { bad = true; break }
          ids.add(id)
        }
        if (bad) break
      }
      if (bad) continue
      if (ids.size === 0) return null   // 這間就空著
      if (ids.size <= depth && (!best || ids.size < best.size)) best = ids
    }
    return best
  }

  /** 逐出式搬家：把已排的 l 搬到符合 want 的某格；格子被占（老師衝堂／班級格有別堂課）就把擋路的 1～depth 堂先搬走再放。
   *  直接搬找不到位子時的第二招——5年10班 週一那種「視藝連堂要整組搬走、但別天都沒有班空＋師空＋教室空的位置」就要靠它。 */
  private relocateWithEject(l: EngineLesson, want: (p: Placement) => boolean, depth = 3): boolean {
    const from = this.st.pos.get(l.id)
    if (!from || this.frozen.has(l.id)) return false
    const avail = this.input.classSlots[l.classKey] ?? []
    const cOcc = this.st.classOcc.get(l.classKey)!
    const blockedT = this.input.teacherBlocked[l.teacherId] ?? []
    const mustLeave = this.input.classMustLeave?.[l.classKey] ?? []
    const fromSlots = this.st.slotsOf(l, from)
    this.st.remove(l)
    const start = Math.floor(this.rnd() * Math.max(1, avail.length))
    for (let k = 0; k < avail.length; k++) {
      const p = parseSlotKey(avail[(start + k) % avail.length])
      if (!want(p) || (p.day === from.day && p.period === from.period)) continue
      if (l.size === 2 && p.period >= 7) continue
      if (l.parity !== 'weekly' && ![1, 3, 5].includes(p.period)) continue
      const slots = this.st.slotsOf(l, p)
      if (!slots.every(x => avail.includes(x) && !blockedT.includes(x) && !mustLeave.includes(x))) continue
      const tOcc = this.st.teacherOcc.get(l.teacherId)!
      const blockers = new Set<string>()
      for (const x of slots) {
        const cell = tOcc.get(x)
        if (cell) for (const id of [cell.w, l.parity !== 'even' ? cell.o : undefined, l.parity !== 'odd' ? cell.e : undefined]) if (id && id !== l.id) blockers.add(id)
        const occId = cOcc.get(x); if (occId && occId !== l.id) blockers.add(occId)
      }
      if (blockers.size > depth) continue
      const rb = this.roomBlockersFor(l, slots, depth - blockers.size)
      if (rb === undefined) continue
      if (rb) for (const id of rb) blockers.add(id)
      if (blockers.size > depth) continue
      if (!this.anchored.has(l.id) && Array.from(blockers).some(id => this.anchored.has(id))) continue
      const moved: { bl: EngineLesson; from: Placement }[] = []
      let fail = false
      for (const bid of Array.from(blockers)) {
        const bl = this.st.lessonById.get(bid)!, bfrom = this.st.pos.get(bid)
        if (!bfrom || this.frozen.has(bid)) { fail = true; break }
        const bMust = this.mustSetByClass.get(bl.classKey)
        if (bMust && this.st.slotsOf(bl, bfrom).some(x => bMust.has(x))) { fail = true; break }
        this.st.remove(bl); moved.push({ bl, from: bfrom })
        // 擋路的課可以搬去 l 剛空出來的格（同班才有意義）或任何別的合法格，但不能又占住 l 的目標格
        const cands = this.st.candidates(bl).filter(pp => !this.st.slotsOf(bl, pp).some(x => slots.includes(x)))
        if (!cands.length) { fail = true; break }
        this.st.place(bl, cands[Math.floor(this.rnd() * cands.length)])
      }
      if (!fail && this.st.canPlace(l, p)) {
        this.st.place(l, p)
        const sc = scoreState(this.st)
        if (this.accept(sc)) { this.take(sc); return true }
        this.st.remove(l)
      }
      for (const m of moved.reverse()) { if (this.st.pos.has(m.bl.id)) this.st.remove(m.bl); this.st.place(m.bl, m.from) }
    }
    this.st.place(l, from)
    void fromSlots
    return false
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
        if (this.frozen.has(l.id)) continue
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
    let rescoreBudget = 40   // 這一輪最多重新計分幾次（挑逐出者的新位子用）
    for (let j = 0; j < lessons.length; j++) {
      const l = lessons[(off + j) % lessons.length]
      if (this.frozen.has(l.id)) continue
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
        // 教室阻擋者：目標格的專科教室被別班占住（必排格要放專科連堂時常見）
        if (blockers.size <= depth) {
          const rb = this.roomBlockersFor(l, slots, depth - blockers.size)
          if (rb === undefined) { if (oldP) this.st.place(l, oldP); continue }
          if (rb) for (const id of rb) blockers.add(id)
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
          if (!from || this.frozen.has(bid)) { fail = true; break }
          const bMust = this.mustSetByClass.get(bl.classKey)
          if (bMust && this.st.slotsOf(bl, from).some(s => bMust.has(s))) { fail = true; break }
          this.st.remove(bl)
          moved.push({ bl, from })
          const cands = this.st.candidates(bl).filter(pp => {
            const ss = bl.size === 2 ? [`${pp.day}-${pp.period}`, `${pp.day}-${pp.period + 1}`] : [`${pp.day}-${pp.period}`]
            return !ss.some(s => slots.includes(s))
          })
          if (!cands.length) { fail = true; break }
          // 挑最不傷分的落點，不要只賭一個隨機格：這一步賭輸整條鏈就白做了。
          // 重新計分很貴（整份重算），所以只試少數幾格、而且整輪有次數上限
          let bp = cands[Math.floor(this.rnd() * cands.length)]
          if (rescoreBudget > 0 && cands.length > 1) {
            let bs = Infinity
            const off2 = Math.floor(this.rnd() * cands.length)
            for (let z = 0; z < Math.min(cands.length, 4) && rescoreBudget > 0; z++, rescoreBudget--) {
              const pp = cands[(off2 + z) % cands.length]
              this.st.place(bl, pp)
              const sc2 = scoreState(this.st).total
              this.st.remove(bl)
              if (sc2 < bs) { bs = sc2; bp = pp }
            }
          }
          this.st.place(bl, bp)
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
      // 還有必須級沒清乾淨時，定向修補要比隨機搬動勤快得多：必須級是「留白形狀」類的條件（連堂位、每日下限、鐘點天數），
      // 隨機搬一堂課很難剛好把形狀修對，輪流叫各條修補器直接對準目標
      // 節奏：只拿 1/8 的步數（奇數步之一，避開下面 %8 的偶數分支）——上一版拿走全部奇數步，隨機搬動與交換完全沒機會跑，
      // 反而讓未排從 0 暴增到 8～15 堂
      if (this.cur >= MUST && this.iterations % 8 === 1) {
        const k = Math.floor(this.iterations / 8) % 8
        if (k === 0) this.tryCoverMustFill()
        else if (k === 1) this.tryFixHomeroomMin()
        else if (k === 2) this.tryFixHomeroomDouble()
        else if (k === 3) this.tryFixHourlyDays()
        else if (k === 4) this.tryFixHomeroomMorningMax()
        else if (k === 5) this.tryFixHomeroomDailyMax()
        else if (k === 6) this.tryFixHalfDayAllHomeroom()
        else this.tryFixHomeroomRun()
        continue
      }
      // 還有課沒排進去時，把「安插未排課」的力氣加重：原本只有 %8===4（逐出）與 %16===11（逐出鏈）約 1/5 的步數，
      // 前端實測會看到迭代一直跑、已排卻停在 636/638——最後那一兩堂要連鎖搬好幾堂才騰得出位子，機會太少就一直卡著
      if (this.st.pos.size < this.input.lessons.length && this.iterations % 4 === 1) {
        if (Math.floor(this.iterations / 4) % 2 === 0) this.tryPlaceUnplacedWithEject()
        else this.tryEjectionChain()
        continue
      }
      if (this.iterations % 8 === 0) { this.tryCoverMustFill(); continue }
      if (this.iterations % 8 === 6) { this.tryFixCohesion(); continue }
      if (this.iterations % 8 === 2) { this.tryFixHomeroomRun(); continue }
      if (this.iterations % 8 === 4) { this.tryPlaceUnplacedWithEject(); continue }
      if (this.iterations % 64 === 13 && this.st.pos.size < this.input.lessons.length) { this.tryResolveTeacher(); continue }   // 13 % 8 = 5：不被上面 %8 的分支攔走
      if (this.iterations % 16 === 7) { this.tryFixTeacherApart(); continue }   // 7 % 8 = 7
      if (this.iterations % 16 === 15) { this.tryFixBandAdjacent(); continue }
      if (this.iterations % 16 === 11 && this.st.pos.size < this.input.lessons.length) { this.tryEjectionChain(); continue }   // 11 % 8 = 3
      if (this.iterations % 16 === 3) { this.tryFixRoomHalf(); continue }
      if (this.rnd() < 0.3) { this.trySwap(); continue }
      const l = allLessons[Math.floor(this.rnd() * allLessons.length)]
      if (this.frozen.has(l.id)) continue
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
    const placedIds = Array.from(this.st.pos.keys()).filter(id => !this.frozen.has(id))
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
  /** 未排課的老師整批重解：把該老師所有的課拿起來，回溯法一次重新落位（同建構期錨定老師的做法）。
   *  針對「班級還有格、但都被老師自己的其他課擋住」——單堂搬動挪不出相鄰兩格，整批重排才有機會。
   *  全部放得下且（未排＋必須級）不變差才採用，否則原樣放回。 */
  private tryResolveTeacher() {
    const unplaced = this.input.lessons.filter(l => !this.st.pos.has(l.id))
    if (!unplaced.length) return
    const l0 = unplaced[Math.floor(this.rnd() * unplaced.length)]
    const ls = this.input.lessons.filter(l => l.teacherId === l0.teacherId && !this.frozen.has(l.id))
    const before = new Map<string, Placement>()
    for (const l of ls) { const p = this.st.pos.get(l.id); if (p) before.set(l.id, p) }
    for (const l of ls) this.st.remove(l)
    const order = [...ls].sort((a, b) => (b.size - a.size) || (this.rnd() - 0.5))
    let nodes = 0
    const dfs = (i: number): boolean => {
      if (i >= order.length) return true
      if (++nodes > 30000) return false
      const l = order[i]
      const cands = this.st.candidates(l)
      for (let k = cands.length - 1; k > 0; k--) { const j = Math.floor(this.rnd() * (k + 1)); [cands[k], cands[j]] = [cands[j], cands[k]] }
      for (const p of cands) {
        this.st.place(l, p)
        if (dfs(i + 1)) return true
        this.st.remove(l)
      }
      return false
    }
    if (dfs(0)) {
      const sc = scoreState(this.st)
      if (this.accept(sc)) { this.take(sc); return }
    }
    // 失敗或變差 → 原樣放回
    for (const l of order) if (this.st.pos.has(l.id)) this.st.remove(l)
    before.forEach((p, id) => this.st.place(this.st.lessonById.get(id)!, p))
    const sc = scoreState(this.st); this.cur = sc.total; this.curSoft = sc.soft
  }

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
      if (blockers.size > this.ejectDepth()) continue
      {
        const rb = this.roomBlockersFor(l, slots, this.ejectDepth() - blockers.size)
        if (rb === undefined) continue
        if (rb) for (const id of rb) blockers.add(id)
      }
      if (blockers.size === 0 || blockers.size > this.ejectDepth()) continue
      if (!this.anchored.has(l.id) && Array.from(blockers).some(id => this.anchored.has(id))) continue   // 錨定課不被非錨定課逐出
      const moved: { bl: EngineLesson; from: Placement }[] = []
      let fail = false
      for (const bid of Array.from(blockers)) {
        const bl = this.st.lessonById.get(bid)!
        const from = this.st.pos.get(bid)
        if (!from || this.frozen.has(bid)) { fail = true; break }
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

  /** 逐出鏈（未排課專用）：把未排課硬放進某格，被擠出去的課再找位子，找不到就再擠別人，最多 depth 層。
   *  單層逐出（上面）只能處理「搬走一堂就有位子」；剩最後一兩堂時，班級空格全被同一位老師的別班課占住、
   *  而那些課的班級又沒空格——要連鎖搬三四堂才騰得出位，這正是人工排課「最後幾節喬來喬去」在做的事。 */
  private tryEjectionChain() {
    const unplaced = this.input.lessons.filter(l => !this.st.pos.has(l.id))
    if (!unplaced.length) return
    const l = unplaced[Math.floor(this.rnd() * unplaced.length)]
    const journal: { l: EngineLesson; from: Placement | null }[] = []
    const undoTo = (mark: number) => {
      for (let i = journal.length - 1; i >= mark; i--) {
        const j = journal[i]
        if (this.st.pos.has(j.l.id)) this.st.remove(j.l)
        if (j.from) this.st.place(j.l, j.from)
      }
      journal.length = mark
    }
    let nodes = 0
    const forceIn = (x: EngineLesson, depth: number, tabu: Set<string>): boolean => {
      if (++nodes > 400) return false
      tabu.add(x.id)
      const avail = this.input.classSlots[x.classKey] ?? []
      const blockedT = this.input.teacherBlocked[x.teacherId] ?? []
      const coBlocked = x.coTeacherId ? (this.input.teacherBlocked[x.coTeacherId] ?? []) : []
      const mustLeave = this.input.classMustLeave?.[x.classKey] ?? []
      const cOcc = this.st.classOcc.get(x.classKey)!
      const start = Math.floor(this.rnd() * Math.max(1, avail.length))
      for (let k = 0; k < avail.length; k++) {
        const p = parseSlotKey(avail[(start + k) % avail.length])
        if (x.size === 2 && p.period >= 7) continue
        if (x.parity !== 'weekly' && ![1, 3, 5].includes(p.period)) continue
        const slots = this.st.slotsOf(x, p)
        if (!slots.every(sl => avail.includes(sl) && !blockedT.includes(sl) && !coBlocked.includes(sl) && !mustLeave.includes(sl))) continue
        // 擋路的：本班該格的課、老師（含外師）該格的別班課
        const blockers = new Set<string>()
        for (const sl of slots) {
          const occId = cOcc.get(sl); if (occId && occId !== x.id) blockers.add(occId)
          for (const tid of [x.teacherId, x.coTeacherId]) {
            if (!tid) continue
            const cell = this.st.teacherOcc.get(tid)?.get(sl)
            if (!cell) continue
            for (const id of [cell.w, x.parity !== 'even' ? cell.o : undefined, x.parity !== 'odd' ? cell.e : undefined]) if (id && id !== x.id) blockers.add(id)
          }
        }
        // 教室擋路：要進專科教室的課，把「候選教室」在那兩格的占用者也算擋路（管理者只有自己那間；
        // 沒有管理教室者挑占用最少的一間）。教室不排課（ROOM_OFF）趕不走 → 這格放棄
        const rooms = this.st.mgrRooms.get(x.id) ?? this.st.roomPool.get(x.id) ?? []
        if (rooms.length) {
          let bestIds: string[] | null = null
          for (const r of rooms) {
            const ids: string[] = []
            let off = false
            for (const sl of slots) {
              const cell = this.st.roomOcc.get(r.id)?.get(sl)
              if (!cell) continue
              for (const id of [cell.w, x.parity !== 'even' ? cell.o : undefined, x.parity !== 'odd' ? cell.e : undefined]) {
                if (!id || id === x.id) continue
                if (id === ROOM_OFF) { off = true; break }
                ids.push(id)
              }
              if (off) break
            }
            if (off) continue
            if (!bestIds || ids.length < bestIds.length) bestIds = ids
          }
          if (!bestIds) continue
          for (const id of bestIds) blockers.add(id)
        }
        if (blockers.size > 3) continue
        let skip = false
        for (const bid of Array.from(blockers)) {
          if (tabu.has(bid) || this.frozen.has(bid)) { skip = true; break }
          if (!this.anchored.has(x.id) && this.anchored.has(bid)) { skip = true; break }
          const bl = this.st.lessonById.get(bid)!
          const bMust = this.mustSetByClass.get(bl.classKey)
          const from = this.st.pos.get(bid)
          if (!from || (bMust && this.st.slotsOf(bl, from).some(sl => bMust.has(sl)))) { skip = true; break }
        }
        if (skip) continue
        const mark = journal.length
        for (const bid of Array.from(blockers)) { const bl = this.st.lessonById.get(bid)!; journal.push({ l: bl, from: this.st.pos.get(bid)! }); this.st.remove(bl) }
        if (!this.st.canPlace(x, p)) { undoTo(mark); continue }
        this.st.place(x, p); journal.push({ l: x, from: null })
        let ok = true
        for (const bid of Array.from(blockers)) {
          const bl = this.st.lessonById.get(bid)!
          const cands = this.st.candidates(bl)
          if (cands.length) { this.st.place(bl, cands[Math.floor(this.rnd() * cands.length)]); continue }
          if (depth > 0 && forceIn(bl, depth - 1, tabu)) continue
          ok = false; break
        }
        if (ok) return true
        undoTo(mark)
      }
      return false
    }
    const tabu = new Set<string>()
    if (forceIn(l, 3, tabu)) {
      const sc = scoreState(this.st)
      if (this.accept(sc)) { this.take(sc); return }
    }
    undoTo(0)
  }

  /** 逐出鏈深度：平常最多搬 2 堂；只差 1～2 節（未排／必須級合計 ≤2）時放寬到 4，最後那幾節往往要多搬幾堂才騰得出位。 */
  private ejectDepth() { return this.cur <= 2 * MUST ? 4 : 2 }

  get elapsed() { return Date.now() - this.startTime }
  get sinceImprove() { return Date.now() - this.lastImprove }

  progress(): RunProgress {
    return {
      iter: this.iterations, best: this.bestTotal, softBest: this.bestSoft,
      elapsed: this.elapsed, placed: this.bestPos.size,
      unplaced: this.input.lessons.length - this.bestPos.size + (this.input.unassigned?.length ?? 0),
      sinceImproveMs: this.sinceImprove,
    }
  }

  /** 還原歷來最佳解並產出結果（教室分配、罰分明細、未排原因）。 */
  finalize(): EngineResult {
    return buildResult(this.input, this.bestPos, { iterations: this.iterations, elapsedMs: this.elapsed, notes: this.notes })
  }
}

/** 由落點表組出 EngineResult（教室分配、未排原因、罰分明細）。EngineRun.finalize 與收尾榨乾都用這個。 */
function buildResult(input: EngineInput, posMap: Map<string, Placement>, meta: { iterations: number; elapsedMs: number; notes: string[] }): EngineResult {
  {
    const st = new State(input)
    posMap.forEach((p, id) => { const l = st.lessonById.get(id); if (l) st.place(l, p) })
    const { total, soft, penalties, uncovered } = scoreState(st)

    const placed: PlacedResult[] = []
    const unplaced: UnplacedResult[] = []
    // 衝堂防護：同師／同班同格兩堂（canPlace 擋不到的內部錯誤）→ 後者退為未排，寧可少排一堂也不讓衝堂課表出門
    {
      const seen = new Map<string, string>()
      const victims: { id: string; why: string }[] = []
      const order = Array.from(st.pos.keys()).sort()
      for (const id of order) {
        const l = st.lessonById.get(id)!, p = st.pos.get(id)!
        let hit: string | null = null
        for (let i = 0; i < l.size && !hit; i++) {
          for (const key of [`T|${l.teacherId}|${p.day}-${p.period + i}|${l.parity}`, `C|${l.classKey}|${p.day}-${p.period + i}|${l.parity}`]) {
            const other = seen.get(key); if (other) { hit = other; break }
          }
        }
        if (hit) { victims.push({ id, why: hit }); continue }
        for (let i = 0; i < l.size; i++) { seen.set(`T|${l.teacherId}|${p.day}-${p.period + i}|${l.parity}`, id); seen.set(`C|${l.classKey}|${p.day}-${p.period + i}|${l.parity}`, id) }
      }
      for (const v of victims) {
        const l = st.lessonById.get(v.id)!, o = st.lessonById.get(v.why)!
        console.error('[engine] 衝堂防護：', l.classLabel, l.subject, l.teacherName, '與', o.classLabel, o.subject, '同格，退為未排')
        st.remove(l)
        meta.notes.push(`衝堂防護：${l.classLabel} ${l.subject}（${l.teacherName}）與 ${o.classLabel} ${o.subject} 同一格，已退為未排`)
      }
    }
    // 教室分配（與 scoreState 同邏輯：管理教師優先）
    const roomOf = assignRooms(input, st)
    const sorted: { l: EngineLesson; p: Placement }[] = []
    st.pos.forEach((p, id) => sorted.push({ l: st.lessonById.get(id)!, p }))
    sorted.sort((a, b) => a.l.id < b.l.id ? -1 : 1)
    for (const { l, p } of sorted) {
      placed.push({ ...l, day: p.day, period: p.period, roomId: roomOf.get(l.id) ?? null })
    }
    for (const l of input.lessons) {
      if (st.pos.has(l.id)) continue
      unplaced.push({ lesson: l, reason: unplacedReason(st, l) })
    }
    // 沒有科任可配的需求：不是排不進，是根本沒人上——一樣列為未排，不假報 0
    for (const u of input.unassigned ?? []) {
      unplaced.push({
        lesson: { id: `unassigned|${u.classKey}|${u.subject}`, classKey: u.classKey, grade: u.grade, classLabel: u.classLabel, subject: u.subject,
          teacherId: '', teacherName: '（未指派科任）', size: 1, parity: 'weekly' },
        reason: `該班該科需科任 ${u.hours} 節，但沒有任何科任可配（供給不足，或現有供給湊不出各班節數）——請於配課統計補足供給或於科任配班手動指定`,
      })
    }

    return {
      placed, unplaced,
      penalties: penalties.filter(p => p.key !== 'unplaced'),   // 未排另有清單，不重複列
      totalPenalty: total, softPenalty: soft,
      uncoveredMustFill: uncovered, iterations: meta.iterations, elapsedMs: meta.elapsedMs,
      notes: meta.notes.length ? [...meta.notes] : undefined,
    }
  }
}

/** 收尾榨乾：引擎跑完後，用調課查詢器的鄰域（直接搬／兩角，最後幾輪含三角）一輪輪掃全校、只套「真的變好」的，
 *  直到掃不到為止。引擎的局部搜尋沒把這些鄰域搜乾（實測可再降 15～20%）。硬規則全部照 State.canPlace，不會弄掉課。
 *  分段 await 讓 Worker 能回報進度／接受停止。 */
export async function polishResult(
  input: EngineInput, result: EngineResult,
  opts: { onProgress?: (p: { round: number; withThree: boolean; done: number; total: number; applied: number; soft0: number; soft: number }) => void; shouldStop?: () => boolean; maxMs?: number; maxThreeRounds?: number } = {},
): Promise<EngineResult> {
  if (!result.placed.length) return result
  const t0 = Date.now()
  const maxMs = opts.maxMs ?? 240_000
  const f = new SwapFinder(input, result.placed, {})
  const soft0 = f.soft
  let round = 0, applied = 0, threeRounds = 0
  let withThree = false
  for (;;) {
    if (opts.shouldStop?.() || Date.now() - t0 > maxMs) break
    round++
    const ids = f.snapshot().map(p => p.id)
    const found = new Map<string, SwapOption>()
    let lastYield = Date.now()
    for (let i = 0; i < ids.length; i++) {
      const q = f.query(ids[i], { maxThree: withThree ? 120 : 0, timeMs: withThree ? 250 : 80 })
      for (const o of q.options) {
        if (o.softDelta >= 0) continue
        const key = o.moves.map(m => `${m.id}@${m.day}-${m.period}`).sort().join('|')
        const prev = found.get(key)
        if (!prev || o.moves.length < prev.moves.length) found.set(key, o)
      }
      if (Date.now() - lastYield > 100) {
        opts.onProgress?.({ round, withThree, done: i + 1, total: ids.length, applied, soft0, soft: f.soft })
        await new Promise(r => setTimeout(r, 0))
        lastYield = Date.now()
        if (opts.shouldStop?.() || Date.now() - t0 > maxMs) break
      }
    }
    const list = Array.from(found.values()).sort((a, b) => a.softDelta - b.softDelta || a.moves.length - b.moves.length)
    let n = 0
    for (const o of list) { const r = f.applyIfBetter(o.moves); if (r.applied) n++ }
    applied += n
    opts.onProgress?.({ round, withThree, done: ids.length, total: ids.length, applied, soft0, soft: f.soft })
    if (!withThree) { if (!list.length || !n) withThree = true }
    else { threeRounds++; if (!list.length || !n || threeRounds >= (opts.maxThreeRounds ?? 4)) break }
  }
  if (!applied) return result
  const pos = new Map<string, Placement>()
  for (const p of f.snapshot()) pos.set(p.id, { day: p.day, period: p.period })
  const notes = [...(result.notes ?? []), `收尾榨乾：${round} 輪套用 ${applied} 筆更好的調法，罰分 ${Math.round(soft0)} → ${Math.round(f.soft)}`]
  const out = buildResult(input, pos, { iterations: result.iterations, elapsedMs: result.elapsedMs + (Date.now() - t0), notes })
  return out
}

export interface RunOptions { timeMs: number; onProgress?: (p: RunProgress) => void }

/** 一次跑完（固定時間預算）。分段執行請直接用 EngineRun。 */

// ══════════════════ 調課查詢器（課務組手動微調用） ══════════════════
// 以既有課表（已發布或草稿）為起點，點一堂科任課 → 找出所有**不違反硬規則**的調法：
//   move＝直接搬到空格、swap2＝兩角互換、swap3＝三角互調（A→B 格、B→C 格、C→A 格）。
// 硬規則全部沿用引擎的 State.canPlace（鎖課、同時段唯一、不排課、連 7、連堂不跨午休、上空上空、教室、外師、不回頭…），
// 導師已填的格當作「必留導師格」（科任課不得放入）。每個選項附軟分變化（引擎同一套計分），讓課務組挑最不傷的。
export interface SwapMove { id: string; day: number; period: number }
export interface SwapOption {
  lessonId: string                  // 被點的那堂課
  kind: 'move' | 'swap2' | 'swap3' | 'chain'
  moves: SwapMove[]                 // 全部一起套用才合法
  softDelta: number                 // 罰分變化（負＝變好；含必須級 1e6 量級）
  breakdown?: { label: string; delta: number }[]   // 哪條規則各變多少（|Δ|大的在前）
  desc: string                      // 人看的描述
  targetSlot: string                // 被點的那堂課最後落在哪一格（上色用）
  partnerIds: string[]              // 牽動到的其他課 id（上色用）
}
export interface SwapQuery {
  options: SwapOption[]
  why: Record<string, string>       // 被點的課所在班級每一格 → 為什麼不能直接搬（灰格提示）
  baseSoft: number
}

export class SwapFinder {
  private st: State
  private input: EngineInput
  private lessons: EngineLesson[]
  private byId: Map<string, EngineLesson>
  private baseSoft: number   // 以 total（軟分＋必須級）量：必排未覆蓋／上空上空／導師連四等「必須級」是計分項不是 canPlace，用 soft 會把它們調壞還以為變好

  /** @param hrCells classKey → slot → 導師已填科目（這些格科任課不得放入）
   *  @param lockTargets true＝導師填課開放中：科任課只能跟科任課互換，不可搬進空格／導師格（避免撞到導師剛填的） */
  constructor(input: EngineInput, placed: PlacedResult[], hrCells: Record<string, Record<string, string>> = {}, private lockTargets = false) {
    const lessons: EngineLesson[] = placed.map(p => {
      const { day: _d, period: _p, roomId: _r, ...l } = p as PlacedResult & { day: number; period: number; roomId: string | null }
      return { ...l }
    })
    const mustLeave: Record<string, string[]> = { ...input.classMustLeave }
    for (const [ck, cells] of Object.entries(hrCells)) {
      const set = new Set(mustLeave[ck] ?? [])
      for (const sl of Object.keys(cells)) set.add(sl)
      mustLeave[ck] = Array.from(set)
    }
    this.input = { ...input, lessons, classMustLeave: mustLeave, seed: input.seed ?? 1 }
    this.lessons = lessons
    this.byId = new Map(lessons.map(l => [l.id, l]))
    this.st = new State(this.input)
    // 依原位落下（不驗證：既有課表就是事實；之後每一步查詢才用 canPlace）
    for (const p of placed) { const l = this.byId.get(p.id); if (l) this.st.place(l, { day: p.day, period: p.period }) }
    this.syncRooms(placed)
    this.baseSoft = scoreState(this.st).total
  }
  /** 教室以畫面上（reassignRooms）的為準：State.place 自己挑的教室是路徑相依的，不同步的話「原地不動」也會算出分數差。 */
  private syncRooms(placed: PlacedResult[]) {
    for (const p of placed) if (p.roomId !== undefined) this.st.setRoom(p.id, p.roomId)
  }

  /** 目前課表（含教室分配）。 */
  snapshot(): PlacedResult[] {
    const out: PlacedResult[] = []
    this.st.pos.forEach((p, id) => { const l = this.byId.get(id)!; out.push({ ...l, day: p.day, period: p.period, roomId: this.st.roomOf.get(id) ?? null }) })
    return out
  }

  private slotKey(p: Placement) { return `${p.day}-${p.period}` }
  private lessonAt(classKey: string, slot: string): EngineLesson | null {
    const id = this.st.classOcc.get(classKey)?.get(slot); return id ? this.byId.get(id) ?? null : null
  }
  private targetOccupiedByLesson(l: EngineLesson, p: Placement): boolean {
    return this.st.slotsOf(l, p).every(sl => this.st.classOcc.get(l.classKey)?.has(sl))
  }

  /** 為什麼 l 不能直接放在 p（第一條卡住的硬規則；供灰格提示）。 */
  explain(l: EngineLesson, p: Placement): string | null {
    const slots = this.st.slotsOf(l, p)
    const avail = this.input.classSlots[l.classKey] ?? []
    const locks = this.input.lockedCells[l.classKey] ?? {}
    const mustLeave = this.input.classMustLeave[l.classKey] ?? []
    const blocked = this.input.teacherBlocked[l.teacherId] ?? []
    if (l.parity !== 'weekly' && ![1, 3, 5].includes(p.period)) return '單雙週連堂區塊起始限 1/3/5 節'
    if (l.size === 2 && p.period === MORNING_LAST) return '連堂不跨午休'
    for (const sl of slots) {
      if (locks[sl]) return `鎖課格（${locks[sl]}）`
      if (!avail.includes(sl)) return '非可排課時段'
      if (mustLeave.includes(sl)) return '導師課／導師排課標記格'
      const occ = this.st.classOcc.get(l.classKey)?.get(sl)
      if (occ && occ !== l.id) { const o = this.byId.get(occ); return `該格已有 ${o?.subject ?? '課'}（${o?.teacherName ?? ''}）——可互換` }
      if (blocked.includes(sl)) return `${l.teacherName} 該時段不排課`
      const cell = this.st.teacherOcc.get(l.teacherId)?.get(sl)
      const busy = cell && [cell.w, l.parity !== 'even' ? cell.o : undefined, l.parity !== 'odd' ? cell.e : undefined].some(id => id && id !== l.id)
      if (busy) { const id = cell!.w ?? cell!.o ?? cell!.e; const o = id ? this.byId.get(id) : null; return `${l.teacherName} 該時段已有課（${o?.classLabel ?? ''}）——可互換` }
      if (l.coTeacherId) {
        if ((this.input.teacherBlocked[l.coTeacherId] ?? []).includes(sl)) return `外師 ${l.coTeacherName ?? ''} 不可到校`
        const cc = this.st.teacherOcc.get(l.coTeacherId)?.get(sl)
        if (cc && [cc.w, l.parity !== 'even' ? cc.o : undefined, l.parity !== 'odd' ? cc.e : undefined].some(id => id && id !== l.id)) return `外師 ${l.coTeacherName ?? ''} 已在別班`
      }
    }
    if (!this.st.canPlace(l, p)) return '其他硬規則（連 7／上空上空／同科同日／教室／不回頭…）'
    return null
  }

  /** 被點的課的所有合法調法。 */
  query(lessonId: string, opts: { maxThree?: number; timeMs?: number; noMove?: boolean } = {}): SwapQuery {
    const l = this.byId.get(lessonId)
    const from = l ? this.st.pos.get(l.id) : undefined
    if (!l || !from) return { options: [], why: {}, baseSoft: this.baseSoft }
    const maxThree = opts.maxThree ?? 400, t0 = Date.now(), timeMs = opts.timeMs ?? 800
    const options: SwapOption[] = []
    const why: Record<string, string> = {}
    const name = (x: EngineLesson) => `${x.classLabel} ${x.subject}（${x.teacherName}）`
    const slotZhLocal = (p: Placement, x: EngineLesson = l) => `週${DAY_ZH[p.day]}第${p.period}節${x.size === 2 ? '–' + (p.period + 1) : ''}`
    const base = scoreState(this.st)          // 每次查詢重新量基準（查詢中途的教室挪動會讓快取的 baseSoft 漂）
    const base0 = base.total
    const basePens = new Map(base.penalties.map(x => [x.label, x.points]))
    let lastBd: { label: string; delta: number }[] = []
    const delta = () => {
      const sc = scoreState(this.st)
      const bd: { label: string; delta: number }[] = []
      const labels = new Set<string>([...Array.from(basePens.keys()), ...sc.penalties.map(x => x.label)])
      const cur = new Map(sc.penalties.map(x => [x.label, x.points]))
      for (const lb of labels) { const d = Math.round((cur.get(lb) ?? 0) - (basePens.get(lb) ?? 0)); if (d !== 0) bd.push({ label: lb, delta: d }) }
      bd.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      lastBd = bd
      return Math.round(sc.total - base0)
    }
    const sameLesson = (a: EngineLesson, b: EngineLesson) => a.classKey === b.classKey && a.subject === b.subject && a.teacherId === b.teacherId && a.size === b.size && a.parity === b.parity && (a.coTeacherId ?? '') === (b.coTeacherId ?? '')
    const grid = this.input.classSlots[l.classKey] ?? []
    const candidates = Array.from(new Set(grid.map(s => { const { day, period } = parseSlotKey(s); return `${day}-${period}` })))
    // ① 直接搬
    this.st.remove(l)
    for (const sk of candidates) {
      const p = parseSlotKey(sk)
      if (p.day === from.day && p.period === from.period) continue
      if (this.lockTargets) { why[sk] = '導師填課開放中：只能與科任課互換'; continue }
      const reason = this.explain(l, p)
      if (reason) { why[sk] = reason; continue }
      this.st.place(l, p)
      options.push({ lessonId: l.id, kind: 'move', moves: [{ id: l.id, day: p.day, period: p.period }], softDelta: delta(), breakdown: lastBd, desc: `${name(l)} ${slotZhLocal(from)} → ${slotZhLocal(p)}`, targetSlot: sk, partnerIds: [] })
      this.st.remove(l)
    }
    this.st.place(l, from)
    // ② 兩角：夥伴＝同班的課 ∪ 同師（含外師）的課
    const partners = this.partnersOf(l).filter(m => !sameLesson(l, m))   // 同班同科同師同型態互換＝原地不動，略過
    for (const m of partners) {
      const pm = this.st.pos.get(m.id)!
      this.st.remove(l); this.st.remove(m)
      let ok = false
      if (this.st.canPlace(l, pm)) {
        this.st.place(l, pm)
        if (this.st.canPlace(m, from)) {
          this.st.place(m, from); ok = true
          options.push({ lessonId: l.id, kind: 'swap2', moves: [{ id: l.id, day: pm.day, period: pm.period }, { id: m.id, day: from.day, period: from.period }], softDelta: delta(), breakdown: lastBd,
            desc: `${name(l)} ↔ ${name(m)}（${slotZhLocal(from)} ↔ ${slotZhLocal(pm, m)}）`, targetSlot: this.slotKey(pm), partnerIds: [m.id] })
          this.st.remove(m)
        }
        this.st.remove(l)
      }
      if (!ok && m.classKey === l.classKey) {
        // 同班互換失敗：說清楚卡在哪一步（l 過去不行？還是 m 過來不行？）
        const r1 = this.explain(l, pm)
        let r2: string | null = null
        if (!r1) { this.st.place(l, pm); r2 = this.explain(m, from); this.st.remove(l) }
        why[this.slotKey(pm)] = r1 ? `與 ${m.subject}（${m.teacherName}）互換：${r1}` : `與 ${m.subject}（${m.teacherName}）互換：對方過來 ${r2 ?? '不合法'}`
      }
      this.st.place(l, from); this.st.place(m, pm)
    }
    // ③ 三角：L→M 格、M→N 格、N→L 格
    let tried = 0
    outer: for (const m of (maxThree > 0 ? partners : [])) {
      const pm = this.st.pos.get(m.id)!
      const partnersM = this.partnersOf(m).filter(n => n.id !== l.id && n.id !== m.id)
      for (const n of partnersM) {
        if (++tried > maxThree || Date.now() - t0 > timeMs) break outer
        const pn = this.st.pos.get(n.id)!
        this.st.remove(l); this.st.remove(m); this.st.remove(n)
        if (this.st.canPlace(l, pm)) {
          this.st.place(l, pm)
          if (this.st.canPlace(m, pn)) {
            this.st.place(m, pn)
            if (this.st.canPlace(n, from)) {
              this.st.place(n, from)
              options.push({ lessonId: l.id, kind: 'swap3', moves: [{ id: l.id, day: pm.day, period: pm.period }, { id: m.id, day: pn.day, period: pn.period }, { id: n.id, day: from.day, period: from.period }],
                softDelta: delta(), breakdown: lastBd, desc: `${name(l)} → ${slotZhLocal(pm)}；${name(m)} → ${slotZhLocal(pn, m)}；${name(n)} → ${slotZhLocal(from, n)}`, targetSlot: this.slotKey(pm), partnerIds: [m.id, n.id] })
              this.st.remove(n)
            }
            this.st.remove(m)
          }
          this.st.remove(l)
        }
        this.st.place(l, from); this.st.place(m, pm); this.st.place(n, pn)
      }
    }
    options.sort((a, b) => a.softDelta - b.softDelta || a.moves.length - b.moves.length)
    return { options, why, baseSoft: this.baseSoft }
  }

  /** 找一條更長的鏈（最多 depth 層）：L 搬去某格，把擋路的課（同班那格的課、同師同時段的課，最多兩堂）逐出，
   *  再為被逐出的課各找位子（可落進空格、L 的原格、或再逐出別人）……直到全部落地。深度優先、時間上限內找到第一條就回。 */
  findChain(lessonId: string, depth = 4, timeMs = 1500): SwapOption | null {
    const l = this.byId.get(lessonId); const from = l ? this.st.pos.get(l.id) : undefined
    if (!l || !from) return null
    const t0 = Date.now()
    const moves: SwapMove[] = []
    const origin = new Map<string, Placement>([[l.id, from]])
    const touched = new Set<string>([l.id])
    const gridOf = (x: EngineLesson) => Array.from(new Set((this.input.classSlots[x.classKey] ?? []).map(s => { const q = parseSlotKey(s); return `${q.day}-${q.period}` }))).map(s => parseSlotKey(s))
    const blockersOf = (x: EngineLesson, p: Placement): string[] | null => {
      const set = new Set<string>()
      for (const sl of this.st.slotsOf(x, p)) {
        const c = this.st.classOcc.get(x.classKey)?.get(sl); if (c && c !== x.id) set.add(c)
        for (const tid of [x.teacherId, x.coTeacherId]) {
          if (!tid) continue
          const cell = this.st.teacherOcc.get(tid)?.get(sl)
          for (const id of [cell?.w, x.parity !== 'even' ? cell?.o : undefined, x.parity !== 'odd' ? cell?.e : undefined]) if (id && id !== x.id) set.add(id)
        }
      }
      if (!set.size || set.size > 2) return null
      for (const id of set) if (touched.has(id)) return null
      return Array.from(set)
    }
    // queue 裡的課目前都「拿在手上」（已 remove）
    const solve = (queue: EngineLesson[], d: number): boolean => {
      if (!queue.length) return true
      if (Date.now() - t0 > timeMs) return false
      const [x, ...rest] = queue
      const xo = origin.get(x.id)!
      const order = gridOf(x).filter(p => !(p.day === xo.day && p.period === xo.period))
      // ① 直接落地（空格、或 L 空出來的原格）
      for (const p of order) {
        if (this.lockTargets && !this.targetOccupiedByLesson(x, p) && !(x.classKey === l.classKey && p.day === from.day && p.period === from.period)) continue
        if (!this.st.canPlace(x, p)) continue
        this.st.place(x, p); moves.push({ id: x.id, day: p.day, period: p.period })
        if (solve(rest, d)) return true
        this.st.remove(x); moves.pop()
      }
      if (d <= 0) return false
      // ② 逐出擋路者再落地
      for (const p of order) {
        const bl = blockersOf(x, p); if (!bl) continue
        const bs = bl.map(id => this.byId.get(id)!)
        const bpos = bs.map(b => this.st.pos.get(b.id)!)
        bs.forEach(b => this.st.remove(b))
        if (!this.st.canPlace(x, p)) { bs.forEach((b, i) => this.st.place(b, bpos[i])); continue }
        this.st.place(x, p); moves.push({ id: x.id, day: p.day, period: p.period })
        bs.forEach((b, i) => { touched.add(b.id); origin.set(b.id, bpos[i]) })
        if (solve([...bs, ...rest], d - 1)) return true
        bs.forEach(b => { touched.delete(b.id); origin.delete(b.id) })
        this.st.remove(x); moves.pop()
        bs.forEach((b, i) => this.st.place(b, bpos[i]))
      }
      return false
    }
    this.st.remove(l)
    const ok = solve([l], depth)
    let out: SwapOption | null = null
    if (ok) {
      const softDelta = Math.round(scoreState(this.st).total - this.baseSoft)
      out = { lessonId: l.id, kind: 'chain', moves: [...moves], softDelta, desc: moves.map(mv => { const x = this.byId.get(mv.id)!; return `${x.classLabel} ${x.subject}（${x.teacherName}）→ 週${DAY_ZH[mv.day]}第${mv.period}節` }).join('；'), targetSlot: `${moves[0].day}-${moves[0].period}`, partnerIds: moves.slice(1).map(m => m.id) }
    }
    // 還原：所有動過的課回原位
    for (const id of touched) if (this.st.pos.has(id)) this.st.remove(this.byId.get(id)!)
    for (const id of touched) this.st.place(this.byId.get(id)!, origin.get(id)!)
    return out
  }

  /** 科任↔導師互換用：假設導師把 p 這格讓出來（該格暫時不算必留導師格），這堂科任課搬過去是否合法、軟分變化多少。 */
  checkMoveFreeingHr(lessonId: string, p: Placement): { reason: string | null; softDelta: number } {
    const l = this.byId.get(lessonId); const from = l ? this.st.pos.get(l.id) : undefined
    if (!l || !from) return { reason: '找不到課', softDelta: 0 }
    const arr = this.input.classMustLeave[l.classKey] ?? []
    const slots = this.st.slotsOf(l, p)
    this.input.classMustLeave[l.classKey] = arr.filter(s => !slots.includes(s))
    this.st.remove(l)
    const reason = this.explain(l, p)
    let softDelta = 0
    if (!reason) { this.st.place(l, p); softDelta = Math.round(scoreState(this.st).total - this.baseSoft); this.st.remove(l) }
    this.st.place(l, from)
    this.input.classMustLeave[l.classKey] = arr
    return { reason, softDelta }
  }

  /** 套用一組搬動（全部合法才套；回傳新課表含教室）。 */
  apply(moves: SwapMove[]): { ok: boolean; placed: PlacedResult[]; error?: string } {
    const journal: { l: EngineLesson; from: Placement }[] = []
    for (const mv of moves) { const l = this.byId.get(mv.id); const from = l && this.st.pos.get(l.id); if (!l || !from) return { ok: false, placed: this.snapshot(), error: '找不到課' }; journal.push({ l, from }); this.st.remove(l) }
    for (const mv of moves) {
      const l = this.byId.get(mv.id)!; const p = { day: mv.day, period: mv.period }
      if (!this.st.canPlace(l, p)) {
        for (const j of journal) if (this.st.pos.has(j.l.id)) this.st.remove(j.l)
        for (const j of journal) this.st.place(j.l, j.from)
        return { ok: false, placed: this.snapshot(), error: `${l.classLabel} ${l.subject} 無法放到週${DAY_ZH[p.day]}第${p.period}節：${this.explain(l, p) ?? '硬規則'}` }
      }
      this.st.place(l, p)
    }
    // 教室用畫面同一套 reassignRooms 重配並同步回 State，回傳的就是最終版
    const out = reassignRooms(this.snapshot(), this.input.rooms, this.input.weights)
    this.syncRooms(out)
    this.baseSoft = scoreState(this.st).total
    return { ok: true, placed: out }
  }

  /** 套用但只有真的變好才留：全部合法→套→重量罰分；沒變好（或不合法）就整組還原。回傳實際變化量（null＝未套）。
   *  「全部套用」用：前面的調動會讓後面的分數變、甚至變成不合法，所以每筆都要在當下重量一次。 */
  applyIfBetter(moves: SwapMove[]): { applied: boolean; delta: number; placed: PlacedResult[] } {
    const before = this.snapshot()
    const soft0 = this.baseSoft
    const origins = new Map<string, Placement>()
    for (const mv of moves) { const p = this.st.pos.get(mv.id); if (!p) return { applied: false, delta: 0, placed: before }; origins.set(mv.id, p) }
    const r = this.apply(moves)
    if (!r.ok) return { applied: false, delta: 0, placed: before }
    const delta = Math.round(this.baseSoft - soft0)
    if (delta < 0) return { applied: true, delta, placed: r.placed }
    // 還原
    for (const id of origins.keys()) this.st.remove(this.byId.get(id)!)
    origins.forEach((p, id) => this.st.place(this.byId.get(id)!, p))
    this.syncRooms(before)
    this.baseSoft = soft0
    return { applied: false, delta, placed: before }
  }

  get soft() { return this.baseSoft }

  private partnersOf(l: EngineLesson): EngineLesson[] {
    const out = new Map<string, EngineLesson>()
    for (const x of this.lessons) {
      if (x.id === l.id || !this.st.pos.has(x.id)) continue
      // 導師填課開放中：只能同班科任課互換（跨班互換會讓某一班的科任課落進原本空著／導師要填的格）
      if (this.lockTargets) { if (x.classKey === l.classKey) out.set(x.id, x); continue }
      if (x.classKey === l.classKey || x.teacherId === l.teacherId || (l.coTeacherId && (x.teacherId === l.coTeacherId || x.coTeacherId === l.coTeacherId)) || (x.coTeacherId && x.coTeacherId === l.teacherId)) out.set(x.id, x)
    }
    return Array.from(out.values())
  }
}

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
