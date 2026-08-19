'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import { roomsFromConfig, reassignRooms, SwapFinder, type PlacedResult, type EngineInput, type SwapOption } from '@/lib/schedule-engine'

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
  baseHash: string          // 版本快照用：課的組成／可排格／鎖課指紋
  engineInput: EngineInput  // 調課查詢器用：硬規則沿用引擎（鎖課、教室、不回頭、連 7…）
  /** 內嵌在排課精靈的「班級課表」預覽裡（草稿階段）：不顯示標題／導師確認／定案列，年級由外面控制；
   *  第一次調動才把課表存成草稿（persist 本來就是整份 PUT）。 */
  embedded?: boolean
  gradeSel?: number
  /** 檢視：班級（多班格）／科任教師（一位老師的週課表）／科任教室（一間教室的週課表）。三種都能點課調、上色一致（以時段為格）。
   *  內嵌時由外層控制；獨立（發布後）時自己有切換列。 */
  mode?: 'class' | 'teacher' | 'room'
  focusId?: string
  onPlacedChange?: (placed: PlacedResult[]) => void   // 調動後回報新課表（讓外層教師／教室視圖同步）
  onPersisted?: () => void                             // 第一次成功存檔後回報（外層據此知道資料庫已是微調後的草稿）
}

type Sel = { type: 'lesson'; id: string } | { type: 'hr'; classKey: string; slot: string } | null
interface Adjustment { at: string; desc: string; note?: string }

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const slotZh = (s: string) => { const [d, p] = s.split('-'); return `週${DAY_ZH[Number(d)]}第${p}節` }

/** 年級總覽＋調整模式（發布後）：
 *  防呆（灰燈硬擋）：鎖課、導師不排課格只能科任課、科任自身不排課、老師撞課（週型感知）、
 *  導師課不跨班。連堂可拆、上空上空不擋（老師自行協調的結果）。
 *  每步調整後教室自動重分配（管理教師優先），零警告。 */
export default function OverviewAdjust({ year, planStatus, setPlanStatus, savedPlan, homeroomRows, config, classCounts, teacherNames, baseHash, engineInput, embedded = false, gradeSel: gradeSelProp, mode: modeProp, focusId: focusIdProp, onPlacedChange, onPersisted }: Props) {
  const [modeState, setModeState] = useState<'class' | 'teacher' | 'room'>('class')
  const [teacherSelState, setTeacherSel] = useState('')
  const [roomSelState, setRoomSel] = useState('')
  const mode = modeProp ?? modeState
  const focusId = focusIdProp ?? (mode === 'teacher' ? teacherSelState : mode === 'room' ? roomSelState : '')
  const [placed, setPlaced] = useState<PlacedResult[]>(() => (savedPlan.placed as PlacedResult[] | undefined) ?? [])
  // 導師填課開關（只在「已發布、未定案」有意義）：開著＝導師在填，課務組只能科任課互換；收回＝可自由調課
  const [fillOpenState, setFillOpenState] = useState<boolean>(() => savedPlan.fillOpen !== false)
  const fillOpen = planStatus === 'published' && fillOpenState
  const [fillBusy, setFillBusy] = useState(false)
  async function toggleFill() {
    const next = !fillOpenState
    const msg = next
      ? '重新開放導師填課？開放期間課務組只能做科任課之間的互換（不可搬進空格／與導師課互換），避免撞到導師剛填的格。'
      : '收回導師填課權限？導師端將變成唯讀，課務組可自由調課；調完可再開放。'
    if (!confirm(msg)) return
    setFillBusy(true)
    try {
      const res = await fetch('/api/admin/schedule-plan', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, action: next ? 'fillOpen' : 'fillClose' }) })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? '操作失敗'); return }
      setFillOpenState(data.fillOpen !== false); savedPlan.fillOpen = data.fillOpen !== false
    } finally { setFillBusy(false) }
  }
  const [hr, setHr] = useState<Record<string, HomeroomRow>>(() => Object.fromEntries(homeroomRows.map(r => [r.class_key, { ...r, cells: { ...r.cells } }])))
  const [adjustments, setAdjustments] = useState<Adjustment[]>(() => (savedPlan.adjustments as Adjustment[] | undefined) ?? [])
  const [undoStack, setUndoStack] = useState<{ placed: PlacedResult[]; hr: Record<string, HomeroomRow>; adjustments: Adjustment[] }[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [gradeSelState, setGradeSel] = useState<number>(GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1)
  const gradeSel = gradeSelProp ?? gradeSelState
  const adjustMode = true   // 點課即調：不再有「進入調整模式」這一層（選一堂課→點彩格才會動，誤觸風險低、且有復原）
  const [note, setNote] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [snapState, setSnapState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  /** 把目前（微調後）的課表另存成一份版本快照。
   *  微調是每步自動存進正式課表的，沒有版本可回頭；批次調完按這顆就留一個復原點。
   *  罰分不重算——引擎的計分要完整 EngineInput，這裡沒有；故標明數值為微調前的，避免被拿去比較。 */
  async function snapshot() {
    setSnapState('saving')
    try {
      const pens = (savedPlan.penalties as { key: string; label: string; count: number; points: number }[] | undefined) ?? []
      const res = await fetch('/api/admin/schedule-plan-versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, source: 'manual', baseHash, weights: config.weights,
          label: `手動微調後（${adjustments.length} 筆調整）`,
          summary: {
            placed: placed.length,
            unplaced: Array.isArray(savedPlan.unplaced) ? (savedPlan.unplaced as unknown[]).length : 0,
            uncovered: Array.isArray(savedPlan.uncoveredMustFill) ? (savedPlan.uncoveredMustFill as unknown[]).length : 0,
            mustCount: pens.filter(x => Number(x.points) >= 1e6).reduce((a, x) => a + (x.count ?? 0), 0),
            softPenalty: Math.round(Number(savedPlan.softPenalty ?? 0)),
            note: '手動微調後保存；罰分為微調前的數值、未重算，不可與其他版本比較。',
            rules: pens.filter(x => Number(x.points) > 0).map(x => ({ key: x.key, label: x.label, count: x.count, points: Math.round(Number(x.points)) })),
          },
          plan: { ...savedPlan, placed, adjustments },
        }),
      })
      setSnapState(res.ok ? 'saved' : 'error')
    } catch { setSnapState('error') }
  }
  const [busy, setBusy] = useState(false)

  const rooms = useMemo(() => roomsFromConfig(config), [config])
  const nameOf = (id: string) => teacherNames[id] ?? '？'

  // ── 索引 ──
  const lessonById = useMemo(() => new Map(placed.map(p => [p.id, p])), [placed])
  const teacherOptions = useMemo(() => {
    const m = new Map<string, { id: string; name: string; co: boolean }>()
    for (const p of placed) {
      if (!m.has(p.teacherId)) m.set(p.teacherId, { id: p.teacherId, name: p.teacherName, co: false })
      if (p.coTeacherId && !m.has(p.coTeacherId)) m.set(p.coTeacherId, { id: p.coTeacherId, name: p.coTeacherName ?? '外師', co: true })
    }
    return Array.from(m.values()).sort((a, b) => Number(a.co) - Number(b.co) || a.name.localeCompare(b.name, 'zh-Hant'))
  }, [placed])
  /** 教師／教室檢視：一張以時段為格的週課表（同一格可能有單週＋雙週兩堂） */
  const focusCells = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    if (mode === 'class' || !focusId) return m
    for (const p of placed) {
      const hit = mode === 'teacher' ? (p.teacherId === focusId || p.coTeacherId === focusId) : p.roomId === focusId
      if (!hit) continue
      const slots = p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
      for (const sl of slots) m.set(sl, [...(m.get(sl) ?? []), p])
    }
    return m
  }, [placed, mode, focusId])
  const focusOff = useMemo<Set<string>>(() => {
    if (mode === 'teacher' && focusId) return new Set(engineInput.teacherBlocked[focusId] ?? [])
    if (mode === 'room' && focusId) return new Set(engineInput.rooms.find(r => r.id === focusId)?.offSlots ?? [])
    return new Set()
  }, [mode, focusId, engineInput])
  const maxPeriods = useMemo(() => Math.max(...Object.values(config.bands).map(b => b.periodsPerDay)), [config])
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
  // ── 調課查詢器：以目前課表為起點，硬規則全部沿用引擎（鎖課、同時段唯一、不排課、連 7、教室、不回頭…）──
  const finder = useMemo(() => {
    const hrCells: Record<string, Record<string, string>> = {}
    for (const [ck2, row] of Object.entries(hr)) if (row?.cells && Object.keys(row.cells).length) hrCells[ck2] = row.cells
    try { return new SwapFinder(engineInput, placed, hrCells, fillOpen) } catch { return null }
  }, [engineInput, placed, hr, fillOpen])
  const swapQ = useMemo(() => (sel?.type === 'lesson' && finder) ? finder.query(sel.id) : null, [sel, finder])
  /** 被點的課所在班級：每格最好的調法（已依軟分排序，取第一個） */
  const optByCell = useMemo(() => {
    const m = new Map<string, SwapOption>()
    for (const o of swapQ?.options ?? []) if (!m.has(o.targetSlot)) m.set(o.targetSlot, o)
    return m
  }, [swapQ])
  const [hoverOpt, setHoverOpt] = useState<SwapOption | null>(null)
  const [chain, setChain] = useState<SwapOption | null | 'none' | 'busy'>(null)
  const KIND_ZH: Record<SwapOption['kind'], string> = { move: '直接搬', swap2: '兩角互換', swap3: '三角互調', chain: '多角鏈' }
  const deltaZh = (d: number) => d === 0 ? '罰分不變' : d < 0 ? `罰分 −${Math.abs(d)}（變好）` : `罰分 +${d}（變差，越少越好）`

  // 老師占用（週型感知）：teacherId → slot → { w/o/e: lessonId }
  const teacherOcc = useMemo(() => {
    const m = new Map<string, Map<string, { w?: string; o?: string; e?: string }>>()
    for (const p of placed) {
      // 中師與外師（協同）都占用：外師同時段唯一是硬規則
      for (const rid of [p.teacherId, ...(p.coTeacherId ? [p.coTeacherId] : [])]) {
        const tm = m.get(rid) ?? new Map()
        const slots = p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
        for (const s of slots) {
          const cell = tm.get(s) ?? {}
          if (p.parity === 'weekly') cell.w = p.id
          else if (p.parity === 'odd') cell.o = p.id
          else cell.e = p.id
          tm.set(s, cell)
        }
        m.set(rid, tm)
      }
    }
    return m
  }, [placed])
  // 外師不可到校時段
  const foreignBlocked = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const f of config.foreignTeachers) m[f.teacherId] = new Set(f.offSlots)
    return m
  }, [config])
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
    // 單雙週實體區塊一律對齊 (1-2)(3-4)(5-6)；顯示層才分單週起始節/雙週次節
    if (l.parity !== 'weekly' && ![1, 3, 5].includes(Number(targetSlot.split('-')[1]))) return { ok: false, why: '單雙週連堂區塊起始限 1/3/5 節' }
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
      if (l.coTeacherId) {
        if (foreignBlocked[l.coTeacherId]?.has(s)) return { ok: false, why: `外師 ${l.coTeacherName ?? ''} 該時段不可到校` }
        if (teacherBusy(l.coTeacherId, s, l.parity, ignoreIds)) return { ok: false, why: `外師 ${l.coTeacherName ?? ''} 該時段已在別班` }
      }
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
      // 單雙週課：配對格已有導師填課時不可移動（先請導師退回/管理者清除，否則導師課會懸空）
      if (l.parity !== 'weekly') {
        const pairSlot = `${l.day}-${l.parity === 'odd' ? l.period + 1 : l.period}`
        if (hr[l.classKey]?.cells?.[pairSlot]) return { ok: false, why: '配對格已有導師課，請先退回導師填課再調整' }
      }
      const selfSlots = new Set([sel.id])
      const occ = cellsByClass.get(classKey)?.get(slot)
      const hrSubject = hr[classKey]?.cells?.[slot]
      if (occ && occ.id === l.id) return null   // 自己
      if (swapQ) {
        // 查詢器有答案：科任格／空格一律以引擎硬規則為準（鎖課、教室、不回頭、連 7 都擋）
        const o = optByCell.get(slot)
        if (o) return { ok: true, why: `${KIND_ZH[o.kind]}・${deltaZh(o.softDelta)}${o.kind !== 'move' ? '：' + o.desc : ''}` }
        if (!hrSubject) return { ok: false, why: swapQ.why[slot] ?? '不合法' }
        if (fillOpen) return { ok: false, why: '導師填課開放中：不可與導師課互換' }
        // 導師課格：沿用下面的 科任↔導師 互換檢查
      }
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
        if (finder) {
          // 引擎硬規則也要過（教室、不回頭、連 7…），並給軟分變化
          const r = finder.checkMoveFreeingHr(l.id, { day: Number(slot.split('-')[0]), period: Number(slot.split('-')[1]) })
          if (r.reason) return { ok: false, why: r.reason }
          return { ok: true, why: `與導師課「${hrSubject}」互換・${deltaZh(r.softDelta)}` }
        }
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
      if (fillOpen) return { ok: false, why: '導師填課開放中：課務組不動導師課' }
      if (finder) {
        const r = finder.checkMoveFreeingHr(occ.id, { day: Number(sel.slot.split('-')[0]), period: Number(sel.slot.split('-')[1]) })
        if (r.reason) return { ok: false, why: `${occ.teacherName}：${r.reason}` }
        return { ok: true, why: `與 ${occ.subject}（${occ.teacherName}）互換・${deltaZh(r.softDelta)}` }
      }
      return { ok: true }
    }
    if (fillOpen) return { ok: false, why: '導師填課開放中：課務組不動導師課' }
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
      onPersisted?.()
    } catch { setSaveState('error') }
  }

  function applyAdjust(nextPlaced: PlacedResult[], nextHr: Record<string, HomeroomRow>, desc: string, changedHrClasses: string[]) {
    pushUndo()
    const adj: Adjustment = { at: new Date().toISOString(), desc, ...(note.trim() ? { note: note.trim() } : {}) }
    const nextAdj = [...adjustments, adj]
    const withRooms = reassignRooms(nextPlaced, rooms, config.weights)
    setPlaced(withRooms); onPlacedChange?.(withRooms)
    setHr(nextHr)
    setAdjustments(nextAdj)
    setSel(null)
    setNote('')
    void persist(withRooms, nextHr, nextAdj, changedHrClasses)
  }

  /** 套用查詢器給的一組搬動（直接搬／兩角／三角／多角鏈）：全部合法才套，教室由引擎狀態重配。 */
  function applyOption(opt: SwapOption) {
    if (!finder) return
    const r = finder.apply(opt.moves)
    if (!r.ok) { alert(r.error ?? '此調法已不合法'); return }
    const sl = sel?.type === 'lesson' ? lessonById.get(sel.id) : null
    const head = sl ? `${sl.classLabel}：` : ''
    applyAdjust(r.placed, hr, `${head}${KIND_ZH[opt.kind]}｜${opt.desc}｜${deltaZh(opt.softDelta)}`, [])
    setHoverOpt(null); setChain(null)
  }
  function runFindChain() {
    if (!finder || sel?.type !== 'lesson') return
    setChain('busy')
    const id = sel.id
    setTimeout(() => {
      // 先找短鏈、找不到再加深（最短的最好懂）
      let found: SwapOption | null = null
      for (let d = 1; d <= 4 && !found; d++) found = finder.findChain(id, d, 700)
      setChain(found ?? 'none')
    }, 10)
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
      const opt = l.classKey === classKey ? optByCell.get(slot) : undefined
      if (opt) { applyOption(opt); return }
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
    setPlaced(next); onPlacedChange?.(next); setAdjustments(nextAdj); setSel(null)
    void persist(next, hr, nextAdj, [])
  }

  function undo() {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    setUndoStack(prev => prev.slice(0, -1))
    setPlaced(last.placed); onPlacedChange?.(last.placed)
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
  // 已填節數：單雙週配對格填一格＝整塊兩節
  const filledOf = (ck: string) => {
    const pairSlots = new Set(placed.filter(p => p.classKey === ck && p.parity !== 'weekly')
      .map(p => `${p.day}-${p.parity === 'odd' ? p.period + 1 : p.period}`))
    return Object.keys(hr[ck]?.cells ?? {}).reduce((n, s) => n + (pairSlots.has(s) ? 2 : 1), 0)
  }

  const selLesson = sel?.type === 'lesson' ? lessonById.get(sel.id) : null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-semibold text-zinc-700">{embedded ? <span className="text-xs font-normal text-zinc-500">點一堂課就能調（會上色）；調動自動存成草稿，發布時就發布調整後的這份</span> : '年級總覽與調整'}
          {!embedded && (planStatus === 'draft'
            ? <span className="text-xs font-normal text-amber-600 ml-2">草稿（尚未發布）</span>
            : <span className="text-xs font-normal text-zinc-400 ml-2">導師確認 {confirmedCount}/{allClassKeys.length} 班</span>)}
          {planStatus === 'published' && (
            fillOpen
              ? <span className="text-[10px] ml-2 px-1 py-0 rounded-sm bg-emerald-50 text-emerald-700 border border-emerald-200">導師填課開放中</span>
              : <span className="text-[10px] ml-2 px-1 py-0 rounded-sm bg-amber-50 text-amber-700 border border-amber-200">填課已收回・課務組調課中</span>
          )}
        </div>
        <span className="ml-auto flex items-center gap-2 flex-wrap">
          {saveState === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
          {saveState === 'saved' && <span className="text-xs text-green-600">✓ 已儲存</span>}
          {saveState === 'error' && <span className="text-xs text-red-600">⚠ 儲存失敗</span>}
          {snapState === 'saved' && <span className="text-xs text-green-600">✓ 已存為版本</span>}
          {snapState === 'error' && <span className="text-xs text-red-600">⚠ 存版本失敗</span>}
          {adjustments.length > 0 && (
            <button onClick={snapshot} disabled={snapState === 'saving'} title="把目前微調後的課表另存成一份版本，之後可在版本紀錄找回"
              className="btn btn-secondary text-xs py-0.5">📌 存為版本</button>
          )}
          {undoStack.length > 0 && <button onClick={undo} className="btn btn-secondary text-xs py-0.5">↩ 復原</button>}
          {!embedded && planStatus === 'published' && (
            <button onClick={toggleFill} disabled={fillBusy} className={`btn text-xs py-0.5 ${fillOpenState ? 'btn-secondary' : 'btn-primary'}`}
              title={fillOpenState ? '收回後導師端唯讀，課務組可自由調課（搬進空格、與導師課互換）' : '重新開放導師填課；開放期間課務組只能科任課互換'}>
              {fillOpenState ? '🔒 收回導師填課' : '🔓 開放導師填課'}
            </button>
          )}
          {!embedded && planStatus === 'published' && <button onClick={() => setFinal('finalize')} disabled={busy} className="btn btn-primary text-xs py-0.5">🏁 定案發布課表</button>}
          {!embedded && planStatus === 'final' && <button onClick={() => setFinal('unfinalize')} disabled={busy} className="btn btn-danger text-xs py-0.5">取消定案</button>}
        </span>
      </div>

      {!embedded && (
        <div className="flex items-center gap-2 flex-wrap">
          {(['class', 'teacher', 'room'] as const).map(v => (
            <button key={v} onClick={() => setModeState(v)} className={`btn text-xs py-0.5 ${mode === v ? 'btn-primary' : 'btn-secondary'}`}>
              {v === 'class' ? '班級課表' : v === 'teacher' ? '科任教師課表' : '科任教室課表'}
            </button>
          ))}
          {mode === 'teacher' && (
            <select value={teacherSelState} onChange={e => setTeacherSel(e.target.value)} className="input py-0.5 text-xs w-44">
              <option value="">選擇教師…</option>
              {teacherOptions.map(t => <option key={t.id} value={t.id}>{t.co ? '★' : ''}{t.name}</option>)}
            </select>
          )}
          {mode === 'room' && (
            <select value={roomSelState} onChange={e => setRoomSel(e.target.value)} className="input py-0.5 text-xs w-44">
              <option value="">選擇教室…</option>
              {rooms.filter(r => r.subject).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          )}
        </div>
      )}

      {(sel || !embedded) && (
        <div className="card p-2 text-xs text-zinc-500 flex items-center gap-3 flex-wrap">
          <span>
            {sel
              ? sel.type === 'lesson'
                ? <>已選：<b className="text-zinc-700">{selLesson?.classLabel} {selLesson?.subject}（{selLesson?.teacherName}）</b>——
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400 align-middle mx-0.5" />直接搬
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-400 align-middle mx-0.5 ml-2" />兩角互換
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 align-middle mx-0.5 ml-2" />三角互調
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-400 align-middle mx-0.5 ml-2" />與導師課互換
                    ；灰格滑過看卡在哪條硬規則；滑過彩格會標出牽動到的課（虛線框）；格角數字＝罰分變化，<b>越低越好</b>（負＝變好、正＝變差）{fillOpen && <b className="text-amber-700 ml-2">導師填課開放中：只能科任課之間互換</b>}</>
                : <>已選：<b className="text-zinc-700">{classLabelOf(sel.classKey)} 導師課「{hr[sel.classKey]?.cells?.[sel.slot]}」</b></>
              : '點一堂課（科任或導師課）開始：本班格子會上色——綠＝可直接搬、藍＝兩角互換、橘＝三角、紫＝與導師課互換、灰＝不行（滑過看原因）；再點彩格就完成。教室會自動重新分配。'}
          </span>
          {selLesson?.size === 2 && selLesson.parity === 'weekly' && (
            <button onClick={splitDouble} className="btn btn-secondary text-xs py-0.5">✂ 拆為兩個單節</button>
          )}
          {selLesson && finder && (
            <button onClick={runFindChain} disabled={chain === 'busy'} className="btn btn-secondary text-xs py-0.5" title="三角以上的多角鏈：把擋路的課逐出、再幫它們找位子，最多四層">
              {chain === 'busy' ? '搜尋中…' : '🔗 幫我找一條鏈'}
            </button>
          )}
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="協調備註（選填，隨下一步調整記錄）"
            className="input py-0.5 text-xs w-56 ml-auto" />
        </div>
      )}

      {adjustMode && selLesson && swapQ && (
        <div className="card p-2 text-xs space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-zinc-500">
            <span>合法調法 <b className="text-zinc-700">{swapQ.options.length}</b> 種
              （直接搬 {swapQ.options.filter(o => o.kind === 'move').length}、兩角 {swapQ.options.filter(o => o.kind === 'swap2').length}、三角 {swapQ.options.filter(o => o.kind === 'swap3').length}）
              ，依罰分變化排序（越低越好），前 12 種：</span>
            {chain === 'none' && <span className="text-amber-700">找不到四層內的多角鏈（可能教室全滿或被鎖課卡死）</span>}
          </div>
          {chain && chain !== 'none' && chain !== 'busy' && (
            <div className="flex items-center gap-2 border border-amber-300 bg-amber-50 rounded-sm p-1.5"
              onMouseEnter={() => setHoverOpt(chain)} onMouseLeave={() => setHoverOpt(null)}>
              <span className="text-amber-800">🔗 多角鏈（{chain.moves.length} 堂）・{deltaZh(chain.softDelta)}：{chain.desc}</span>
              <button onClick={() => applyOption(chain)} className="btn btn-primary text-xs py-0.5 ml-auto shrink-0">套用</button>
            </div>
          )}
          {swapQ.options.length > 0 && (
            <ul className="grid gap-1 md:grid-cols-2">
              {swapQ.options.slice(0, 12).map((o, i) => (
                <li key={i} onMouseEnter={() => setHoverOpt(o)} onMouseLeave={() => setHoverOpt(null)}
                  className={`flex items-center gap-2 rounded-sm border px-1.5 py-1 ${o.kind === 'move' ? 'border-emerald-200 bg-emerald-50/50' : o.kind === 'swap2' ? 'border-sky-200 bg-sky-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                  <span className={`shrink-0 px-1 rounded-sm text-white ${o.kind === 'move' ? 'bg-emerald-500' : o.kind === 'swap2' ? 'bg-sky-500' : 'bg-amber-500'}`}>{KIND_ZH[o.kind]}</span>
                  <span className={`shrink-0 font-mono ${o.softDelta < 0 ? 'text-emerald-700' : o.softDelta > 0 ? 'text-red-600' : 'text-zinc-500'}`}>{o.softDelta > 0 ? '+' : ''}{o.softDelta}</span>
                  <span className="text-zinc-600 truncate" title={o.desc}>{o.desc}</span>
                  <button onClick={() => applyOption(o)} className="btn btn-secondary text-xs py-0 ml-auto shrink-0">套用</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!embedded && <div className="flex gap-1 flex-wrap">
        {GRADES.filter(g => (classCounts[g] ?? 0) > 0).map(g => (
          <button key={g} onClick={() => setGradeSel(g)}
            className={`text-xs px-2 py-1 rounded-sm border ${gradeSel === g ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200'}`}>
            {GRADE_LABEL[g]}
          </button>
        ))}
      </div>}

      {mode !== 'class' && !focusId && (
        <p className="text-sm text-zinc-400 text-center py-4">{mode === 'teacher' ? '請選擇教師。' : '請選擇教室。'}</p>
      )}
      {mode !== 'class' && focusId && (
        <div className="card p-3 max-w-md space-y-1">
          <div className="text-sm font-semibold text-zinc-700">
            {mode === 'teacher' ? (teacherOptions.find(t => t.id === focusId)?.name ?? nameOf(focusId)) : (rooms.find(r => r.id === focusId)?.label ?? '教室')}
            <span className="text-xs font-normal text-zinc-400 ml-2">{mode === 'teacher' ? '點一堂課可調；彩格＝這堂課可以落到的時段（本土語、鎖課不在此列）' : '點一堂課可調；彩格＝這堂課可以落到的時段（教室由系統重配，未必還在這間）'}</span>
          </div>
          <table className="w-full table-fixed border-collapse text-[10px]">
            <thead>
              <tr><th className="w-5 text-zinc-400 font-normal"></th>
                {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxPeriods }, (_, i) => i + 1).map(q => (
                <tr key={q}>
                  <td className="text-zinc-400 text-center">{q}</td>
                  {SCHEDULE_DAYS.map(d => {
                    const k = `${d}-${q}`
                    const ls = focusCells.get(k) ?? []
                    const off = focusOff.has(k)
                    const opt = sel?.type === 'lesson' ? optByCell.get(k) : undefined
                    const why = sel?.type === 'lesson' && !opt && swapQ ? swapQ.why[k] : undefined
                    const isSelSrc = sel?.type === 'lesson' && ls.some(x => x.id === sel.id)
                    const isPartner = !!(hoverOpt && ls.some(x => hoverOpt.partnerIds.includes(x.id)))
                    const ringKind = opt ? (opt.kind === 'move' ? 'ring-2 ring-emerald-400' : opt.kind === 'swap2' ? 'ring-2 ring-sky-400' : 'ring-2 ring-amber-400') : ''
                    const ring = isSelSrc ? 'ring-2 ring-zinc-700' : isPartner ? 'ring-2 ring-amber-500 ring-offset-1' : ringKind
                    const dim = sel && !isSelSrc && !isPartner && !opt ? 'opacity-40' : ''
                    const hoverProps = opt ? { onMouseEnter: () => setHoverOpt(opt), onMouseLeave: () => setHoverOpt(null) } : {}
                    const title = opt ? `${KIND_ZH[opt.kind]}・${deltaZh(opt.softDelta)}${opt.kind !== 'move' ? '：' + opt.desc : ''}` : why ?? (off ? (mode === 'teacher' ? '不排課時段' : '教室不開放') : undefined)
                    const onClick = () => {
                      if (opt) { applyOption(opt); return }
                      if (isSelSrc) { setSel(null); return }
                      const mine = ls[0]
                      if (mine) setSel({ type: 'lesson', id: mine.id })
                    }
                    return (
                      <td key={d} className="p-0.5">
                        <button onClick={onClick} title={title} {...hoverProps}
                          className={`relative w-full h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center ${ls.length ? (ls[0].parity !== 'weekly' ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900') : off ? 'bg-zinc-100 border-zinc-200 text-zinc-300' : 'border-dashed border-zinc-200 text-zinc-300'} ${ring} ${dim} ${ls.length || opt ? 'cursor-pointer' : 'cursor-default'}`}>
                          {opt && <span className={`absolute top-0 right-0 text-[8px] leading-none px-0.5 rounded-bl-sm text-white ${opt.softDelta < 0 ? 'bg-emerald-500' : opt.softDelta > 0 ? 'bg-red-400' : 'bg-zinc-400'}`}>{opt.softDelta > 0 ? '+' : ''}{opt.softDelta}</span>}
                          {ls.length === 0 && off && <span className="text-[8px]">—</span>}
                          {ls.slice(0, 2).map(x => (
                            <span key={x.id} className="truncate w-full">
                              <span className="font-medium">{x.classLabel}</span>
                              <span className="opacity-80"> {mode === 'room' ? `${x.teacherName}・${x.subject}` : x.subject}</span>
                              {x.parity !== 'weekly' && <span className="text-[8px] opacity-70">{x.parity === 'odd' ? '單' : '雙'}</span>}
                              {mode === 'teacher' && x.coTeacherId && <span className="text-rose-700">★</span>}
                            </span>
                          ))}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'class' && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
                {!embedded && (hrRow?.confirmed_at
                  ? <span className="text-[10px] px-1 py-0 rounded-sm bg-green-100 text-green-700 border border-green-200">✓ 已確認</span>
                  : <span className="text-[10px] px-1 py-0 rounded-sm bg-amber-50 text-amber-600 border border-amber-200">填 {filledOf(ck)} 節</span>)}
                {!embedded && hrRow?.confirmed_at && (
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
                        const opt = sel?.type === 'lesson' && selLesson?.classKey === ck ? optByCell.get(k) : undefined
                        const isPartner = !!(hoverOpt && occ && hoverOpt.partnerIds.includes(occ.id))
                        const ringKind = opt ? (opt.kind === 'move' ? 'ring-2 ring-emerald-400' : opt.kind === 'swap2' ? 'ring-2 ring-sky-400' : 'ring-2 ring-amber-400') : st?.ok ? (hrSubj && sel?.type === 'lesson' ? 'ring-2 ring-violet-400' : 'ring-2 ring-emerald-400') : ''
                        const ring = isSelSrc ? 'ring-2 ring-zinc-700' : isPartner ? 'ring-2 ring-amber-500 ring-offset-1' : ringKind
                        const dim = adjustMode && sel && !isSelSrc && !isPartner && st && !st.ok ? 'opacity-40' : ''
                        const title = st ? st.why : undefined
                        const hoverProps = opt ? { onMouseEnter: () => setHoverOpt(opt), onMouseLeave: () => setHoverOpt(null) } : {}
                        if (occ) {
                          const bi = occ.parity !== 'weekly'
                          const dispSlot = bi ? `${occ.day}-${occ.parity === 'odd' ? occ.period : occ.period + 1}` : k
                          if (bi && k !== dispSlot) {
                            // 單雙週配對格：顯示導師的配對課（整塊兩節）；不參與調整互動（由排課選填處理）
                            const pairSubj = hrRow?.cells?.[k]
                            const tag = occ.parity === 'odd' ? '雙週・兩節' : '單週・兩節'
                            return (
                              <td key={d} className="p-0.5">
                                <div title="單雙週配對格：導師課由排課選填填入（同科整塊兩節）"
                                  className={`w-full h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center ${pairSubj ? 'bg-emerald-50 border-violet-300 text-emerald-800' : 'border-dashed border-violet-300 text-violet-400'}`}>
                                  <span className="truncate w-full font-medium">{pairSubj ?? '導師'}</span>
                                  <span className="text-[8px] opacity-70">{tag}</span>
                                </div>
                              </td>
                            )
                          }
                          return (
                            <td key={d} className="p-0.5">
                              <button onClick={() => clickCell(ck, k)} title={title} {...hoverProps}
                                className={`relative w-full h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center ${bi ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900'} ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                                {opt && <span className={`absolute top-0 right-0 text-[8px] leading-none px-0.5 rounded-bl-sm text-white ${opt.softDelta < 0 ? 'bg-emerald-500' : opt.softDelta > 0 ? 'bg-red-400' : 'bg-zinc-400'}`}>{opt.softDelta > 0 ? '+' : ''}{opt.softDelta}</span>}
                                <span className="truncate w-full font-medium">{occ.subject}{occ.coTeacherId && <span className="text-rose-700">★</span>}</span>
                                <span className="truncate w-full text-[8px] opacity-70">{occ.teacherName}{occ.coTeacherId && `＋${occ.coTeacherName ?? '外師'}`}</span>
                                {bi && <span className="text-[8px] opacity-70">{occ.parity === 'odd' ? '單週' : '雙週'}</span>}
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
                            <button onClick={() => clickCell(ck, k)} title={title ?? (must ? '導師不排課時段（僅科任課可入）' : undefined)} {...hoverProps}
                              className={`relative w-full h-9 rounded-sm border border-dashed ${must ? 'border-red-300 text-red-300' : 'border-zinc-200 text-zinc-300'} ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                              {opt && <span className={`absolute top-0 right-0 text-[8px] leading-none px-0.5 rounded-bl-sm text-white ${opt.softDelta < 0 ? 'bg-emerald-500' : opt.softDelta > 0 ? 'bg-red-400' : 'bg-zinc-400'}`}>{opt.softDelta > 0 ? '+' : ''}{opt.softDelta}</span>}
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
      </div>}

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
