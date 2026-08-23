'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES } from '@/lib/allocation'
import { roomsFromConfig, reassignRooms, type PlacedResult, type EngineInput } from '@/lib/schedule-engine'
import type { HomeroomRow } from './OverviewAdjust'

/* ────────────────────────────────────────────────────────────────────────────
   連鎖調課：課務組人工排課的作法搬上畫面。

   一支箭頭畫在「你正在看的那張課表」上，指向那張課表上的空位：
     ・教師課表上的空位＝這位老師那一節有空
     ・班級課表上的空位＝這個班那一節沒課（也可以直接點別人的課＝換掉他）
   畫完箭頭才去看它造成什麼衝突，衝突所在的那張課表這時候才出現，
   被卡住的那堂課自動成為下一支箭頭的起點——兩個軸交替往下走：

     教師課表（老師何時有空）→ 班級課表（班上那格有沒有人）→ 教師課表 → …

   直到某一支箭頭兩邊都沒衝突，鏈就結束。畫面全程是原始課表，課要按套用才真的動。
   鎖課與非可排課時段絕對不能碰；其餘硬限制擋不住人工（套用前列出來，但不阻止）。
   ──────────────────────────────────────────────────────────────────────────── */

export type ChainSeed = { kind: 'class'; classKey: string } | { kind: 'teacher'; teacherId: string }

type Item = { kind: 'lesson'; id: string } | { kind: 'hr'; classKey: string; slot: string }
type Board = { kind: 'class'; classKey: string } | { kind: 'teacher'; teacherId: string } | { kind: 'room'; roomId: string }
type Move = { n: number; board: Board; from: string; to: string; item: Item; what: string; who: string; cls: string; h: number }
type Pending = { item: Item; why: string; board: Board; step: number }   // step＝哪一支箭頭造成的（0＝起始）
type Snap = { placed: PlacedResult[]; hr: Record<string, HomeroomRow>; moves: Move[]; boards: Board[]; pending: Pending[]; splitIds: string[] }

interface Props {
  open: boolean
  seed: ChainSeed | null
  placed: PlacedResult[]
  hr: Record<string, HomeroomRow>
  config: ScheduleConfig
  classCounts: Record<number, number>
  teacherNames: Record<string, string>
  engineInput: EngineInput
  fillOpen: boolean
  /** 不進引擎的固定課（本土語原班／語別場次）：教師課表要畫出來，而且那幾節不能當目標——
   *  看不到就會把課排到本土語上面，變成同一節要上兩堂。 */
  extraByTeacher: Map<string, { slot: string; main: string; sub: string }[]>
  onClose: () => void
  onApply: (next: { placed: PlacedResult[]; hr: Record<string, HomeroomRow>; moves: { classKey: string; from: string; to: string; what: string }[] }) => void
}

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const slotZh = (s: string) => { const [d, p] = s.split('-'); return `週${DAY_ZH[Number(d)]}第${p}節` }
const bKey = (b: Board) => b.kind === 'class' ? `c:${b.classKey}` : b.kind === 'teacher' ? `t:${b.teacherId}` : `r:${b.roomId}`
const iKey = (i: Item) => i.kind === 'lesson' ? `l:${i.id}` : `h:${i.classKey}|${i.slot}`
const ckZh = (ck: string) => ck ? classLabel(Number(ck.split('-')[0]), Number(ck.split('-')[1])) : ''

const CELL_W = 92, CELL_H = 42, HEAD_H = 24, LABEL_W = 40   // 100% 時的基準尺寸
/** 版面偏好存在這台電腦：課務組把大小與每排幾張調到順手之後，之後每次開都一樣。 */
const LAYOUT_KEY = 'trotate:chain-layout'
const SCALES = [0.8, 0.9, 1, 1.15, 1.3]
const PER_ROWS = [0, 1, 2, 3, 4] as const   // 0＝自動（依視窗寬度排）

export default function ChainAdjustModal({
  open, seed, placed: placed0, hr: hr0, config, classCounts, teacherNames, engineInput, fillOpen, extraByTeacher, onClose, onApply,
}: Props) {
  const [placed, setPlaced] = useState<PlacedResult[]>(placed0)
  const [hr, setHr] = useState<Record<string, HomeroomRow>>(hr0)
  const [moves, setMoves] = useState<Move[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [pick, setPick] = useState<{ item: Item; board: Board; slot: string } | null>(null)
  const [splitIds, setSplitIds] = useState<string[]>([])
  const [history, setHistory] = useState<Snap[]>([])
  const [booted, setBooted] = useState('')
  // 教室全滿時的「請選一個讓出來」：候選就是那幾間教室在那一格的使用者，直接點課表上的格子選
  const [roomPick, setRoomPick] = useState<{ slots: string[]; roomIds: string[]; step: number; subject: string } | null>(null)
  const [scale, setScale] = useState(1)
  const [perRow, setPerRow] = useState<number>(0)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  if (!layoutLoaded) {
    setLayoutLoaded(true)
    try {
      const raw = localStorage.getItem(LAYOUT_KEY)
      if (raw) {
        const v = JSON.parse(raw)
        if (SCALES.includes(v.scale)) setScale(v.scale)
        if (PER_ROWS.includes(v.perRow)) setPerRow(v.perRow)
      }
    } catch { /* 無痕視窗或封鎖儲存：用預設值就好 */ }
  }
  const saveLayout = (next: { scale?: number; perRow?: number }) => {
    const v = { scale: next.scale ?? scale, perRow: next.perRow ?? perRow }
    if (next.scale !== undefined) setScale(next.scale)
    if (next.perRow !== undefined) setPerRow(next.perRow)
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(v)) } catch { /* 同上 */ }
  }
  // 依縮放算出這一輪要用的實際尺寸（箭頭座標也吃這組數字，不然會跟格子對不齊）
  const CW = Math.round(CELL_W * scale), CH = Math.round(CELL_H * scale)
  const HH = Math.round(HEAD_H * scale), LW = Math.round(LABEL_W * scale)
  const FS = (10.5 * scale).toFixed(1) + 'px'

  const nameOf = (id: string) => teacherNames[id] ?? '？'

  const seedKey = seed ? bKey(seed as Board) : ''
  if (open && seedKey && booted !== seedKey) {
    setPlaced(placed0); setHr(hr0); setMoves([]); setPending([]); setPick(null); setHistory([]); setSplitIds([])
    setBoards(seed ? [seed as Board] : [])
    setRoomPick(null)
    setBooted(seedKey)
  }
  if (!open && booted) setBooted('')

  /* ── 顯示用（原始課表＋拆連堂，永遠不套用搬移）── */
  const splitOf = (l: PlacedResult): PlacedResult[] => ([
    { ...l, id: `${l.id}~a`, size: 1 },
    { ...l, id: `${l.id}~b`, size: 1, period: l.period + 1 },
  ])
  const spanOf = (l: PlacedResult) => l.size === 2 ? [`${l.day}-${l.period}`, `${l.day}-${l.period + 1}`] : [`${l.day}-${l.period}`]
  const dPlaced = useMemo(() => {
    const set = new Set(splitIds)
    return placed0.flatMap(l => set.has(l.id) ? splitOf(l) : [l])
  }, [placed0, splitIds])
  const dById = useMemo(() => new Map(dPlaced.map(l => [l.id, l])), [dPlaced])
  const dClass = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const q of dPlaced) {
      if (q.day < 1) continue
      const cm = m.get(q.classKey) ?? new Map<string, PlacedResult>()
      for (const s of spanOf(q)) cm.set(s, q)
      m.set(q.classKey, cm)
    }
    return m
  }, [dPlaced])
  const dTeacher = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const q of dPlaced) for (const tid of (q.day < 1 ? [] : [q.teacherId, ...(q.coTeacherId ? [q.coTeacherId] : [])])) {
      const tm = m.get(tid) ?? new Map<string, PlacedResult>()
      for (const s of spanOf(q)) tm.set(s, q)
      m.set(tid, tm)
    }
    return m
  }, [dPlaced])

  /* ── 模擬用（算連鎖、違規、套用）── */
  const sClass = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const q of placed) {
      if (q.day < 1) continue
      const cm = m.get(q.classKey) ?? new Map<string, PlacedResult>()
      for (const s of spanOf(q)) cm.set(s, q)
      m.set(q.classKey, cm)
    }
    return m
  }, [placed])
  const sTeacher = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const q of placed) for (const tid of (q.day < 1 ? [] : [q.teacherId, ...(q.coTeacherId ? [q.coTeacherId] : [])])) {
      for (const s of spanOf(q)) m.set(`${tid}|${s}`, [...(m.get(`${tid}|${s}`) ?? []), q])
    }
    return m
  }, [placed])

  /* ── 設定衍生 ── */
  const lockOf = (ck: string) => config.lockCells[ck] ?? {}
  const lockTypeMap = useMemo(() => Object.fromEntries(config.lockTypes.map(t => [t.id, t])), [config])
  const teachOf = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const g of GRADES) for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const grid = config.bands[bandOf(g)]
      const set = new Set<string>()
      for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) if (grid.teachable[`${d}-${p}`]) set.add(`${d}-${p}`)
      m.set(`${g}-${i}`, set)
    }
    return m
  }, [config, classCounts])
  const tBlocked = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode === 'on') continue
      const set = (m[p.teacherId] ??= new Set())
      for (const s of p.slots) set.add(s)
    }
    return m
  }, [config])
  const mustLeaveOf = useMemo(() => {
    const on: Record<string, Set<string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode !== 'on') continue
      const set = (on[p.teacherId] ??= new Set())
      for (const s of p.slots) set.add(s)
    }
    const m: Record<string, Set<string>> = {}
    for (const [ck, tid] of Object.entries(config.classTeacher)) if (tid && on[tid]) m[ck] = on[tid]
    return m
  }, [config])
  const mustFillOf = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const g of GRADES) {
      const gradeOff = config.gradeCommonOff[String(g)] ?? []
      for (let i = 0; i < (classCounts[g] ?? 0); i++) {
        const ck = `${g}-${i}`
        const set = new Set<string>(gradeOff)
        const hid = config.classTeacher[ck]
        if (hid) for (const s of Array.from(tBlocked[hid] ?? [])) set.add(s)
        m[ck] = set
      }
    }
    return m
  }, [config, classCounts, tBlocked])
  const maxPeriods = useMemo(() => Math.max(...Object.values(config.bands).map(b => b.periodsPerDay)), [config])

  /* ── 小工具 ── */
  const classOfItem = (i: Item) => i.kind === 'hr' ? i.classKey : (dById.get(i.id)?.classKey ?? '')
  const labelOf = (i: Item): { what: string; who: string } => {
    if (i.kind === 'lesson') { const l = dById.get(i.id); return l ? { what: l.subject, who: l.teacherName } : { what: '？', who: '' } }
    return { what: hr0[i.classKey]?.cells?.[i.slot] || '導師課', who: nameOf(config.classTeacher[i.classKey] ?? '') }
  }
  const roomById = useMemo(() => new Map(engineInput.rooms.map(r => [r.id, r])), [engineInput])
  const dRoom = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const q of dPlaced) {
      if (q.day < 1 || !q.roomId) continue
      const rm = m.get(q.roomId) ?? new Map<string, PlacedResult>()
      for (const s2 of spanOf(q)) rm.set(s2, q)
      m.set(q.roomId, rm)
    }
    return m
  }, [dPlaced])

  const displaySlot = (i: Item) => i.kind === 'hr' ? i.slot : (() => { const l = dById.get(i.id); return l && l.day > 0 ? `${l.day}-${l.period}` : '' })()
  /** 這一格在畫面上還算不算被占著：已經有箭頭要搬走的，視為空出來了。 */
  const leaving = (i: Item) => moves.some(m => iKey(m.item) === iKey(i))
  const addBoard = (bs: Board[], b: Board) => bs.some(x => bKey(x) === bKey(b)) ? bs : [...bs, b]

  /* ── 目標格判定：一定要是「這張課表上的空位」；班級課表另外允許直接換掉別人的課 ── */
  function targetOf(board: Board, slot: string): { ok: boolean; why: string } | null {
    if (!pick) return null
    return targetFor(pick.item, pick.slot, pick.board, board, slot)
  }
  /** 指定某一堂課，判斷它能不能標記搬到 (board, slot)。targetOf 與「死路偵測」共用。 */
  function targetFor(it: Item, atSlot: string, atBoard: Board, board: Board, slot: string): { ok: boolean; why: string } | null {
    const ck = classOfItem(it)
    if (!ck) return null
    if (slot === atSlot && bKey(board) === bKey(atBoard)) return null
    const teach = teachOf.get(ck)
    if (!teach?.has(slot)) return { ok: false, why: `${ckZh(ck)} 這一節不可排課` }
    if (lockOf(ck)[slot]) return { ok: false, why: `${ckZh(ck)} 這一節是鎖課` }
    const l = it.kind === 'lesson' ? dById.get(it.id) : undefined
    const [d, p] = slot.split('-').map(Number)
    if (l && l.size === 2 && !teach.has(`${d}-${p + 1}`)) return { ok: false, why: '連堂放不下（下一節不可排課）' }
    if (l && l.parity !== 'weekly' && ![1, 3, 5].includes(p)) return { ok: false, why: '單雙週區塊只能從第 1／3／5 節開始' }

    if (board.kind === 'room') return { ok: false, why: '教室課表只供對照，請到班級或教師課表上點位置' }
    if (board.kind === 'teacher') {
      if (tBlocked[board.teacherId]?.has(slot)) return { ok: false, why: `${nameOf(board.teacherId)} 這一節不排課` }
      const ex = (extraByTeacher.get(board.teacherId) ?? []).find(x => x.slot === slot)
      if (ex) return { ok: false, why: `${nameOf(board.teacherId)} 這一節有 ${ex.main}（固定課，不可調）` }
      const occ = dTeacher.get(board.teacherId)?.get(slot)
      if (occ && iKey({ kind: 'lesson', id: occ.id }) !== iKey(it) && !leaving({ kind: 'lesson', id: occ.id }))
        return { ok: false, why: `${nameOf(board.teacherId)} 這一節已有 ${occ.classLabel} ${occ.subject}` }
      return { ok: true, why: '標記搬到這裡（這位老師這一節有空）' }
    }
    if (board.classKey !== ck) return { ok: false, why: '只能搬到這堂課自己班上的時段' }
    const occ = dClass.get(ck)?.get(slot)
    if (occ && iKey({ kind: 'lesson', id: occ.id }) !== iKey(it) && !leaving({ kind: 'lesson', id: occ.id }))
      return { ok: true, why: `標記搬到這裡（換掉 ${occ.subject}）` }
    const sub = hr0[ck]?.cells?.[slot]
    if (sub && !leaving({ kind: 'hr', classKey: ck, slot })) {
      if (fillOpen) return { ok: false, why: '導師填課開放中，導師課唯讀' }
      return { ok: true, why: `標記搬到這裡（換掉導師課「${sub}」）` }
    }
    return { ok: true, why: '標記搬到這裡（班上這一節沒課）' }
  }

  /** 這一筆待安置在它該去的那張課表上，還有幾個合法位置。0＝死路，得先退回。 */
  function optionsFor(p: Pending): number {
    const at = displaySlot(p.item)
    const periods = p.board.kind === 'class' ? config.bands[bandOf(Number(p.board.classKey.split('-')[0]))].periodsPerDay : maxPeriods
    let n = 0
    for (const d of SCHEDULE_DAYS) for (let q = 1; q <= periods; q++) {
      if (targetFor(p.item, at, p.board, p.board, `${d}-${q}`)?.ok) n++
    }
    return n
  }

  const snap = (): Snap => ({ placed, hr, moves, boards, pending, splitIds })

  /** 畫一支箭頭：更新模擬、找出被卡住的那堂課，開出「另一個軸」的課表並自動選中它。 */
  function draw(board: Board, toSlot: string) {
    if (!pick) return
    const it = pick.item
    const ck = classOfItem(it)
    if (!targetOf(board, toSlot)?.ok) return
    const before = snap()
    const stepNo = moves.length + 1
    let nextPlaced = [...placed]
    let nextHr = { ...hr }
    const newPending: Pending[] = []
    const self = iKey(it)

    const l = it.kind === 'lesson' ? placed.find(x => x.id === it.id) : undefined
    const [td, tp] = toSlot.split('-').map(Number)
    const slots = l && l.size === 2 ? [`${td}-${tp}`, `${td}-${tp + 1}`] : [toSlot]

    // 1) 班上這幾格被誰占著 → 那堂課要另找位置，去他老師的課表上找
    for (const s of slots) {
      const occ = sClass.get(ck)?.get(s)
      if (occ && `l:${occ.id}` !== self) {
        nextPlaced = nextPlaced.map(x => x.id === occ.id ? { ...x, day: 0, period: 0 } : x)
        const back = moves.some(m => iKey(m.item) === `l:${occ.id}`)
        newPending.push({ item: { kind: 'lesson', id: occ.id }, step: stepNo,
          why: `${ckZh(ck)} ${slotZh(s)} 讓給了 ${labelOf(it).what}${back ? '——這是前面才安置好的課，鏈繞回來了' : ''}`,
          board: { kind: 'teacher', teacherId: occ.teacherId } })
      }
      const sub = nextHr[ck]?.cells?.[s]
      if (sub && `h:${ck}|${s}` !== self) {
        const cells = { ...nextHr[ck].cells }; delete cells[s]
        nextHr = { ...nextHr, [ck]: { ...nextHr[ck], cells } }
        newPending.push({ item: { kind: 'hr', classKey: ck, slot: s }, step: stepNo,
          why: `${ckZh(ck)} ${slotZh(s)} 的導師課讓了出來`, board: { kind: 'class', classKey: ck } })
      }
    }
    // 2) 這位老師同時段在別班有課 → 去那一班的課表上安置
    const tids = it.kind === 'lesson'
      ? [l?.teacherId ?? '', ...(l?.coTeacherId ? [l.coTeacherId] : [])].filter(Boolean)
      : [config.classTeacher[ck] ?? ''].filter(Boolean)
    for (const tid of tids) for (const s of slots) {
      for (const other of sTeacher.get(`${tid}|${s}`) ?? []) {
        if (`l:${other.id}` === self || other.classKey === ck) continue
        if (!nextPlaced.some(x => x.id === other.id && x.day > 0)) continue
        nextPlaced = nextPlaced.map(x => x.id === other.id ? { ...x, day: 0, period: 0 } : x)
        newPending.push({ item: { kind: 'lesson', id: other.id }, step: stepNo,
          why: `${nameOf(tid)} ${slotZh(s)} 同時要上 ${other.classLabel}`, board: { kind: 'class', classKey: other.classKey } })
      }
    }
    // 3) 把自己放到新位置（只動模擬，畫面不變）
    if (it.kind === 'lesson' && l) nextPlaced = [...nextPlaced.filter(x => x.id !== l.id), { ...l, day: td, period: tp }]
    else if (it.kind === 'hr') {
      const cells = { ...(nextHr[it.classKey]?.cells ?? {}) }
      const sub = hr0[it.classKey]?.cells?.[it.slot] ?? '導師課'
      delete cells[it.slot]; cells[toSlot] = sub
      nextHr = { ...nextHr, [it.classKey]: { ...nextHr[it.classKey], cells } }
    }

    // 4) 專科教室：同科還有別間空著就靜靜換一間（套用時會自動重配），全滿才是真衝突
    let roomNeed: { slots: string[]; roomIds: string[]; subject: string } | null = null
    if (it.kind === 'lesson' && l) {
      // 教室設定裡有管理老師的，只認自己管理的那一間（和引擎的 roomPool 同一條規則）；
      // 沒有管理教室的老師才是該科任一間皆可。不分這一層就會把她根本不會用的教室也攤出來。
      const own = engineInput.rooms.filter(r => r.subject === l.subject && (r.managerIds ?? []).includes(l.teacherId))
      const rooms = own.length ? own : engineInput.rooms.filter(r => r.subject === l.subject)
      if (rooms.length) {
        const busy = (rid: string, s2: string) => nextPlaced.some(x =>
          x.id !== l.id && x.day > 0 && x.roomId === rid && spanOf(x).includes(s2))
        const free = rooms.filter(r => !(r.offSlots ?? []).some(o => slots.includes(o)) && !slots.some(s2 => busy(r.id, s2)))
        if (!free.length) roomNeed = { slots, roomIds: rooms.map(r => r.id), subject: l.subject }
      }
    }

    const lb = labelOf(it)
    setHistory(h => [...h, before])
    setPlaced(nextPlaced); setHr(nextHr)
    setMoves(m => [...m, { n: m.length + 1, board, from: pick.slot, to: toSlot, item: it, what: lb.what, who: lb.who, cls: ck, h: history.length }])

    // 4) 衝突所在的那張課表這時候才出現，被卡住的那堂課自動成為下一支箭頭的起點
    // 去重：同一堂課被擠掉兩次只算一筆（以最新的理由為準）
    // 教室全滿：開出該科所有教室的課表，讓課務組自己點一個班請他讓出來
    if (roomNeed) {
      setBoards(bs => roomNeed!.roomIds.reduce((acc, rid) => addBoard(acc, { kind: 'room', roomId: rid }), bs))
      setRoomPick({ ...roomNeed, step: stepNo })
    }
    const merged = new Map<string, Pending>()
    for (const x of pending) if (iKey(x.item) !== self) merged.set(iKey(x.item), x)
    for (const x of newPending) merged.set(iKey(x.item), x)
    const nextPending = Array.from(merged.values())
    // 每一筆待安置的課表都開出來，不然使用者只看得到第一筆
    if (newPending.length) setBoards(bs => newPending.reduce((acc, x) => addBoard(acc, x.board), bs))
    const next = newPending[0] ?? nextPending[0]
    setPick(roomNeed ? null : next ? { item: next.item, board: next.board, slot: displaySlot(next.item) } : null)
    setPending(nextPending)
  }

  function undoMove(m: Move) {
    const later = moves.length - m.n
    if (later > 0 && !confirm(`第 ${m.n} 步之後還有 ${later} 步，會一起退回。確定嗎？`)) return
    const back = history[m.h]
    if (!back) return
    setPlaced(back.placed); setHr(back.hr); setMoves(back.moves); setBoards(back.boards); setPending(back.pending); setSplitIds(back.splitIds)
    setHistory(h => h.slice(0, m.h))
    setRoomPick(null)
    setPick({ item: m.item, board: m.board, slot: m.from })
  }
  function undo() {
    const last = history[history.length - 1]
    if (!last) return
    const undone = moves[moves.length - 1]
    setPlaced(last.placed); setHr(last.hr); setMoves(last.moves); setBoards(last.boards); setPending(last.pending); setSplitIds(last.splitIds)
    setHistory(h => h.slice(0, -1))
    setRoomPick(null)
    setPick(undone ? { item: undone.item, board: undone.board, slot: undone.from } : null)
  }

  /** 選中的連堂拆成兩個單節（社會 2 連堂＋1 單節想改成 1 單節＋2 連堂就靠這個）。 */
  function splitPicked() {
    if (!pick || pick.item.kind !== 'lesson') return
    const pid = pick.item.id
    const l = dById.get(pid)
    if (!l || l.size !== 2 || l.parity !== 'weekly') return
    setHistory(h => [...h, snap()])
    setSplitIds(ids => [...ids, pid])
    setPlaced(ps => ps.flatMap(x => x.id === pid ? splitOf(x) : [x]))
    setPending(ps => ps.filter(x => iKey(x.item) !== `l:${pid}`))
    setPick({ item: { kind: 'lesson', id: `${pid}~a` }, board: pick.board, slot: `${l.day}-${l.period}` })
  }

  /* ── 導師連堂位：導師自上的連堂科目（社會／生活／自然）或單雙週視藝，
     班上至少要留一組「同半天連續兩格留白」給他，否則那堂連堂上不了。
     單雙週視藝特別容易踩到：那一組佔住兩格，導師只有一週用得到，等於少一組連堂位。
     這裡即時算，調的時候看著數字變，不用等套用才發現。 */
  const hrDouble = useMemo(() => {
    const need = engineInput.homeroomDoubleNeed ?? {}
    const occ = new Map<string, Set<string>>()
    for (const q of placed) {
      if (q.day < 1) continue
      const set = occ.get(q.classKey) ?? new Set<string>()
      for (const s2 of spanOf(q)) set.add(s2)
      occ.set(q.classKey, set)
    }
    const out: { ck: string; note: string; need: number; pairs: number; biweekly: boolean }[] = []
    for (const b of boards) {
      if (b.kind !== 'class') continue
      const nd = need[b.classKey]
      if (!nd?.pairs) continue
      const taken = occ.get(b.classKey) ?? new Set<string>()
      const blank = new Set((engineInput.classSlots[b.classKey] ?? []).filter(x => !taken.has(x)))
      let pairs = 0
      for (const d of SCHEDULE_DAYS) for (const half of [[1, 2, 3, 4], [5, 6, 7]]) {
        let run = 0
        for (const q of [...half, 0]) { if (q && blank.has(`${d}-${q}`)) run++; else { pairs += Math.floor(run / 2); run = 0 } }
      }
      out.push({ ck: b.classKey, note: nd.note, need: nd.pairs, pairs,
        biweekly: placed.some(x => x.classKey === b.classKey && x.parity !== 'weekly') })
    }
    return out
  }, [boards, placed, engineInput])

  /* ── 違規：只報這次調動新造成的 ── */
  function computeIssues(px: PlacedResult[], hx: Record<string, HomeroomRow>) {
    const must: string[] = [], hard: string[] = []
    const live = px.filter(x => x.day > 0)
    const re = reassignRooms(live, roomsFromConfig(config), config.weights)
    const cx = new Map<string, Map<string, PlacedResult>>()
    for (const q of live) {
      const cm = cx.get(q.classKey) ?? new Map<string, PlacedResult>()
      for (const s of spanOf(q)) cm.set(s, q)
      cx.set(q.classKey, cm)
    }
    const seen = new Map<string, PlacedResult>()
    for (const q of re) for (const tid of [q.teacherId, ...(q.coTeacherId ? [q.coTeacherId] : [])]) for (const s of spanOf(q)) {
      const k = `${tid}|${s}|${q.parity}`, prev = seen.get(k)
      if (prev && prev.id !== q.id) hard.push(`${nameOf(tid)} ${slotZh(s)} 同時要上 ${prev.classLabel} 與 ${q.classLabel}`)
      seen.set(k, q)
    }
    const rs = new Map<string, PlacedResult>()
    for (const q of re) {
      if (!q.roomId) continue
      for (const s of spanOf(q)) {
        const k = `${q.roomId}|${s}|${q.parity}`, prev = rs.get(k)
        if (prev && prev.id !== q.id) hard.push(`教室衝突 ${slotZh(s)}：${prev.classLabel} 與 ${q.classLabel}`)
        rs.set(k, q)
      }
    }
    for (const q of re) for (const s of spanOf(q)) if (tBlocked[q.teacherId]?.has(s))
      hard.push(`${q.teacherName} ${slotZh(s)} 是不排課時段，卻排了 ${q.classLabel} ${q.subject}`)
    const hm = config.weights.builtin.homeroomDailyMax
    for (const g of GRADES) for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const ck = `${g}-${i}`, teach = teachOf.get(ck) ?? new Set<string>()
      const cm = cx.get(ck) ?? new Map<string, PlacedResult>(), locks = lockOf(ck)
      for (const s of Array.from(mustFillOf[ck] ?? [])) {
        if (!teach.has(s) || cm.has(s) || locks[s]) continue
        must.push(`${ckZh(ck)} ${slotZh(s)} 是導師不排課時段，卻沒有科任課`)
      }
      for (const s of Array.from(mustLeaveOf[ck] ?? [])) if (cm.has(s))
        must.push(`${ckZh(ck)} ${slotZh(s)} 是導師排課標記格，卻排了 ${cm.get(s)!.subject}`)
      // 導師連堂位（和引擎同一條必須級）
      const nd = engineInput.homeroomDoubleNeed?.[ck]
      if (nd?.pairs) {
        const taken = new Set<string>()
        for (const q of live) if (q.classKey === ck) for (const s2 of spanOf(q)) taken.add(s2)
        const blank = new Set((engineInput.classSlots[ck] ?? []).filter(x => !taken.has(x)))
        let pairs = 0
        for (const d of SCHEDULE_DAYS) for (const half of [[1, 2, 3, 4], [5, 6, 7]]) {
          let run = 0
          for (const q of [...half, 0]) { if (q && blank.has(`${d}-${q}`)) run++; else { pairs += Math.floor(run / 2); run = 0 } }
        }
        if (pairs < nd.pairs) must.push(`${ckZh(ck)} 導師自上 ${nd.note}，卻沒有任何一組連續兩格留白`)
      }
      for (const d of SCHEDULE_DAYS) {
        const day = Array.from(teach).filter(x => x.startsWith(`${d}-`))
        if (!day.length) continue
        const n = day.filter(x => !locks[x] && !cm.has(x)).length
        const cap = bandOf(g) === 'low' && day.some(x => Number(x.split('-')[1]) > 4) ? Math.max(hm.hardN, hm.hardFullDayLowN) : hm.hardN
        if (n === 0) must.push(`${ckZh(ck)} 週${DAY_ZH[d]} 導師整天沒課`)
        else if (n > cap) must.push(`${ckZh(ck)} 週${DAY_ZH[d]} 導師 ${n} 節，超過絕對上限 ${cap}`)
      }
    }
    void hx
    return { must: Array.from(new Set(must)), hard: Array.from(new Set(hard)) }
  }
  const baseIssues = useMemo(() => computeIssues(placed0, hr0), [placed0, hr0, config, classCounts])
  const issues = useMemo(() => {
    const now = computeIssues(placed, hr)
    const wm = new Set(baseIssues.must), wh = new Set(baseIssues.hard)
    return { must: now.must.filter(x => !wm.has(x)), hard: now.hard.filter(x => !wh.has(x)) }
  }, [placed, hr, baseIssues, config, classCounts])
  const issueCount = issues.must.length + issues.hard.length
  const canApply = moves.length > 0 && pending.length === 0 && !roomPick

  function apply() {
    if (issueCount > 0) {
      const list = (t: string, a: string[]) => a.length
        ? `${t}（${a.length}）\n` + a.slice(0, 8).map(x => `・${x}`).join('\n') + (a.length > 8 ? `\n・…另外 ${a.length - 8} 筆` : '') + '\n\n' : ''
      if (!confirm(`這 ${moves.length} 步調動會違反以下規則：\n\n${list('必須級', issues.must)}${list('硬限制', issues.hard)}系統不會阻止（人工調課權力最大），仍要套用嗎？`)) return
    }
    onApply({ placed, hr, moves: moves.map(m => ({ classKey: m.cls, from: m.from, to: m.to, what: m.what })) })
  }

  if (!open || !seed) return null

  /* ── 一張課表 ── */
  function Grid({ b }: { b: Board }) {
    const isClass = b.kind === 'class'
    const ck = isClass ? b.classKey : ''
    const g = isClass ? Number(ck.split('-')[0]) : 0
    const periods = isClass ? config.bands[bandOf(g)].periodsPerDay : maxPeriods
    const title = isClass ? `${ckZh(ck)}　導師 ${nameOf(config.classTeacher[ck] ?? '')}`
      : b.kind === 'teacher' ? `${nameOf(b.teacherId)}　教師課表`
      : `${roomById.get(b.roomId)?.label ?? '教室'}　教室課表`
    const mine = moves.filter(m => bKey(m.board) === bKey(b))
    const at = (s: string) => {
      const [d, p] = s.split('-').map(Number)
      return { x: LW + (d - 1) * CW + CW / 2, y: HH + (p - 1) * CH + CH / 2 }
    }
    const waiting = pending.some(x => bKey(x.board) === bKey(b))
    return (
      <div className="border border-zinc-200 rounded-sm bg-white">
        <div className="px-2 py-1 text-xs font-medium text-zinc-700 bg-zinc-50 border-b border-zinc-200 flex items-center gap-2">
          <span>{title}</span>
          {waiting && <span className="text-[10px] px-1 rounded-sm bg-rose-100 text-rose-700">有課待安置</span>}
          <button onClick={() => setBoards(bs => bs.filter(x => bKey(x) !== bKey(b)))}
            className="ml-auto text-zinc-400 hover:text-zinc-600 text-[11px]" title="收起這張課表">✕</button>
        </div>
        <div className="relative p-1" style={{ width: LW + 5 * CW + 8 }}>
          <div className="grid" style={{ gridTemplateColumns: `${LW}px repeat(5, ${CW}px)` }}>
            <div style={{ height: HH }} />
            {SCHEDULE_DAYS.map(d => <div key={d} className="text-zinc-500 text-center" style={{ height: HH, lineHeight: `${HH}px`, fontSize: FS }}>{DAY_LABEL[d]}</div>)}
            {Array.from({ length: periods }, (_, i) => i + 1).map(p => (
              <div key={p} className="contents">
                <div className="text-zinc-400 text-center" style={{ height: CH, lineHeight: `${CH}px`, fontSize: FS }}>{p}</div>
                {SCHEDULE_DAYS.map(d => <Cell key={d} slot={`${d}-${p}`} b={b} />)}
              </div>
            ))}
          </div>
          {mine.length > 0 && (
            <svg className="absolute inset-0 pointer-events-none" style={{ width: LW + 5 * CW + 8, height: HH + periods * CH + 8 }}>
              <defs><marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#e11d48" /></marker></defs>
              {mine.map(m => {
                const a = at(m.from), z = at(m.to)
                return (
                  <g key={m.n}>
                    <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke="#e11d48" strokeWidth="1.6" markerEnd="url(#ah)" opacity="0.85" />
                    <circle cx={a.x} cy={a.y} r={8 * scale} fill="#e11d48" />
                    <text x={a.x} y={a.y + 3.5 * scale} textAnchor="middle" fontSize={10 * scale} fill="#fff">{m.n}</text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>
    )
  }

  function Cell({ slot, b }: { slot: string; b: Board }) {
    const isClass = b.kind === 'class'
    const ck = isClass ? b.classKey : ''
    const l = isClass ? dClass.get(ck)?.get(slot)
      : b.kind === 'teacher' ? dTeacher.get(b.teacherId)?.get(slot)
      : dRoom.get(b.roomId)?.get(slot)
    const ex = b.kind === 'teacher' && !l ? (extraByTeacher.get(b.teacherId) ?? []).find(x => x.slot === slot) : undefined
    const sub = isClass ? hr0[ck]?.cells?.[slot] : undefined
    const item: Item | null = l ? { kind: 'lesson', id: l.id } : (sub && isClass ? { kind: 'hr', classKey: ck, slot } : null)
    const lock = isClass ? lockOf(ck)[slot] : undefined
    const frozen = isClass
      ? (!teachOf.get(ck)?.has(slot) ? '非可排課時段' : lock ? `鎖課：${lockTypeMap[lock]?.label ?? ''}` : null)
      : b.kind === 'room' ? null
      : (ex ? `固定課：${ex.main}（${ex.sub}）` : null)
    const tOff = b.kind === 'teacher' && tBlocked[b.teacherId]?.has(slot)

    const picked = Boolean(pick && item && iKey(pick.item) === iKey(item) && bKey(pick.board) === bKey(b))
    const arrowOut = item ? moves.some(m => iKey(m.item) === iKey(item) && bKey(m.board) === bKey(b)) : false
    const arrowIn = moves.some(m => bKey(m.board) === bKey(b) && m.to === slot)
    const isPending = item ? pending.some(x => iKey(x.item) === iKey(item)) : false
    const tgt = !frozen && !tOff ? targetOf(b, slot) : null

    // 教室全滿等你選一個讓出來：那幾間教室在那幾格的使用者就是候選
    const roomCand = Boolean(roomPick && b.kind === 'room' && roomPick.roomIds.includes(b.roomId)
      && roomPick.slots.includes(slot) && l)
    let tone = 'bg-white border-zinc-200 text-zinc-400'
    if (frozen) tone = 'bg-amber-50 border-amber-200 text-amber-700'
    else if (tOff) tone = 'bg-rose-50 border-rose-200 border-dashed text-rose-300'
    else if (l) tone = 'bg-sky-50 border-sky-200 text-sky-900'
    else if (sub) tone = fillOpen ? 'bg-emerald-50/60 border-emerald-200 text-emerald-700/70' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
    if (isPending) tone = 'bg-rose-100 border-rose-300 text-rose-900'
    else if (arrowOut) tone += ' opacity-45 line-through decoration-rose-400'
    const ring = roomCand ? ' ring-2 ring-orange-500 z-10'
      : picked ? ' ring-2 ring-rose-500 z-10'
      : arrowIn ? ' ring-2 ring-rose-400 z-10'
      : tgt?.ok ? ' ring-1 ring-emerald-400' : ''

    const hasArrow = arrowOut || arrowIn
    // picked＝再點一次取消；item＝改選別堂課。原本兩者都被 `!pick` 擋掉，選中之後整張課表就點不動了
    const clickable = Boolean(roomCand || (!frozen && !tOff && !roomPick
      && (hasArrow || picked || tgt?.ok || (item && (item.kind !== 'hr' || !fillOpen)))))
    const title = roomCand ? '點一下請這一班讓出教室' : frozen ?? (tOff ? '不排課時段'
      : hasArrow ? '點一下取消這一步'
      : tgt ? tgt.why
      : item ? `${labelOf(item).what}（${labelOf(item).who}）` : '空格')

    function onClick() {
      if (!clickable) return
      if (roomCand && l && roomPick) {
        // 選定讓出教室的那一班：它變成待安置，接著到那位老師的課表上找新位置
        setHistory(h => [...h, snap()])
        setPlaced(ps => ps.map(x => x.id === l.id ? { ...x, day: 0, period: 0 } : x))
        setPending(ps => [...ps.filter(x => iKey(x.item) !== `l:${l.id}`),
          { item: { kind: 'lesson', id: l.id }, step: roomPick.step, board: { kind: 'teacher', teacherId: l.teacherId },
            why: `${roomPick.subject} 的教室都滿了，這一班讓出教室` }])
        setBoards(bs => addBoard(bs, { kind: 'teacher', teacherId: l.teacherId }))
        setPick({ item: { kind: 'lesson', id: l.id }, board: { kind: 'teacher', teacherId: l.teacherId }, slot: displaySlot({ kind: 'lesson', id: l.id }) })
        setRoomPick(null)
        return
      }
      const m = moves.find(x => bKey(x.board) === bKey(b) && ((item && iKey(x.item) === iKey(item)) || x.to === slot))
      if (m) { undoMove(m); return }
      if (picked) { setPick(null); return }
      if (pick && tgt?.ok) { draw(b, slot); return }
      // 不是合法目標又有課＝改選這一堂（換別班時最常用）
      if (item && (item.kind !== 'hr' || !fillOpen)) {
        setPick({ item, board: b, slot })
        // 需要專科教室的課：把它現在用的那間教室也帶出來，看得到哪幾節還有位子
        const rid = item.kind === 'lesson' ? dById.get(item.id)?.roomId : undefined
        if (rid) setBoards(bs => addBoard(bs, { kind: 'room', roomId: rid }))
      }
    }

    return (
      <button onClick={onClick} title={title} disabled={!clickable}
        className={`relative leading-tight w-full overflow-hidden flex flex-col items-center justify-center border ${tone}${ring} ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ height: CH, fontSize: FS }}>
        {isClass && mustFillOf[ck]?.has(slot) && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-400/70 pointer-events-none" />}
        {frozen ? <span className="opacity-70 truncate w-full text-center px-0.5">{ex ? ex.main : frozen.startsWith('鎖課') ? frozen.slice(3) : ''}</span>
          : l ? (<>
            <span className="font-medium truncate w-full text-center px-0.5">{b.kind === 'room' ? l.classLabel : l.subject}</span>
            <span className="opacity-70 truncate w-full text-center px-0.5">{isClass ? l.teacherName : b.kind === 'room' ? l.teacherName : l.classLabel}</span>
          </>)
          : sub ? <span className="truncate w-full text-center px-0.5">{sub}</span> : null}
      </button>
    )
  }

  const pickedLesson = pick?.item.kind === 'lesson' ? dById.get(pick.item.id) : undefined

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center p-3" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-zinc-50 rounded-sm shadow-xl w-full max-w-[1800px] flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-zinc-200 bg-white flex items-center gap-3 flex-none">
          <span className="font-medium text-sm">連鎖調課</span>
          <span className="text-xs text-zinc-500">
            點一堂課 → 再點<b>這張課表上的空位</b>（綠框）。畫面只畫箭頭，課要按「套用」才真的動；有衝突時下一張課表才會出現。
          </span>
          <span className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] text-zinc-500 mr-1" title="調到順手之後會記在這台電腦，之後每次開都一樣">
              <span>大小</span>
              <select value={scale} onChange={e => saveLayout({ scale: Number(e.target.value) })}
                className="input py-0 px-1 text-[11px] w-14">
                {SCALES.map(x => <option key={x} value={x}>{Math.round(x * 100)}%</option>)}
              </select>
              <span className="ml-1">每排</span>
              <select value={perRow} onChange={e => saveLayout({ perRow: Number(e.target.value) })}
                className="input py-0 px-1 text-[11px] w-14">
                {PER_ROWS.map(x => <option key={x} value={x}>{x === 0 ? '自動' : `${x} 張`}</option>)}
              </select>
            </span>
            <button onClick={undo} disabled={!history.length} className="btn-ghost text-xs disabled:opacity-40">← 退回一步</button>
            <button onClick={onClose} className="btn-ghost text-xs">全部取消</button>
            {roomPick && (
              <span className="text-xs text-orange-600">請在教室課表上點一班讓出教室</span>
            )}
            {!roomPick && pending.length > 0 && (
              <span className="text-xs text-rose-600">還有 {pending.length} 堂課沒安置，安置完才能套用</span>
            )}
            <button onClick={apply} disabled={!canApply} className="btn text-xs disabled:opacity-40"
              title={!moves.length ? '還沒有任何調動' : pending.length ? `還有 ${pending.length} 堂課沒安置` : '套用這些調動'}>
              套用 {moves.length ? `（${moves.length} 步）` : ''}
            </button>
          </span>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto p-3">
            <div className={perRow ? 'grid gap-3 items-start justify-start' : 'flex flex-wrap gap-3 items-start'}
              style={perRow ? { gridTemplateColumns: `repeat(${perRow}, max-content)` } : undefined}>
              {boards.map(b => <Grid key={bKey(b)} b={b} />)}
            </div>
          </div>

          <div className="w-80 flex-none border-l border-zinc-200 bg-white overflow-auto p-3 text-xs space-y-4">
            <div>
              <div className="font-medium text-zinc-700 mb-1">調動步驟</div>
              {moves.length === 0 && <p className="text-zinc-400">還沒有調動。</p>}
              <ol className="space-y-1">
                {moves.map(m => (
                  <li key={m.n} className="flex gap-2">
                    <span className="flex-none w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] flex items-center justify-center mt-0.5">{m.n}</span>
                    <span className="text-zinc-600">
                      <span className="text-zinc-400">{m.board.kind === 'teacher' ? `${nameOf(m.board.teacherId)} 課表`
                        : m.board.kind === 'room' ? `${roomById.get(m.board.roomId)?.label ?? '教室'} 課表`
                        : `${ckZh(m.board.classKey)} 課表`}</span><br />
                      <span className="font-medium text-zinc-800">{m.what}</span>
                      <span className="text-zinc-400">（{m.who}・{ckZh(m.cls)}）</span><br />
                      {slotZh(m.from)} → {slotZh(m.to)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {roomPick && (
              <div className="px-1.5 py-1 rounded-sm border border-orange-300 bg-orange-50 text-orange-800">
                <div className="font-medium">{roomPick.subject} 的教室都滿了</div>
                <p>{roomPick.slots.map(slotZh).join('、')} 這幾間教室都有課。請在下面的教室課表上，
                  點一班請他讓出教室——那一班會變成待安置，接著幫他找新位置。</p>
              </div>
            )}

            {pick && !roomPick && (
              <div>
                <div className="font-medium text-zinc-700 mb-1">目前選中</div>
                <p className="text-zinc-700">{labelOf(pick.item).what}<span className="text-zinc-400">（{labelOf(pick.item).who}・{ckZh(classOfItem(pick.item))}）</span></p>
                <p className="text-zinc-400">
                  在「{pick.board.kind === 'teacher' ? `${nameOf(pick.board.teacherId)} 課表`
                    : pick.board.kind === 'room' ? `${roomById.get(pick.board.roomId)?.label ?? '教室'} 課表`
                    : `${ckZh(pick.board.classKey)} 課表`}」上點一個綠框的位置。
                </p>
                {pickedLesson && pickedLesson.size === 2 && pickedLesson.parity === 'weekly' && (
                  <button onClick={splitPicked} className="btn btn-secondary text-xs py-0.5 mt-1"
                    title="拆成兩個單節之後就能分開搬——例如社會 2 連堂＋1 單節，想改成 1 單節＋2 連堂">✂ 拆成兩個單節</button>
                )}
              </div>
            )}

            {hrDouble.length > 0 && (
              <div>
                <div className="font-medium text-zinc-700 mb-1">導師連堂位</div>
                <ul className="space-y-1">
                  {hrDouble.map(x => (
                    <li key={x.ck} className={`px-1.5 py-1 rounded-sm border ${x.pairs < x.need
                      ? 'bg-rose-50 border-rose-300 text-rose-800'
                      : x.pairs <= x.need ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-zinc-200 text-zinc-600'}`}>
                      {ckZh(x.ck)}　{x.note}
                      <br />
                      <span className="font-medium">剩 {x.pairs} 組</span>
                      <span className="opacity-70">（至少要 {x.need} 組）</span>
                      {x.pairs < x.need && <span className="block">✕ 這堂連堂已經沒地方上了</span>}
                      {x.biweekly && <span className="block opacity-70">這班有單雙週課，那一組佔住兩格，導師只有一週用得到</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-zinc-400">導師自上的連堂需要「同半天連續兩格留白」。科任課把留白切散就湊不出來。</p>
              </div>
            )}

            {pending.length > 0 && (
              <div>
                <div className="font-medium text-rose-700 mb-1">待安置（{pending.length}）</div>
                {pending.length >= 5 && (
                  <p className="mb-1 px-1.5 py-1 rounded-sm bg-amber-50 border border-amber-200 text-amber-800">
                    連鎖已經擴散到 {pending.length} 堂課。通常代表某一步的方向不對，退回重選會比繼續往下接快。
                  </p>
                )}
                {Array.from(new Set(pending.map(p => p.step))).sort((a, b) => a - b).map(step => (
                  <div key={step} className="mb-1.5">
                    <div className="text-zinc-400 mb-0.5">
                      {step ? `由步驟 ${step} 造成` : '起始'}
                    </div>
                    <ul className="space-y-1">
                      {pending.filter(p => p.step === step).map(p => {
                        const lb = labelOf(p.item)
                        const on = Boolean(pick && iKey(pick.item) === iKey(p.item))
                        const opts = optionsFor(p)
                        return (
                          <li key={iKey(p.item)}>
                            <button onClick={() => { setBoards(bs => addBoard(bs, p.board)); setPick({ item: p.item, board: p.board, slot: displaySlot(p.item) }) }}
                              className={`w-full text-left px-1.5 py-1 rounded-sm border ${on ? 'bg-rose-600 text-white border-rose-600'
                                : opts === 0 ? 'bg-red-100 text-red-900 border-red-400' : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'}`}>
                              {lb.what}<span className={on ? 'text-rose-100' : 'text-rose-500'}>（{lb.who}・{ckZh(classOfItem(p.item))}）</span>
                              <br /><span className={on ? 'text-rose-200' : 'text-rose-400'}>{p.why}</span>
                              <br />
                              {opts === 0
                                ? <span className="font-medium">✕ 這堂課現在無處可去{step ? `——請退回步驟 ${step}` : ''}</span>
                                : <span className={on ? 'text-rose-200' : 'text-zinc-500'}>可去的位置 {opts} 個</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div>
              <div className="font-medium text-zinc-700 mb-1">這次調動新造成的違規{issueCount ? `（${issueCount}）` : ''}</div>
              {issueCount === 0 ? <p className="text-green-700">目前沒有偵測到違規。</p> : (
                <div className="space-y-2">
                  {issues.must.length > 0 && (
                    <div>
                      <div className="text-rose-700 font-medium">必須級（{issues.must.length}）</div>
                      <ul className="space-y-0.5 text-rose-800">{issues.must.slice(0, 12).map((x, i) => <li key={i}>・{x}</li>)}</ul>
                    </div>
                  )}
                  {issues.hard.length > 0 && (
                    <div>
                      <div className="text-amber-700 font-medium">硬限制（{issues.hard.length}）</div>
                      <ul className="space-y-0.5 text-amber-800">{issues.hard.slice(0, 12).map((x, i) => <li key={i}>・{x}</li>)}</ul>
                    </div>
                  )}
                  <p className="text-zinc-500">系統不阻止，套用前會再確認一次。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
