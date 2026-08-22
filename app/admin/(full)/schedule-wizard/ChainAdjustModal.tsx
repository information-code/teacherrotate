'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES } from '@/lib/allocation'
import { roomsFromConfig, reassignRooms, type PlacedResult, type EngineInput } from '@/lib/schedule-engine'
import type { HomeroomRow } from './OverviewAdjust'

/* ────────────────────────────────────────────────────────────────────────────
   連鎖調課：課務組人工排課的作法搬上畫面。
   選一個「不妥位置」→ 選一個「妥適位置」→ 拉出一支單向箭頭（＝這堂課搬過去）。
   被擠掉的課成為下一個不妥位置，再拉一支箭頭，直到某一步搬進空格為止，最後一次套用。
   鎖課與非可排課時段絕對不能碰；其餘硬限制擋不住人工（會在套用前列出來，但不阻止）。
   ──────────────────────────────────────────────────────────────────────────── */

export type ChainSeed = { kind: 'class'; classKey: string } | { kind: 'teacher'; teacherId: string }

type Item = { kind: 'lesson'; id: string } | { kind: 'hr'; classKey: string; slot: string }
type Board = { kind: 'class'; classKey: string } | { kind: 'teacher'; teacherId: string }
type Move = { n: number; classKey: string; from: string; to: string; what: string; who: string; item: Item; h: number }   // h＝這一步之前的 history 索引
type Pending = { item: Item; classKey: string; why: string; subject?: string }   // subject：導師課被擠出時要記住科目（導師課只是字串）
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
  fillOpen: boolean               // 導師填課開放中 → 導師課唯讀
  onClose: () => void
  onApply: (next: { placed: PlacedResult[]; hr: Record<string, HomeroomRow>; moves: Move[] }) => void
}

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const slotZh = (s: string) => { const [d, p] = s.split('-'); return `週${DAY_ZH[Number(d)]}第${p}節` }
const boardKey = (b: Board) => b.kind === 'class' ? `c:${b.classKey}` : `t:${b.teacherId}`
const itemKey = (i: Item) => i.kind === 'lesson' ? `l:${i.id}` : `h:${i.classKey}|${i.slot}`

const CELL_W = 92, CELL_H = 42, HEAD_H = 24, LABEL_W = 40

export default function ChainAdjustModal({
  open, seed, placed: placed0, hr: hr0, config, classCounts, teacherNames, engineInput, fillOpen, onClose, onApply,
}: Props) {
  const [placed, setPlaced] = useState<PlacedResult[]>(placed0)
  const [hr, setHr] = useState<Record<string, HomeroomRow>>(hr0)
  const [moves, setMoves] = useState<Move[]>([])
  const [boards, setBoards] = useState<Board[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [pick, setPick] = useState<{ item: Item; classKey: string; slot: string } | null>(null)
  const [splitIds, setSplitIds] = useState<string[]>([])   // 已拆成兩個單節的連堂
  const [history, setHistory] = useState<Snap[]>([])
  const [booted, setBooted] = useState<string>('')

  const nameOf = (id: string) => teacherNames[id] ?? '？'

  // 開啟時（或換一張起始課表時）重置
  const seedKey = seed ? boardKey(seed as Board) : ''
  if (open && seedKey && booted !== seedKey) {
    setPlaced(placed0); setHr(hr0); setMoves([]); setPending([]); setPick(null); setHistory([]); setSplitIds([])
    setBoards(seed ? [seed as Board] : [])
    setBooted(seedKey)
  }
  if (!open && booted) setBooted('')

  /* ── 顯示 vs 模擬 ──
     畫面永遠畫「原始課表＋箭頭」：課務組是在紙上標記，真正的移動等按下套用。
     背後另外維護一份模擬（placed / hr），只用來算連鎖、待安置與違規。 */
  const splitOf = (l: PlacedResult): PlacedResult[] => ([
    { ...l, id: `${l.id}~a`, size: 1 },
    { ...l, id: `${l.id}~b`, size: 1, period: l.period + 1 },
  ])
  const dPlaced = useMemo(() => {
    const set = new Set(splitIds)
    return placed0.flatMap(l => set.has(l.id) ? splitOf(l) : [l])
  }, [placed0, splitIds])
  const cellsD = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const q of dPlaced) {
      if (q.day < 1) continue
      const cm = m.get(q.classKey) ?? new Map<string, PlacedResult>()
      for (const s2 of (q.size === 2 ? [`${q.day}-${q.period}`, `${q.day}-${q.period + 1}`] : [`${q.day}-${q.period}`])) cm.set(s2, q)
      m.set(q.classKey, cm)
    }
    return m
  }, [dPlaced])
  const cellsDByTeacher = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult[]>>()
    for (const q of dPlaced) for (const tid of (q.day < 1 ? [] : [q.teacherId, ...(q.coTeacherId ? [q.coTeacherId] : [])])) {
      const tm = m.get(tid) ?? new Map<string, PlacedResult[]>()
      for (const s2 of (q.size === 2 ? [`${q.day}-${q.period}`, `${q.day}-${q.period + 1}`] : [`${q.day}-${q.period}`])) tm.set(s2, [...(tm.get(s2) ?? []), q])
      m.set(tid, tm)
    }
    return m
  }, [dPlaced])
  /** 這個項目畫在課表上的哪一格（顯示位置，不是模擬後的位置）。 */
  const displaySlot = (i: Item): string => {
    if (i.kind === 'hr') return i.slot
    const q = dPlaced.find(x => x.id === i.id)
    return q && q.day > 0 ? `${q.day}-${q.period}` : ''
  }

  /* ── 由目前工作副本推導出來的索引 ── */
  const lessonById = useMemo(() => new Map(placed.map(p => [p.id, p])), [placed])
  const slotsOf = (l: PlacedResult) => l.size === 2 ? [`${l.day}-${l.period}`, `${l.day}-${l.period + 1}`] : [`${l.day}-${l.period}`]
  const cellsByClass = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const p of placed) {
      if (p.day < 1) continue   // 待安置：暫時放在格子外
      const cm = m.get(p.classKey) ?? new Map<string, PlacedResult>()
      for (const s of slotsOf(p)) cm.set(s, p)
      m.set(p.classKey, cm)
    }
    return m
  }, [placed])
  const cellsByTeacher = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult[]>>()
    for (const p of placed) for (const tid of (p.day < 1 ? [] : [p.teacherId, ...(p.coTeacherId ? [p.coTeacherId] : [])])) {
      const tm = m.get(tid) ?? new Map<string, PlacedResult[]>()
      for (const s of slotsOf(p)) tm.set(s, [...(tm.get(s) ?? []), p])
      m.set(tid, tm)
    }
    return m
  }, [placed])
  const lockOf = (ck: string) => config.lockCells[ck] ?? {}
  const lockTypeMap = useMemo(() => Object.fromEntries(config.lockTypes.map(t => [t.id, t])), [config])
  const teachableOf = useMemo(() => {
    const f = (ck: string) => {
      const grid = config.bands[bandOf(Number(ck.split('-')[0]))]
      const out = new Set<string>()
      for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) if (grid.teachable[`${d}-${p}`]) out.add(`${d}-${p}`)
      return out
    }
    const m = new Map<string, Set<string>>()
    for (const g of GRADES) for (let i = 0; i < (classCounts[g] ?? 0); i++) m.set(`${g}-${i}`, f(`${g}-${i}`))
    return m
  }, [config, classCounts])
  const teacherBlocked = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode === 'on') continue
      const set = (m[p.teacherId] ??= new Set())
      for (const s of p.slots) set.add(s)
    }
    return m
  }, [config])
  // 各班必留導師格（該班導師的個人「排課標記」：科任課不可放）
  const mustLeaveOf = useMemo(() => {
    const on: Record<string, Set<string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode !== 'on') continue
      const set = (on[p.teacherId] ??= new Set())
      for (const s2 of p.slots) set.add(s2)
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
        const key = `${g}-${i}`
        const set = new Set<string>(gradeOff)
        const hid = config.classTeacher[key]
        if (hid) for (const s of Array.from(teacherBlocked[hid] ?? [])) set.add(s)
        m[key] = set
      }
    }
    return m
  }, [config, classCounts, teacherBlocked])
  const maxPeriods = useMemo(() => Math.max(...Object.values(config.bands).map(b => b.periodsPerDay)), [config])

  /* ── 一格能不能碰 ── */
  /** 鎖課與非可排課時段：絕對不能當來源、也不能當目標（顯示成灰／琥珀，點不下去）。 */
  function frozenCell(ck: string, slot: string): string | null {
    if (!teachableOf.get(ck)?.has(slot)) return '非可排課時段'
    const t = lockOf(ck)[slot]
    if (t) return `鎖課：${lockTypeMap[t]?.label ?? ''}`
    return null
  }

  const itemAt = (ck: string, slot: string): Item | null => {
    const l = cellsByClass.get(ck)?.get(slot)
    if (l) return { kind: 'lesson', id: l.id }
    if (hr[ck]?.cells?.[slot]) return { kind: 'hr', classKey: ck, slot }
    return null
  }
  const itemLabel = (i: Item): { what: string; who: string } => {
    if (i.kind === 'lesson') {
      const l = lessonById.get(i.id)
      return l ? { what: l.subject, who: l.teacherName } : { what: '？', who: '' }
    }
    const sub = hr[i.classKey]?.cells?.[i.slot] ?? pending.find(x => itemKey(x.item) === itemKey(i))?.subject
    return { what: sub ?? '導師課', who: nameOf(config.classTeacher[i.classKey] ?? '') }
  }

  /* ── 搬一堂課 ── */
  function snap(): Snap {
    return { placed, hr, moves, boards, pending, splitIds }
  }
  function addBoard(bs: Board[], b: Board) {
    return bs.some(x => boardKey(x) === boardKey(b)) ? bs : [...bs, b]
  }
  /** 這張課表還有沒有留下來的理由：起始那張、有箭頭的、有課待安置的都要留；
   *  純粹因為「點過一堂課」才打開的，換個目標就該收掉，不然畫面很快就塞滿看過即棄的課表。 */
  function keepBoard(b: Board) {
    if (seed && boardKey(b) === boardKey(seed as Board)) return true
    if (b.kind === 'teacher') {
      // 還有這位老師的課牽涉在內就留著，否則收掉
      return moves.some(m => m.item.kind === 'lesson' && dPlaced.find(x => x.id === (m.item as { id: string }).id)?.teacherId === b.teacherId)
        || pending.some(x => x.item.kind === 'lesson' && dPlaced.find(y => y.id === (x.item as { id: string }).id)?.teacherId === b.teacherId)
    }
    return moves.some(m => m.classKey === b.classKey) || pending.some(x => x.classKey === b.classKey)
  }

  /** 把 item 搬到 (ck, toSlot)。回傳新的狀態；被擠掉的課會成為新的不妥位置。 */
  function move(item: Item, ck: string, toSlot: string) {
    const at = item.kind === 'hr' ? item.slot : (() => { const q = lessonById.get(item.id); return q && q.day > 0 ? `${q.day}-${q.period}` : '' })()
    if (at === toSlot) { setPick(null); return }   // 搬到原位＝沒事發生
    const before = snap()
    let nextPlaced = [...placed]
    let nextHr = { ...hr }
    const newPending: Pending[] = []
    let nextBoards = [...boards]

    const targetSlots = (() => {
      if (item.kind === 'hr') return [toSlot]
      const l = lessonById.get(item.id)!
      const [d, p] = toSlot.split('-').map(Number)
      return l.size === 2 ? [`${d}-${p}`, `${d}-${p + 1}`] : [toSlot]
    })()
    const selfKey = itemKey(item)
    const myTeachers = item.kind === 'lesson'
      ? [lessonById.get(item.id)!.teacherId, ...(lessonById.get(item.id)!.coTeacherId ? [lessonById.get(item.id)!.coTeacherId!] : [])]
      : [config.classTeacher[item.classKey] ?? '']

    // 1) 同班該格已有東西 → 擠出來
    for (const s of targetSlots) {
      const occ = cellsByClass.get(ck)?.get(s)
      if (occ && itemKey({ kind: 'lesson', id: occ.id }) !== selfKey) {
        nextPlaced = nextPlaced.map(x => x.id === occ.id ? { ...x, day: 0, period: 0 } : x)   // 移到格子外＝待安置
        newPending.push({ item: { kind: 'lesson', id: occ.id }, classKey: ck, why: `被擠出 ${slotZh(s)}` })
      }
      const hrSub = nextHr[ck]?.cells?.[s]
      if (hrSub && `h:${ck}|${s}` !== selfKey) {
        const cells = { ...nextHr[ck].cells }; delete cells[s]
        nextHr = { ...nextHr, [ck]: { ...nextHr[ck], cells } }
        newPending.push({ item: { kind: 'hr', classKey: ck, slot: s }, classKey: ck, why: `導師課被擠出 ${slotZh(s)}`, subject: hrSub })
      }
    }
    // 2) 這位老師在別班的同時段有課 → 那一班也被影響
    for (const tid of myTeachers.filter(Boolean)) {
      for (const s of targetSlots) {
        for (const other of cellsByTeacher.get(tid)?.get(s) ?? []) {
          if (other.id === (item.kind === 'lesson' ? item.id : '')) continue
          if (other.classKey === ck) continue
          if (!nextPlaced.some(x => x.id === other.id && x.day > 0)) continue
          nextPlaced = nextPlaced.map(x => x.id === other.id ? { ...x, day: 0, period: 0 } : x)
          newPending.push({ item: { kind: 'lesson', id: other.id }, classKey: other.classKey, why: `${nameOf(tid)} 同時段在此班有課` })
          nextBoards = addBoard(nextBoards, { kind: 'class', classKey: other.classKey })
        }
      }
    }
    // 3) 把自己放到新位置
    const lbl = itemLabel(item)
    let fromSlot = displaySlot(item)
    if (item.kind === 'lesson') {
      const l = lessonById.get(item.id)!
      if (!fromSlot) fromSlot = `${l.day}-${l.period}`
      const [d, p] = toSlot.split('-').map(Number)
      nextPlaced = [...nextPlaced.filter(x => x.id !== l.id), { ...l, day: d, period: p }]
    } else {
      const cells = { ...(nextHr[item.classKey]?.cells ?? {}) }
      const sub = cells[item.slot] ?? pending.find(x => itemKey(x.item) === selfKey)?.subject ?? ''
      delete cells[item.slot]
      cells[toSlot] = sub
      nextHr = { ...nextHr, [item.classKey]: { ...nextHr[item.classKey], cells } }
    }

    setHistory(h => [...h, before])
    setPlaced(nextPlaced)
    setHr(nextHr)
    setBoards(addBoard(nextBoards, { kind: 'class', classKey: ck }))
    setMoves(m => [...m, { n: m.length + 1, classKey: ck, from: fromSlot, to: toSlot, what: lbl.what, who: lbl.who, item, h: history.length }])
    setPending(p => [...p.filter(x => itemKey(x.item) !== selfKey), ...newPending])
    setPick(null)
  }

  /** 把選中的連堂拆成兩個單節，之後可以分開搬（社會 2+1 想改成 1+2 就靠這個）。 */
  function splitPicked() {
    if (!pick || pick.item.kind !== 'lesson') return
    const pid = pick.item.id
    const l = dPlaced.find(x => x.id === pid)
    if (!l || l.size !== 2 || l.parity !== 'weekly') return
    setHistory(h => [...h, snap()])
    setSplitIds(ids => [...ids, l.id])
    setPlaced(ps => ps.flatMap(x => x.id === l.id ? splitOf(x) : [x]))
    setPending(ps => ps.filter(x => itemKey(x.item) !== `l:${pid}`))
    setPick({ item: { kind: 'lesson', id: `${l.id}~a` }, classKey: l.classKey, slot: `${l.day}-${l.period}` })
  }

  /** 退回某一支箭頭（點箭頭的任一端就會走到這裡）。它之後還有步驟的話，一起退掉。 */
  function undoMove(m: Move) {
    const later = moves.length - m.n
    if (later > 0 && !confirm(`第 ${m.n} 步之後還有 ${later} 步，會一起退回。確定嗎？`)) return
    const back = history[m.h]
    if (!back) return
    setPlaced(back.placed); setHr(back.hr); setMoves(back.moves); setBoards(back.boards); setPending(back.pending); setSplitIds(back.splitIds)
    setHistory(h => h.slice(0, m.h))
    setPick({ item: m.item, classKey: m.classKey, slot: m.from })
  }

  function undo() {
    const last = history[history.length - 1]
    if (!last) return
    const undone = moves[moves.length - 1]        // 被退回的那一步
    setPlaced(last.placed); setHr(last.hr); setMoves(last.moves); setBoards(last.boards); setPending(last.pending); setSplitIds(last.splitIds)
    setHistory(h => h.slice(0, -1))
    // 退回之後把那一步的來源重新選起來：多半是「位置選錯了想改點別的」，不該連選取一起清掉
    setPick(undone ? { item: undone.item, classKey: undone.classKey, slot: undone.from } : null)
  }

  /* ── 套用前檢查：擋不住人工，但要講清楚會破壞什麼 ──
     必須級＝課務組畫的紅線（不排課時段一定要有科任、導師不能整天沒課…）；
     硬限制＝物理上不該發生的（老師衝堂、教室撞班、排進老師的不排課時段）。
     只報「這次調動新造成的」：原本就有的違規不是課務組現在弄的，跳出來只會吵。 */
  function computeIssues(px: PlacedResult[], hx: Record<string, HomeroomRow>) {
    const must: string[] = []
    const hard: string[] = []
    const live = px.filter(x => x.day > 0)
    const ckZh = (ck: string) => classLabel(Number(ck.split('-')[0]), Number(ck.split('-')[1]))
    const rooms = roomsFromConfig(config)
    const re = reassignRooms(live, rooms, config.weights)
    const cellsX = new Map<string, Map<string, PlacedResult>>()
    for (const q of live) {
      const cm = cellsX.get(q.classKey) ?? new Map<string, PlacedResult>()
      for (const s2 of slotsOf(q)) cm.set(s2, q)
      cellsX.set(q.classKey, cm)
    }

    const seen = new Map<string, PlacedResult>()
    for (const q of re) for (const tid of [q.teacherId, ...(q.coTeacherId ? [q.coTeacherId] : [])]) {
      for (const s2 of slotsOf(q)) {
        const k = `${tid}|${s2}|${q.parity}`
        const prev = seen.get(k)
        if (prev && prev.id !== q.id) hard.push(`${nameOf(tid)} ${slotZh(s2)} 同時要上 ${prev.classLabel} 與 ${q.classLabel}`)
        seen.set(k, q)
      }
    }
    const rseen = new Map<string, PlacedResult>()
    for (const q of re) {
      if (!q.roomId) continue
      for (const s2 of slotsOf(q)) {
        const k = `${q.roomId}|${s2}|${q.parity}`
        const prev = rseen.get(k)
        if (prev && prev.id !== q.id) hard.push(`教室衝突 ${slotZh(s2)}：${prev.classLabel} 與 ${q.classLabel}`)
        rseen.set(k, q)
      }
    }
    for (const q of re) for (const s2 of slotsOf(q)) {
      if (teacherBlocked[q.teacherId]?.has(s2)) hard.push(`${q.teacherName} ${slotZh(s2)} 是不排課時段，卻排了 ${q.classLabel} ${q.subject}`)
    }

    const hm = config.weights.builtin.homeroomDailyMax
    for (const g of GRADES) for (let i2 = 0; i2 < (classCounts[g] ?? 0); i2++) {
      const ck = `${g}-${i2}`
      const teach = teachableOf.get(ck) ?? new Set<string>()
      const cm = cellsX.get(ck) ?? new Map<string, PlacedResult>()
      const locks = lockOf(ck)
      for (const s2 of Array.from(mustFillOf[ck] ?? [])) {
        if (!teach.has(s2)) continue
        if (cm.has(s2) || locks[s2]) continue
        must.push(`${ckZh(ck)} ${slotZh(s2)} 是導師不排課時段，卻沒有科任課`)
      }
      for (const s2 of Array.from(mustLeaveOf[ck] ?? [])) {
        if (cm.has(s2)) must.push(`${ckZh(ck)} ${slotZh(s2)} 是導師排課標記格，卻排了 ${cm.get(s2)!.subject}`)
      }
      for (const d of SCHEDULE_DAYS) {
        const daySlots = Array.from(teach).filter(x => x.startsWith(`${d}-`))
        if (!daySlots.length) continue
        const hrN = daySlots.filter(x => !locks[x] && !cm.has(x)).length
        const fullDay = daySlots.some(x => Number(x.split('-')[1]) > 4)
        const cap = bandOf(g) === 'low' && fullDay ? Math.max(hm.hardN, hm.hardFullDayLowN) : hm.hardN
        if (hrN === 0) must.push(`${ckZh(ck)} 週${DAY_ZH[d]} 導師整天沒課`)
        else if (hrN > cap) must.push(`${ckZh(ck)} 週${DAY_ZH[d]} 導師 ${hrN} 節，超過絕對上限 ${cap}`)
      }
    }
    void hx
    return { must: Array.from(new Set(must)), hard: Array.from(new Set(hard)) }
  }
  // 起點的違規（開啟 modal 當下）：拿來扣掉，只留新造成的
  const baseIssues = useMemo(() => computeIssues(placed0, hr0), [placed0, hr0, config, classCounts])
  const issues = useMemo(() => {
    const now = computeIssues(placed, hr)
    const wasMust = new Set(baseIssues.must), wasHard = new Set(baseIssues.hard)
    return { must: now.must.filter(x => !wasMust.has(x)), hard: now.hard.filter(x => !wasHard.has(x)) }
  }, [placed, hr, baseIssues, config, classCounts])
  const issueCount = issues.must.length + issues.hard.length

  if (!open || !seed) return null

  /* ── 一張課表 ── */
  function Grid({ b }: { b: Board }) {
    const isClass = b.kind === 'class'
    const ck = isClass ? b.classKey : ''
    const g = isClass ? Number(ck.split('-')[0]) : 0
    const periods = isClass ? config.bands[bandOf(g)].periodsPerDay : maxPeriods
    const title = isClass
      ? `${classLabel(g, Number(ck.split('-')[1]))}　導師 ${nameOf(config.classTeacher[ck] ?? '')}`
      : `${nameOf(b.teacherId)}　教師課表`
    const myMoves = isClass ? moves.filter(m => m.classKey === ck) : []
    const idx = (slot: string) => {
      const [d, p] = slot.split('-').map(Number)
      return { x: LABEL_W + (d - 1) * CELL_W + CELL_W / 2, y: HEAD_H + (p - 1) * CELL_H + CELL_H / 2 }
    }
    return (
      <div className="border border-zinc-200 rounded-sm bg-white">
        <div className="px-2 py-1 text-xs font-medium text-zinc-700 bg-zinc-50 border-b border-zinc-200 flex items-center gap-2">
          <span>{title}</span>
          {pending.some(p => p.classKey === ck) && <span className="text-[10px] px-1 rounded-sm bg-rose-100 text-rose-700">有待處理的課</span>}
          <button onClick={() => setBoards(bs => bs.filter(x => boardKey(x) !== boardKey(b)))}
            className="ml-auto text-zinc-400 hover:text-zinc-600 text-[11px]" title="收起這張課表（不影響已拉的箭頭）">✕</button>
        </div>
        <div className="relative p-1" style={{ width: LABEL_W + 5 * CELL_W + 8 }}>
          <div className="grid" style={{ gridTemplateColumns: `${LABEL_W}px repeat(5, ${CELL_W}px)` }}>
            <div style={{ height: HEAD_H }} />
            {SCHEDULE_DAYS.map(d => (
              <div key={d} className="text-[11px] text-zinc-500 text-center" style={{ height: HEAD_H, lineHeight: `${HEAD_H}px` }}>{DAY_LABEL[d]}</div>
            ))}
            {Array.from({ length: periods }, (_, i) => i + 1).map(p => (
              <Row key={p} p={p} b={b} ck={ck} />
            ))}
          </div>
          {myMoves.length > 0 && (
            <svg className="absolute inset-0 pointer-events-none" style={{ width: LABEL_W + 5 * CELL_W + 8, height: HEAD_H + periods * CELL_H + 8 }}>
              <defs>
                <marker id="ah" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="#e11d48" />
                </marker>
              </defs>
              {myMoves.map(m => {
                const a = idx(m.from), z = idx(m.to)
                return (
                  <g key={m.n}>
                    <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke="#e11d48" strokeWidth="1.6" markerEnd="url(#ah)" opacity="0.85" />
                    <circle cx={a.x} cy={a.y} r="8" fill="#e11d48" />
                    <text x={a.x} y={a.y + 3.5} textAnchor="middle" fontSize="10" fill="#fff">{m.n}</text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      </div>
    )
  }

  function Row({ p, b, ck }: { p: number; b: Board; ck: string }) {
    return (
      <>
        <div className="text-[11px] text-zinc-400 text-center" style={{ height: CELL_H, lineHeight: `${CELL_H}px` }}>{p}</div>
        {SCHEDULE_DAYS.map(d => <Cell key={d} slot={`${d}-${p}`} b={b} ck={ck} />)}
      </>
    )
  }

  function Cell({ slot, b, ck }: { slot: string; b: Board; ck: string }) {
    const isClass = b.kind === 'class'
    // 教師檢視：找出這位老師這一格的課（可能在任一班）
    const tLesson = !isClass ? (cellsDByTeacher.get(b.teacherId)?.get(slot) ?? [])[0] : undefined
    const cls = isClass ? ck : tLesson?.classKey ?? ''
    const frozen = isClass ? frozenCell(ck, slot) : (tLesson ? frozenCell(tLesson.classKey, slot) : null)
    const l = isClass ? cellsD.get(ck)?.get(slot) : tLesson
    const hrSub = isClass ? hr0[ck]?.cells?.[slot] : undefined
    const item: Item | null = l ? { kind: 'lesson', id: l.id } : (hrSub && isClass ? { kind: 'hr', classKey: ck, slot } : null)
    const picked = pick && item && itemKey(pick.item) === itemKey(item)
    // 箭頭狀態：這一格要搬走／有東西要搬進來／被擠掉還沒安置
    const goesOut = item ? moves.some(m => itemKey(m.item) === itemKey(item)) : false
    const comesIn = isClass && moves.some(m => m.classKey === ck && m.to === slot)
    const isPending = item ? pending.some(x => itemKey(x.item) === itemKey(item)) : false

    const mustFill = isClass && mustFillOf[ck]?.has(slot)

    // 教師檢視的不排課時段：絕對不可點
    const tOff = !isClass && teacherBlocked[b.teacherId]?.has(slot)

    // 目標可不可點：有選中來源、且這一格在來源那一班（或空著）
    let asTarget = false
    let targetWhy = ''
    if (pick && isClass && !frozen) {
      const canMoveHere = pick.classKey === ck && slot !== pick.slot
      if (canMoveHere) {
        asTarget = true
        if (l && itemKey({ kind: 'lesson', id: l.id }) !== itemKey(pick.item)) targetWhy = `標記搬到這裡（會擠掉 ${l.subject}）`
        else if (hrSub && !fillOpen) targetWhy = '標記搬到這裡（會擠掉導師課）'
        else if (hrSub && fillOpen) { asTarget = false; targetWhy = '導師填課開放中，導師課唯讀' }
        else targetWhy = '標記搬到這裡（空格）'
      }
    }

    const base = 'relative w-full text-[10.5px] leading-tight overflow-hidden flex flex-col items-center justify-center border'
    let tone = 'bg-white border-zinc-200 text-zinc-400'
    if (frozen) tone = 'bg-amber-50 border-amber-200 text-amber-700'
    else if (tOff) tone = 'bg-rose-50 border-rose-200 border-dashed text-rose-300'
    else if (l) tone = 'bg-sky-50 border-sky-200 text-sky-900'
    else if (hrSub) tone = fillOpen ? 'bg-emerald-50/60 border-emerald-200 text-emerald-700/70' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
    if (isPending) tone = 'bg-rose-100 border-rose-300 text-rose-900'
    else if (goesOut) tone += ' opacity-45 line-through decoration-rose-400'
    const ring = picked ? ' ring-2 ring-rose-500 z-10'
      : comesIn ? ' ring-2 ring-rose-400 z-10'
      : asTarget ? ' ring-1 ring-sky-400 cursor-pointer' : ''

    const hasArrow = goesOut || comesIn
    const clickable = Boolean(!frozen && !tOff && (hasArrow || asTarget || (item && (item.kind !== 'hr' || !fillOpen))))
    const title = frozen ?? (tOff ? '不排課時段'
      : hasArrow ? '點一下取消這一步'
      : targetWhy || (item ? `${itemLabel(item).what}（${itemLabel(item).who}）${mustFill ? '｜導師不排課時段' : ''}` : '空格'))

    function onClick() {
      if (!clickable) return
      // 點箭頭的任一端（要搬走的那格、或箭頭指到的那格）＝取消這一步，不必特地去按「退回一步」
      const mine = moves.find(m => (item && itemKey(m.item) === itemKey(item)) || (isClass && m.classKey === ck && m.to === slot))
      if (mine) { undoMove(mine); return }
      // 再點一次已選中的課＝取消選取。原本會被當成「搬到它現在的位置」，連點就一直記無效步驟
      if (pick && item && itemKey(item) === itemKey(pick.item)) { setPick(null); return }
      if (pick && asTarget) { move(pick.item, ck, slot); return }
      if (item) {
        setPick({ item, classKey: cls, slot })
        // 目標只能點在班級課表上，先把它打開；同時把該老師的課表也帶出來——
        // 要幫這堂課找新位置，得先看得到她哪幾節有空。看過即棄的課表順手收掉。
        const tid = item.kind === 'lesson' ? (dPlaced.find(x => x.id === item.id)?.teacherId ?? '') : (config.classTeacher[item.classKey] ?? '')
        setBoards(bs => {
          let next = bs.filter(keepBoard)
          if (cls) next = addBoard(next, { kind: 'class', classKey: cls })
          if (tid) next = addBoard(next, { kind: 'teacher', teacherId: tid })
          return next
        })
      }
    }

    return (
      <button onClick={onClick} title={title} disabled={!clickable}
        className={`${base} ${tone}${ring} ${clickable ? '' : 'cursor-default'}`}
        style={{ height: CELL_H }}>
        {mustFill && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-400/70 pointer-events-none" />}
        {frozen ? <span className="opacity-70">{frozen.startsWith('鎖課') ? frozen.slice(3) || '鎖課' : ''}</span>
          : l ? (<><span className="font-medium truncate w-full text-center px-0.5">{l.subject}</span>
            <span className="opacity-70 truncate w-full text-center px-0.5">{isClass ? l.teacherName : l.classLabel}</span></>)
            : hrSub ? <span className="truncate w-full text-center px-0.5">{hrSub}</span> : null}
      </button>
    )
  }

  const canApply = moves.length > 0 && pending.length === 0

  /** 套用：有違規先跳出來讓人看清楚，但確認後照樣套用——人工權力最大。 */
  function apply() {
    if (issueCount > 0) {
      const list = (title: string, arr: string[]) => arr.length
        ? `${title}（${arr.length}）\n` + arr.slice(0, 8).map(x => `・${x}`).join('\n') + (arr.length > 8 ? `\n・…另外 ${arr.length - 8} 筆` : '') + '\n\n'
        : ''
      const txt = `這 ${moves.length} 步調動會違反以下規則：\n\n`
        + list('必須級', issues.must) + list('硬限制', issues.hard)
        + '系統不會阻止（人工調課權力最大），仍要套用嗎？'
      if (!confirm(txt)) return
    }
    onApply({ placed, hr, moves })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch justify-center p-3" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-zinc-50 rounded-sm shadow-xl w-full max-w-[1800px] flex flex-col overflow-hidden">
        {/* 標題列 */}
        <div className="px-4 py-2 border-b border-zinc-200 bg-white flex items-center gap-3 flex-none">
          <span className="font-medium text-sm">連鎖調課</span>
          <span className="text-xs text-zinc-500">
            點一格不妥的課 → 再點想搬去的位置，畫面上只畫箭頭做標記，課要按「套用」才真的動。點箭頭兩端可取消該步；被擠掉的課列在右側，全部安置好才能套用。
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button onClick={undo} disabled={!history.length}
              className="btn-ghost text-xs disabled:opacity-40">← 退回一步</button>
            <button onClick={onClose} className="btn-ghost text-xs">全部取消</button>
            <button onClick={apply} disabled={!canApply}
              className="btn text-xs disabled:opacity-40"
              title={!moves.length ? '還沒有任何調動' : pending.length ? '還有課沒安置好' : '套用這些調動'}>
              套用 {moves.length ? `（${moves.length} 步）` : ''}
            </button>
          </span>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* 課表區 */}
          <div className="flex-1 overflow-auto p-3">
            <div className="flex flex-wrap gap-3 items-start">
              {boards.map(b => <Grid key={boardKey(b)} b={b} />)}
            </div>
            {!boards.length && <p className="text-xs text-zinc-500">沒有課表可顯示。</p>}
          </div>

          {/* 側欄：步驟、待處理、影響 */}
          <div className="w-80 flex-none border-l border-zinc-200 bg-white overflow-auto p-3 text-xs space-y-4">
            <div>
              <div className="font-medium text-zinc-700 mb-1">調動步驟</div>
              {moves.length === 0 && <p className="text-zinc-400">還沒有調動。</p>}
              <ol className="space-y-1">
                {moves.map(m => (
                  <li key={m.n} className="flex gap-2">
                    <span className="flex-none w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] flex items-center justify-center mt-0.5">{m.n}</span>
                    <span className="text-zinc-600">
                      {classLabel(Number(m.classKey.split('-')[0]), Number(m.classKey.split('-')[1]))}
                      <span className="font-medium text-zinc-800">{m.what}</span>
                      <span className="text-zinc-400">（{m.who}）</span><br />
                      {slotZh(m.from)} → {slotZh(m.to)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {pick && pick.item.kind === 'lesson' && (() => {
              const l = dPlaced.find(x => x.id === (pick.item as { id: string }).id)
              if (!l || l.size !== 2 || l.parity !== 'weekly') return null
              return (
                <div>
                  <div className="font-medium text-zinc-700 mb-1">選中的連堂</div>
                  <p className="text-zinc-500 mb-1">{l.classLabel} {l.subject}（{l.teacherName}）連續兩節。</p>
                  <button onClick={splitPicked} className="btn btn-secondary text-xs py-0.5"
                    title="拆成兩個單節之後就能分開搬——例如社會 2 連堂＋1 單節，想改成 1 單節＋2 連堂">✂ 拆成兩個單節</button>
                </div>
              )
            })()}

            {pending.length > 0 && (
              <div>
                <div className="font-medium text-rose-700 mb-1">待安置（{pending.length}）</div>
                <ul className="space-y-1">
                  {pending.map(p => {
                    const lb = itemLabel(p.item)
                    const on = pick && itemKey(pick.item) === itemKey(p.item)
                    return (
                      <li key={itemKey(p.item)}>
                        <button
                          onClick={() => {
                            setPick({ item: p.item, classKey: p.classKey, slot: displaySlot(p.item) })
                            const tid = p.item.kind === 'lesson'
                              ? (dPlaced.find(x => x.id === (p.item as { id: string }).id)?.teacherId ?? '')
                              : (config.classTeacher[p.classKey] ?? '')
                            setBoards(bs => {
                              let next = addBoard(bs.filter(keepBoard), { kind: 'class', classKey: p.classKey })
                              if (tid) next = addBoard(next, { kind: 'teacher', teacherId: tid })
                              return next
                            })
                          }}
                          className={`w-full text-left px-1.5 py-1 rounded-sm border ${on
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'}`}>
                          {classLabel(Number(p.classKey.split('-')[0]), Number(p.classKey.split('-')[1]))}　{lb.what}
                          <span className={on ? 'text-rose-100' : 'text-rose-500'}>（{lb.who}）</span>
                          <br /><span className={on ? 'text-rose-200' : 'text-rose-400'}>{p.why}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-1 text-zinc-400">點一下選它，再到課表上點想搬去的位置。</p>
              </div>
            )}

            <div>
              <div className="font-medium text-zinc-700 mb-1">
                這次調動新造成的違規{issueCount ? `（${issueCount}）` : ''}
              </div>
              {issueCount === 0
                ? <p className="text-green-700">目前沒有偵測到違規。</p>
                : (<div className="space-y-2">
                  {issues.must.length > 0 && (
                    <div>
                      <div className="text-rose-700 font-medium">必須級（{issues.must.length}）</div>
                      <ul className="space-y-0.5 text-rose-800">
                        {issues.must.slice(0, 12).map((x, i) => <li key={i}>・{x}</li>)}
                      </ul>
                      {issues.must.length > 12 && <p className="text-zinc-400">…另外 {issues.must.length - 12} 筆</p>}
                    </div>
                  )}
                  {issues.hard.length > 0 && (
                    <div>
                      <div className="text-amber-700 font-medium">硬限制（{issues.hard.length}）</div>
                      <ul className="space-y-0.5 text-amber-800">
                        {issues.hard.slice(0, 12).map((x, i) => <li key={i}>・{x}</li>)}
                      </ul>
                      {issues.hard.length > 12 && <p className="text-zinc-400">…另外 {issues.hard.length - 12} 筆</p>}
                    </div>
                  )}
                  <p className="text-zinc-500">系統不阻止，套用前會再確認一次。</p>
                </div>)}
            </div>

            <div className="pt-2 border-t border-zinc-100 text-zinc-400 leading-relaxed">
              <p>琥珀色＝鎖課、灰白＝非可排課時段，兩者都不能碰。</p>
              <p>左緣紅線＝導師不排課時段（這一格必須是科任課）。</p>
              {fillOpen && <p className="text-amber-700">導師填課開放中，導師課唯讀；要調整請先在上方「收回導師填課」。</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
