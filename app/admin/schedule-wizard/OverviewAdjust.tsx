'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import { roomsFromConfig, reassignRooms, type PlacedResult } from '@/lib/schedule-engine'

export interface HomeroomRow { class_key: string; teacher_id: string; cells: Record<string, string>; confirmed_at: string | null }

interface Props {
  year: number
  planStatus: string
  setPlanStatus: (s: string) => void
  savedPlan: Record<string, unknown>
  homeroomRows: HomeroomRow[]
  config: ScheduleConfig
  classCounts: Record<number, number>
  teacherNames: Record<string, string>
}

type Sel = { type: 'lesson'; id: string } | { type: 'hr'; classKey: string; slot: string } | null
interface Adjustment { at: string; desc: string; note?: string }

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const slotZh = (s: string) => { const [d, p] = s.split('-'); return `週${DAY_ZH[Number(d)]}第${p}節` }

/** 年級總覽＋調整模式（發布後）：
 *  防呆（灰燈硬擋）：鎖課、導師不排課格只能科任課、科任自身不排課、老師撞課（週型感知）、
 *  導師課不跨班。連堂可拆、上空上空不擋（老師自行協調的結果）。
 *  每步調整後教室自動重分配（管理教師優先），零警告。 */
export default function OverviewAdjust({ year, planStatus, setPlanStatus, savedPlan, homeroomRows, config, classCounts, teacherNames }: Props) {
  const [placed, setPlaced] = useState<PlacedResult[]>(() => (savedPlan.placed as PlacedResult[] | undefined) ?? [])
  const [hr, setHr] = useState<Record<string, HomeroomRow>>(() => Object.fromEntries(homeroomRows.map(r => [r.class_key, { ...r, cells: { ...r.cells } }])))
  const [adjustments, setAdjustments] = useState<Adjustment[]>(() => (savedPlan.adjustments as Adjustment[] | undefined) ?? [])
  const [undoStack, setUndoStack] = useState<{ placed: PlacedResult[]; hr: Record<string, HomeroomRow>; adjustments: Adjustment[] }[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [gradeSel, setGradeSel] = useState<number>(GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1)
  const [adjustMode, setAdjustMode] = useState(false)
  const [note, setNote] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [busy, setBusy] = useState(false)

  const rooms = useMemo(() => roomsFromConfig(config), [config])
  const nameOf = (id: string) => teacherNames[id] ?? '？'

  // ── 索引 ──
  const lessonById = useMemo(() => new Map(placed.map(p => [p.id, p])), [placed])
  const cellsByClass = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const p of placed) {
      const cm = m.get(p.classKey) ?? new Map<string, PlacedResult>()
      cm.set(`${p.day}-${p.period}`, p)
      if (p.size === 2) cm.set(`${p.day}-${p.period + 1}`, p)
      m.set(p.classKey, cm)
    }
    return m
  }, [placed])
  // 老師占用（週型感知）：teacherId → slot → { w/o/e: lessonId }
  const teacherOcc = useMemo(() => {
    const m = new Map<string, Map<string, { w?: string; o?: string; e?: string }>>()
    for (const p of placed) {
      const tm = m.get(p.teacherId) ?? new Map()
      const slots = p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
      for (const s of slots) {
        const cell = tm.get(s) ?? {}
        if (p.parity === 'weekly') cell.w = p.id
        else if (p.parity === 'odd') cell.o = p.id
        else cell.e = p.id
        tm.set(s, cell)
      }
      m.set(p.teacherId, tm)
    }
    return m
  }, [placed])
  // 科任個人不排課（mode='on' 是排課標記，不算封鎖）
  const teacherBlocked = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode === 'on') continue
      const set = (m[p.teacherId] ??= new Set())
      for (const s of p.slots) set.add(s)
    }
    return m
  }, [config])
  // 各班必留導師格（該班導師的個人排課標記：科任課不可放）
  const mustLeaveOf = useMemo(() => {
    const on: Record<string, Set<string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode !== 'on') continue
      const set = (on[p.teacherId] ??= new Set())
      for (const s of p.slots) set.add(s)
    }
    const m: Record<string, Set<string>> = {}
    for (const [ck2, tid] of Object.entries(config.classTeacher)) {
      if (tid && on[tid]) m[ck2] = on[tid]
    }
    return m
  }, [config])
  // 各班必排科任格（學年共同＋該班導師個人不排課）
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

  function teachableOf(classKey: string): Set<string> {
    const g = Number(classKey.split('-')[0])
    const grid = config.bands[bandOf(g)]
    const out = new Set<string>()
    for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) {
      if (grid.teachable[`${d}-${p}`]) out.add(`${d}-${p}`)
    }
    return out
  }
  const lockOf = (classKey: string) => config.lockCells[classKey] ?? {}
  const lockTypeMap = useMemo(() => Object.fromEntries(config.lockTypes.map(t => [t.id, t])), [config])

  /** 老師在該時段（考慮週型）是否已有其他課。 */
  function teacherBusy(teacherId: string, slot: string, parity: string, ignoreIds: Set<string>): boolean {
    const cell = teacherOcc.get(teacherId)?.get(slot)
    if (!cell) return false
    const ids = [cell.w, parity !== 'even' ? cell.o : undefined, parity !== 'odd' ? cell.e : undefined]
    return ids.some(id => id && !ignoreIds.has(id))
  }

  /** 科任課 L 移到 targetSlot（同班）是否合法（灰燈檢查）。swapWith 為互換對象（可忽略其占用）。 */
  function lessonCanGo(l: PlacedResult, targetSlot: string, ignoreIds: Set<string>): { ok: boolean; why?: string } {
    const teach = teachableOf(l.classKey)
    const locks = lockOf(l.classKey)
    const slots = l.size === 2
      ? [targetSlot, `${targetSlot.split('-')[0]}-${Number(targetSlot.split('-')[1]) + 1}`]
      : [targetSlot]
    if (l.parity === 'odd' && ![1, 3, 5].includes(Number(targetSlot.split('-')[1]))) return { ok: false, why: '單週連堂起始限 1/3/5 節' }
    if (l.parity === 'even' && ![2, 4, 6].includes(Number(targetSlot.split('-')[1]))) return { ok: false, why: '雙週連堂起始限 2/4/6 節' }
    const cm = cellsByClass.get(l.classKey)
    const hrCells = hr[l.classKey]?.cells ?? {}
    for (const s of slots) {
      if (!teach.has(s)) return { ok: false, why: '非可排課時段' }
      if (locks[s]) return { ok: false, why: '鎖課格' }
      if (mustLeaveOf[l.classKey]?.has(s)) return { ok: false, why: '導師排課標記格（此格必須是導師課）' }
      const occ = cm?.get(s)
      if (occ && !ignoreIds.has(occ.id)) return { ok: false, why: '該格已有其他科任課' }
      if (hrCells[s] && !ignoreIds.has(`hr|${l.classKey}|${s}`)) return { ok: false, why: '該格為導師課（請用互換）' }
      if (teacherBlocked[l.teacherId]?.has(s)) return { ok: false, why: `${l.teacherName} 該時段不排課` }
      if (teacherBusy(l.teacherId, s, l.parity, ignoreIds)) return { ok: false, why: `${l.teacherName} 該時段已有課` }
    }
    return { ok: true }
  }

  /** 導師課移到 targetSlot（同班）是否合法。 */
  function hrCanGo(classKey: string, targetSlot: string, ignoreIds: Set<string>): { ok: boolean; why?: string } {
    const teach = teachableOf(classKey)
    if (!teach.has(targetSlot)) return { ok: false, why: '非可排課時段' }
    if (lockOf(classKey)[targetSlot]) return { ok: false, why: '鎖課格' }
    if (mustFillOf[classKey]?.has(targetSlot)) return { ok: false, why: '導師不排課時段（此格必須是科任課）' }
    const occ = cellsByClass.get(classKey)?.get(targetSlot)
    if (occ && !ignoreIds.has(occ.id)) return { ok: false, why: '該格已有科任課（請用互換）' }
    const hrCells = hr[classKey]?.cells ?? {}
    if (hrCells[targetSlot] && !ignoreIds.has(`hr|${classKey}|${targetSlot}`)) return { ok: false, why: '該格已有導師課' }
    return { ok: true }
  }

  /** 目標格狀態（供亮燈）：選中來源後，對某格計算 可行/原因。 */
  function targetState(classKey: string, slot: string): { ok: boolean; why?: string } | null {
    if (!sel) return null
    if (sel.type === 'lesson') {
      const l = lessonById.get(sel.id)
      if (!l || l.classKey !== classKey) return { ok: false, why: '僅限同班調整' }
      const selfSlots = new Set([sel.id])
      const occ = cellsByClass.get(classKey)?.get(slot)
      const hrSubject = hr[classKey]?.cells?.[slot]
      if (occ && occ.id === l.id) return null   // 自己
      if (occ) {
        // 科任↔科任互換（限同型態同週型）
        if (occ.size !== l.size || occ.parity !== l.parity) return { ok: false, why: '型態不同（連堂/單節/週型），無法互換' }
        const ig = new Set([l.id, occ.id])
        const a = lessonCanGo(l, `${occ.day}-${occ.period}`, ig)
        if (!a.ok) return a
        const b = lessonCanGo(occ, `${l.day}-${l.period}`, ig)
        if (!b.ok) return { ok: false, why: `${occ.teacherName}：${b.why}` }
        return { ok: true }
      }
      if (hrSubject) {
        // 科任↔導師互換：科任到此格；導師課到科任原格（原格不可為必排科任格）
        if (l.size === 2) return { ok: false, why: '連堂與導師課互換請先拆為單節' }
        const ig = new Set([l.id, `hr|${classKey}|${slot}`])
        const a = lessonCanGo(l, slot, ig)
        if (!a.ok) return a
        const oldSlot = `${l.day}-${l.period}`
        if (mustFillOf[classKey]?.has(oldSlot)) return { ok: false, why: '科任原時段是導師不排課格，導師課不可換入' }
        return { ok: true }
      }
      // 空格：移動
      return lessonCanGo(l, slot, selfSlots)
    }
    // 導師課來源
    if (sel.classKey !== classKey) return { ok: false, why: '導師課僅限本班內調整' }
    const srcId = `hr|${sel.classKey}|${sel.slot}`
    if (slot === sel.slot) return null
    const occ = cellsByClass.get(classKey)?.get(slot)
    if (occ) {
      if (occ.size === 2) return { ok: false, why: '連堂與導師課互換請先拆為單節' }
      const ig = new Set([occ.id, srcId])
      const a = lessonCanGo(occ, sel.slot, ig)
      if (!a.ok) return { ok: false, why: `${occ.teacherName}：${a.why}` }
      const b = hrCanGo(classKey, slot, ig)
      if (!b.ok) return b
      return { ok: true }
    }
    return hrCanGo(classKey, slot, new Set([srcId]))
  }

  // ── 套用調整 ──
  function pushUndo() {
    setUndoStack(prev => [...prev.slice(-19), {
      placed: placed.map(p => ({ ...p })),
      hr: Object.fromEntries(Object.entries(hr).map(([k, v]) => [k, { ...v, cells: { ...v.cells } }])),
      adjustments: [...adjustments],
    }])
  }

  async function persist(nextPlaced: PlacedResult[], nextHr: Record<string, HomeroomRow>, nextAdj: Adjustment[], changedHrClasses: string[]) {
    setSaveState('saving')
    try {
      const plan = { ...savedPlan, placed: nextPlaced, adjustments: nextAdj, status: planStatus }
      const res = await fetch('/api/admin/schedule-plan', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, plan }),
      })
      if (!res.ok) throw new Error()
      for (const ck of changedHrClasses) {
        const r = await fetch('/api/admin/schedule-homeroom', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, classKey: ck, action: 'setCells', cells: nextHr[ck]?.cells ?? {} }),
        })
        if (!r.ok) throw new Error()
      }
      // savedPlan 同步（後續 persist 以最新為基底）
      savedPlan.placed = nextPlaced
      savedPlan.adjustments = nextAdj
      setSaveState('saved')
    } catch { setSaveState('error') }
  }

  function applyAdjust(nextPlaced: PlacedResult[], nextHr: Record<string, HomeroomRow>, desc: string, changedHrClasses: string[]) {
    pushUndo()
    const adj: Adjustment = { at: new Date().toISOString(), desc, ...(note.trim() ? { note: note.trim() } : {}) }
    const nextAdj = [...adjustments, adj]
    const withRooms = reassignRooms(nextPlaced, rooms)
    setPlaced(withRooms)
    setHr(nextHr)
    setAdjustments(nextAdj)
    setSel(null)
    setNote('')
    void persist(withRooms, nextHr, nextAdj, changedHrClasses)
  }

  function clickCell(classKey: string, slot: string) {
    if (!adjustMode) return
    const occ = cellsByClass.get(classKey)?.get(slot)
    const hrSubject = hr[classKey]?.cells?.[slot]
    if (!sel) {
      if (occ) setSel({ type: 'lesson', id: occ.id })
      else if (hrSubject) setSel({ type: 'hr', classKey, slot })
      return
    }
    // 點自己＝取消
    if (sel.type === 'lesson' && occ?.id === sel.id) { setSel(null); return }
    if (sel.type === 'hr' && sel.classKey === classKey && sel.slot === slot) { setSel(null); return }
    const st = targetState(classKey, slot)
    if (!st?.ok) return

    if (sel.type === 'lesson') {
      const l = lessonById.get(sel.id)!
      const [d, p] = slot.split('-').map(Number)
      if (occ) {
        const next = placed.map(x => x.id === l.id ? { ...x, day: occ.day, period: occ.period } : x.id === occ.id ? { ...x, day: l.day, period: l.period } : x)
        applyAdjust(next, hr, `${l.classLabel}：${l.subject}（${l.teacherName}）${slotZh(`${l.day}-${l.period}`)} ↔ ${occ.subject}（${occ.teacherName}）${slotZh(slot)}`, [])
      } else if (hrSubject) {
        const oldSlot = `${l.day}-${l.period}`
        const next = placed.map(x => x.id === l.id ? { ...x, day: d, period: p } : x)
        const row = hr[classKey]
        const cells = { ...row.cells }; delete cells[slot]; cells[oldSlot] = hrSubject
        const nextHr = { ...hr, [classKey]: { ...row, cells } }
        applyAdjust(next, nextHr, `${l.classLabel}：${l.subject}（${l.teacherName}）${slotZh(oldSlot)} ↔ 導師課「${hrSubject}」${slotZh(slot)}`, [classKey])
      } else {
        const next = placed.map(x => x.id === l.id ? { ...x, day: d, period: p } : x)
        applyAdjust(next, hr, `${l.classLabel}：${l.subject}（${l.teacherName}）${slotZh(`${l.day}-${l.period}`)} → ${slotZh(slot)}`, [])
      }
    } else {
      const row = hr[sel.classKey]
      const subj = row.cells[sel.slot]
      if (occ) {
        const next = placed.map(x => x.id === occ.id ? { ...x, day: Number(sel.slot.split('-')[0]), period: Number(sel.slot.split('-')[1]) } : x)
        const cells = { ...row.cells }; delete cells[sel.slot]; cells[slot] = subj
        const nextHr = { ...hr, [sel.classKey]: { ...row, cells } }
        applyAdjust(next, nextHr, `${classLabelOf(classKey)}：導師課「${subj}」${slotZh(sel.slot)} ↔ ${occ.subject}（${occ.teacherName}）${slotZh(slot)}`, [classKey])
      } else {
        const cells = { ...row.cells }; delete cells[sel.slot]; cells[slot] = subj
        const nextHr = { ...hr, [sel.classKey]: { ...row, cells } }
        applyAdjust(placed, nextHr, `${classLabelOf(classKey)}：導師課「${subj}」${slotZh(sel.slot)} → ${slotZh(slot)}`, [classKey])
      }
    }
  }

  function splitDouble() {
    if (sel?.type !== 'lesson') return
    const l = lessonById.get(sel.id)
    if (!l || l.size !== 2 || l.parity !== 'weekly') return
    pushUndo()
    const next = placed.flatMap(x => x.id !== l.id ? [x] : [
      { ...x, id: `${x.id}~a`, size: 1 as const },
      { ...x, id: `${x.id}~b`, size: 1 as const, period: x.period + 1 },
    ])
    const adj: Adjustment = { at: new Date().toISOString(), desc: `${l.classLabel}：${l.subject} 連堂拆為兩個單節` }
    const nextAdj = [...adjustments, adj]
    setPlaced(next); setAdjustments(nextAdj); setSel(null)
    void persist(next, hr, nextAdj, [])
  }

  function undo() {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    setUndoStack(prev => prev.slice(0, -1))
    setPlaced(last.placed)
    setHr(last.hr)
    setAdjustments(last.adjustments)
    setSel(null)
    const changed = Object.keys(last.hr)
    void persist(last.placed, last.hr, last.adjustments, changed)
  }

  async function unconfirmClass(classKey: string) {
    if (!confirm(`退回 ${classLabelOf(classKey)} 導師的確認？導師將可重新編輯排課選填。`)) return
    const res = await fetch('/api/admin/schedule-homeroom', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, classKey, action: 'unconfirm' }),
    })
    if (res.ok) setHr(prev => ({ ...prev, [classKey]: { ...prev[classKey], confirmed_at: null } }))
  }

  async function setFinal(action: 'finalize' | 'unfinalize') {
    if (action === 'finalize') {
      const unconfirmed = allClassKeys.filter(ck => !hr[ck]?.confirmed_at)
      const msg = unconfirmed.length
        ? `尚有 ${unconfirmed.length} 班導師未確認（${unconfirmed.slice(0, 6).map(classLabelOf).join('、')}${unconfirmed.length > 6 ? '…' : ''}）。\n仍要定案發布課表嗎？`
        : '所有導師皆已確認。定案後全校課表對教師公開。確定定案？'
      if (!confirm(msg)) return
    } else if (!confirm('取消定案？課表將暫停對教師公開。')) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/schedule-plan', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, action }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? '操作失敗'); return }
      setPlanStatus(data.status)
      savedPlan.status = data.status
    } finally { setBusy(false) }
  }

  // ── 顯示 ──
  const classLabelOf = (ck: string) => { const [g, i] = ck.split('-').map(Number); return classLabel(g, i) }
  const allClassKeys = GRADES.flatMap(g => Array.from({ length: classCounts[g] ?? 0 }, (_, i) => `${g}-${i}`))
  const gradeClasses = allClassKeys.filter(ck => Number(ck.split('-')[0]) === gradeSel)
  const confirmedCount = allClassKeys.filter(ck => hr[ck]?.confirmed_at).length
  const filledOf = (ck: string) => Object.keys(hr[ck]?.cells ?? {}).length

  const selLesson = sel?.type === 'lesson' ? lessonById.get(sel.id) : null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-semibold text-zinc-700">年級總覽與調整
          <span className="text-xs font-normal text-zinc-400 ml-2">導師確認 {confirmedCount}/{allClassKeys.length} 班</span>
        </div>
        <span className="ml-auto flex items-center gap-2 flex-wrap">
          {saveState === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
          {saveState === 'saved' && <span className="text-xs text-green-600">✓ 已儲存</span>}
          {saveState === 'error' && <span className="text-xs text-red-600">⚠ 儲存失敗</span>}
          {adjustMode && undoStack.length > 0 && <button onClick={undo} className="btn btn-secondary text-xs py-0.5">↩ 復原</button>}
          <button onClick={() => { setAdjustMode(m => !m); setSel(null) }}
            className={`btn text-xs py-0.5 ${adjustMode ? 'btn-primary' : 'btn-secondary'}`}>
            {adjustMode ? '✓ 調整模式（點課→點目標格）' : '✎ 進入調整模式'}
          </button>
          {planStatus === 'published' && <button onClick={() => setFinal('finalize')} disabled={busy} className="btn btn-primary text-xs py-0.5">🏁 定案發布課表</button>}
          {planStatus === 'final' && <button onClick={() => setFinal('unfinalize')} disabled={busy} className="btn btn-danger text-xs py-0.5">取消定案</button>}
        </span>
      </div>

      {adjustMode && (
        <div className="card p-2 text-xs text-zinc-500 flex items-center gap-3 flex-wrap">
          <span>
            {sel
              ? sel.type === 'lesson'
                ? <>已選：<b className="text-zinc-700">{selLesson?.classLabel} {selLesson?.subject}（{selLesson?.teacherName}）</b>——綠格可放，灰格滑過看原因</>
                : <>已選：<b className="text-zinc-700">{classLabelOf(sel.classKey)} 導師課「{hr[sel.classKey]?.cells?.[sel.slot]}」</b></>
              : '點選一堂課（科任或導師課）開始；教室會自動重新分配、無需擔心。'}
          </span>
          {selLesson?.size === 2 && selLesson.parity === 'weekly' && (
            <button onClick={splitDouble} className="btn btn-secondary text-xs py-0.5">✂ 拆為兩個單節</button>
          )}
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="協調備註（選填，隨下一步調整記錄）"
            className="input py-0.5 text-xs w-56 ml-auto" />
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        {GRADES.filter(g => (classCounts[g] ?? 0) > 0).map(g => (
          <button key={g} onClick={() => setGradeSel(g)}
            className={`text-xs px-2 py-1 rounded-sm border ${gradeSel === g ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200'}`}>
            {GRADE_LABEL[g]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {gradeClasses.map(ck => {
          const teach = teachableOf(ck)
          const locks = lockOf(ck)
          const cm = cellsByClass.get(ck)
          const hrRow = hr[ck]
          const g = Number(ck.split('-')[0])
          const periods = Array.from({ length: config.bands[bandOf(g)].periodsPerDay }, (_, i) => i + 1)
          return (
            <div key={ck} className="card p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-700">{classLabelOf(ck)}</span>
                <span className="text-[10px] text-zinc-400">{nameOf(config.classTeacher[ck] ?? '')}</span>
                {hrRow?.confirmed_at
                  ? <span className="text-[10px] px-1 py-0 rounded-sm bg-green-100 text-green-700 border border-green-200">✓ 已確認</span>
                  : <span className="text-[10px] px-1 py-0 rounded-sm bg-amber-50 text-amber-600 border border-amber-200">填 {filledOf(ck)} 節</span>}
                {hrRow?.confirmed_at && (
                  <button onClick={() => unconfirmClass(ck)} className="text-[10px] text-zinc-400 hover:text-red-600 ml-auto">退回確認</button>
                )}
              </div>
              <table className="w-full table-fixed border-collapse text-[10px]">
                <thead>
                  <tr><th className="w-5 text-zinc-400 font-normal"></th>
                    {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {periods.map(q => (
                    <tr key={q}>
                      <td className="text-zinc-400 text-center">{q}</td>
                      {SCHEDULE_DAYS.map(d => {
                        const k = `${d}-${q}`
                        if (!teach.has(k)) return <td key={d} className="p-0.5"><div className="h-9 rounded-sm bg-zinc-50" /></td>
                        const lock = locks[k]
                        if (lock) {
                          const t = lockTypeMap[lock]
                          return <td key={d} className="p-0.5"><div className="h-9 rounded-sm border bg-zinc-200 border-zinc-300 text-zinc-600 flex items-center justify-center truncate px-0.5">{t?.subject || '鎖'}</div></td>
                        }
                        const occ = cm?.get(k)
                        const hrSubj = hrRow?.cells?.[k]
                        const isSelSrc = (sel?.type === 'lesson' && occ?.id === sel.id) || (sel?.type === 'hr' && sel.classKey === ck && sel.slot === k)
                        const st = adjustMode && sel && !isSelSrc ? targetState(ck, k) : null
                        const ring = isSelSrc ? 'ring-2 ring-zinc-700' : st?.ok ? 'ring-2 ring-emerald-400' : ''
                        const dim = adjustMode && sel && !isSelSrc && st && !st.ok ? 'opacity-40' : ''
                        const title = st && !st.ok ? st.why : undefined
                        if (occ) {
                          const bi = occ.parity !== 'weekly'
                          return (
                            <td key={d} className="p-0.5">
                              <button onClick={() => clickCell(ck, k)} title={title}
                                className={`w-full h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center ${bi ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900'} ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                                <span className="truncate w-full font-medium">{occ.subject}</span>
                                <span className="truncate w-full text-[8px] opacity-70">{occ.teacherName}</span>
                              </button>
                            </td>
                          )
                        }
                        if (hrSubj) {
                          return (
                            <td key={d} className="p-0.5">
                              <button onClick={() => clickCell(ck, k)} title={title}
                                className={`w-full h-9 rounded-sm border bg-emerald-50 border-emerald-200 text-emerald-800 px-0.5 truncate ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                                {hrSubj}
                              </button>
                            </td>
                          )
                        }
                        const must = mustFillOf[ck]?.has(k)
                        return (
                          <td key={d} className="p-0.5">
                            <button onClick={() => clickCell(ck, k)} title={title ?? (must ? '導師不排課時段（僅科任課可入）' : undefined)}
                              className={`w-full h-9 rounded-sm border border-dashed ${must ? 'border-red-300 text-red-300' : 'border-zinc-200 text-zinc-300'} ${st?.ok ? 'ring-2 ring-emerald-400' : ''} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                              {must ? '需科任' : ''}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {/* 調整紀錄 */}
      {adjustments.length > 0 && (
        <details className="card p-3">
          <summary className="text-sm font-semibold text-zinc-700 cursor-pointer">調整紀錄（{adjustments.length}）</summary>
          <ul className="mt-2 space-y-1 text-xs text-zinc-500">
            {[...adjustments].reverse().map((a, i) => (
              <li key={i}>
                <span className="text-zinc-400">{new Date(a.at).toLocaleString('zh-TW')}</span>　{a.desc}
                {a.note && <span className="text-zinc-400">（{a.note}）</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
