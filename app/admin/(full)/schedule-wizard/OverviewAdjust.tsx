'use client'

import { useMemo, useState, useRef, useEffect } from 'react'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, OFF_CATEGORY_LABEL, normalizeSubject, subjectRank, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import { roomsFromConfig, reassignRooms, SwapFinder, type PlacedResult, type EngineInput, type SwapOption } from '@/lib/schedule-engine'
import ChainAdjustModal, { type ChainSeed } from './ChainAdjustModal'

export interface HomeroomRow { class_key: string; teacher_id: string; cells: Record<string, string>; confirmed_at: string | null }
/** 不進引擎的固定課（本土語原班／語別場次）：教師／教室檢視要一併顯示，唯讀 */
export interface ExtraCell { slot: string; main: string; sub: string }
export interface AdjustExtras { teacher: Map<string, ExtraCell[]>; room: Map<string, ExtraCell[]>; roomNames: Record<string, string> }

interface Props {
  year: number
  planStatus: string
  setPlanStatus: (s: string) => void
  savedPlan: Record<string, unknown>
  planGeneratedAt?: string | null   // 草稿版本令牌的起點（見 persist 的 409 處理）
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
  extras?: AdjustExtras     // 本土語（原班、語別場次）：教師／教室檢視顯示為灰格、不可調
  onPlacedChange?: (placed: PlacedResult[]) => void   // 調動後回報新課表（讓外層教師／教室視圖同步）
  onPersisted?: () => void                             // 成功存檔後回報（外層據此知道資料庫已是微調後的草稿）
  onDirtyChange?: (unsaved: number) => void            // 未儲存的微調筆數（外層據此攔截重跑／換版本）
  /** 外部（課表體檢的熱力圖）要求開啟連鎖調課；nonce 變了就開一次。 */
  chainRequest?: { seed: ChainSeed; nonce: number }
  onChainConsumed?: () => void   // 開過了就通知外面清掉，否則換版本預覽重新掛載時會再開一次
  /** 存了新版本：外層要重抓版本清單，並把「目前顯示版本」切到這一份
   *  （不然畫面上寫的還是上一版，但看到的內容已經是新的） */
  onVersionSaved?: (v: { id?: string; seq?: number | null }) => void
  /** 存檔成功後回報資料庫的新戳記。這個元件會被重掛（切版本、換微調起點），
   *  戳記只放在自己身上的話會被重設成頁面剛載入時的舊值，下次存檔就自己撞自己。 */
  onPlanAt?: (at: string) => void
  /** 撤回發布（回草稿重排）。動作本身在上層——它要先存版本、還要提醒導師已填的內容，
   *  但按鈕要跟另外兩顆階段鈕放在一起，不然三個方向散在畫面兩端沒人看得懂。 */
  onUnpublish?: () => void
  /** 畫面上這份是預覽來的版本，而這些班的導師課和資料庫不同：套用時要一起寫回去，
   *  只寫這次動到的班會變成「這一版的科任＋今天的導師課」的混合體。 */
  hrForceClasses?: string[]
  onGradeChange?: (g: number) => void                  // 內嵌時「定位」到某班要切年級
  onDiscard?: () => void                               // 內嵌時「放棄全部微調」（回到這一輪的起點、清掉草稿）
}

const EMPTY_EXTRAS = new Map<string, ExtraCell[]>()   // 穩定引用：避免每次 render 產生新 Map 讓子元件重算
type Sel = { type: 'lesson'; id: string } | { type: 'hr'; classKey: string; slot: string } | null
interface Adjustment { at: string; desc: string; note?: string }

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const slotZh = (s: string) => { const [d, p] = s.split('-'); return `週${DAY_ZH[Number(d)]}第${p}節` }

/** 年級總覽＋調整模式（發布後）：
 *  防呆（灰燈硬擋）：鎖課、導師不排課格只能科任課、科任自身不排課、老師撞課（週型感知）、
 *  導師課不跨班。連堂可拆、上空上空不擋（老師自行協調的結果）。
 *  每步調整後教室自動重分配（管理教師優先），零警告。 */
/** 待排區項目：科任課（整堂搬走）或導師課（格子上的科目字串）。 */
type TrayItem =
  | { key: string; kind: 'lesson'; lesson: PlacedResult }
  | { key: string; kind: 'hr'; classKey: string; subject: string }

export default function OverviewAdjust({ year, planStatus, setPlanStatus, savedPlan, homeroomRows, config, classCounts, teacherNames, baseHash, engineInput, embedded = false, gradeSel: gradeSelProp, mode: modeProp, focusId: focusIdProp, extras, onPlacedChange, onPersisted, onGradeChange, onDiscard, onDirtyChange, chainRequest, onChainConsumed, onVersionSaved, onPlanAt, onUnpublish, hrForceClasses, planGeneratedAt }: Props) {
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
  const [undoStack, setUndoStack] = useState<{ placed: PlacedResult[]; hr: Record<string, HomeroomRow>; adjustments: Adjustment[]; tray: TrayItem[] }[]>([])
  const [sel, setSel] = useState<Sel>(null)
  const [gradeSelState, setGradeSel] = useState<number>(GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1)
  const gradeSel = gradeSelProp ?? gradeSelState
  // 預覽就是預覽：點課即調、亮燈建議、自由編輯與待排區全部關閉，調整一律走「連鎖調課」modal（標題列的 ⇄）。
  // 課務組的習慣是「不妥位置 → 妥適位置 → 連鎖」，跟這裡的「選一堂課 → 點彩格」是兩套思路，並存只會混淆。
  // 這一行是總開關：改回 true 就能救回舊的互動（相關程式碼都還在，等 modal 在課務組手上跑順再刪）。
  const adjustMode = false
  // 草稿的版本令牌：讀到的 generated_at 一起送回去，對不上代表別人在你編輯期間改過（兩台電腦同開）
  const planAtRef = useRef<string | undefined>(planGeneratedAt ?? undefined)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [snapState, setSnapState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // 微調＝暫存：改動只在記憶體，按「儲存微調」才寫入課表。未儲存時離開頁面會攔截確認，
  // 不存就離開＝資料庫維持原狀（回來看到的是沒改過的那份）。
  const [unsaved, setUnsaved] = useState(0)
  // 自由編輯：完全不檢查任何硬／軟規則，全由人工決定。結果只能「另存為版本」，不會寫進正式課表。
  const [freeMode, setFreeMode] = useState(false)
  const [freeTouched, setFreeTouched] = useState(false)
  // 待排區（自由編輯用）：從課表拿下來、還沒放回去的課。點課＝拿下來，點空格＝放回去。
  const [tray, setTray] = useState<TrayItem[]>([])
  const [chainSeed, setChainSeed] = useState<ChainSeed | null>(null)    // 連鎖調課 modal 的起始課表
  const [chainNonce, setChainNonce] = useState(0)
  const [trayPick, setTrayPick] = useState<string | null>(null)          // 選中的待排項目
  const [slotPick, setSlotPick] = useState<{ classKey: string; slot: string } | null>(null)   // 先點的空格
  const pendingHrRef = useRef<Set<string>>(new Set())   // 待寫入的導師課班級（儲存時一併 PATCH）
  // 防守：外面換了一份課表（換版本預覽、發布後重載…）就跟著更新。
  // placed／hr 是在掛載時從 props 抄進 state 的，只靠外面記得換 key 太脆弱——
  // 少換一次就會停在上一版，而且之後怎麼切都不會動。有未存的微調時不覆蓋，免得洗掉使用者的工作。
  const lastPlanRef = useRef(savedPlan)
  const lastHrRef = useRef(homeroomRows)
  useEffect(() => {
    if (savedPlan === lastPlanRef.current && homeroomRows === lastHrRef.current) return
    const planChanged = savedPlan !== lastPlanRef.current
    lastPlanRef.current = savedPlan
    lastHrRef.current = homeroomRows
    if (unsaved > 0) return
    if (planChanged) {
      setPlaced((savedPlan.placed as PlacedResult[] | undefined) ?? [])
      setAdjustments((savedPlan.adjustments as Adjustment[] | undefined) ?? [])
      setTray([]); setTrayPick(null); setSlotPick(null); setSel(null); setUndoStack([])
    }
    setHr(Object.fromEntries(homeroomRows.map(r => [r.class_key, { ...r, cells: { ...r.cells } }])))
  }, [savedPlan, homeroomRows, unsaved])

  // 用 effect 不用 render 期間處理：這是一次性的外部指令，開過就要通知外面清掉
  useEffect(() => {
    if (!chainRequest || chainRequest.nonce === chainNonce) return
    setChainNonce(chainRequest.nonce)
    setChainSeed(chainRequest.seed)
    onChainConsumed?.()
  }, [chainRequest, chainNonce, onChainConsumed])

  const markDirty = (changedHrClasses: string[]) => {
    for (const ck of changedHrClasses) pendingHrRef.current.add(ck)
    setUnsaved(n => { const next = n + 1; onDirtyChange?.(next); return next })
  }

  /** 把指定內容存成一份版本快照。
   *  微調是每步自動寫進課表的，復原堆疊只在記憶體、換頁就沒了；故第一次微調前會自動備份一份（silent），
   *  批次調完也可按「存為版本」再留一個點。
   *  罰分不重算——引擎的計分要完整 EngineInput，這裡沒有；故標明數值為微調前的，避免被拿去比較。 */
  async function saveVersion(opts: { placed: PlacedResult[]; adjustments: Adjustment[]; label: string; silent?: boolean; unplaced?: unknown[]; hr?: Record<string, HomeroomRow> }) {
    if (!opts.silent) setSnapState('saving')
    try {
      const pens = (savedPlan.penalties as { key: string; label: string; count: number; points: number }[] | undefined) ?? []
      const res = await fetch('/api/admin/schedule-plan-versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, source: opts.adjustments.length > 0 ? 'manual' : 'engine', baseHash, weights: config.weights,
          label: opts.label,
          summary: {
            placed: opts.placed.length,
            unplaced: opts.unplaced ? opts.unplaced.length : (Array.isArray(savedPlan.unplaced) ? (savedPlan.unplaced as unknown[]).length : 0),
            uncovered: Array.isArray(savedPlan.uncoveredMustFill) ? (savedPlan.uncoveredMustFill as unknown[]).length : 0,
            mustCount: pens.filter(x => Number(x.points) >= 1e6).reduce((a, x) => a + (x.count ?? 0), 0),
            softPenalty: Math.round(Number(savedPlan.softPenalty ?? 0)),
            note: opts.adjustments.length > 0
              ? '手動微調後保存；罰分為微調前的數值、未重算，不可與其他版本比較。'
              : '微調前的自動備份；罰分為引擎產生時的數值。',
            rules: pens.filter(x => Number(x.points) > 0).map(x => ({ key: x.key, label: x.label, count: x.count, points: Math.round(Number(x.points)) })),
          },
          // 導師課存在另一張表，不一起收進版本的話「回到某一版」只還原得了科任
          plan: { ...savedPlan, placed: opts.placed, adjustments: opts.adjustments,
            homeroom: Object.fromEntries(Object.entries(opts.hr ?? hr).map(([k, v]) => [k, v.cells ?? {}])),
            ...(opts.unplaced ? { unplaced: opts.unplaced } : {}) },
        }),
      })
      if (!opts.silent) setSnapState(res.ok ? 'saved' : 'error')
      if (res.ok) {
        const d = await res.json().catch(() => ({}))
        onVersionSaved?.({ id: d.id, seq: d.seq })
        return (d.id as string | undefined) ?? true
      }
      return res.ok
    } catch { if (!opts.silent) setSnapState('error'); return false }
  }
  const snapshot = () => saveVersion({ placed, adjustments, label: `手動微調後（${adjustments.length} 筆調整）` })

  /** 儲存微調：寫入課表（發布中的話老師端立刻看到）＋ 自動留一份版本可回頭。 */
  async function saveAdjust() {
    const ok = await persist(placed, hr, adjustments, Array.from(pendingHrRef.current))
    if (!ok) return
    pendingHrRef.current.clear()
    setUnsaved(0); onDirtyChange?.(0)
    void saveVersion({ placed, adjustments, label: `手動微調後（${adjustments.length} 筆調整）`, silent: true })
  }
  /** 自由編輯的結果只另存成版本，不動正式課表——要採用請到版本紀錄預覽後發布。 */
  async function saveFreeVersion() {
    const now = new Date()
    const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (tray.length > 0 && !confirm(`待排區還有 ${tray.length} 堂沒放回課表。\n存下去這份版本就會少這 ${tray.length} 堂課（列為未排）。確定要存嗎？`)) return
    const ok = await saveVersion({ placed, adjustments, label: `自由編輯 ${stamp}`,
      unplaced: tray.filter((t): t is Extract<TrayItem, { kind: 'lesson' }> => t.kind === 'lesson')
        .map(t => ({ lesson: t.lesson, reason: '自由編輯：留在待排區未排回' })) })
    if (!ok) return
    setUnsaved(0); onDirtyChange?.(0)
    alert(`已存成版本「自由編輯 ${stamp}」。\n\n這份不會自動變成正式課表——要採用請到「版本紀錄」預覽後發布。`)
  }
  useUnsavedGuard(unsaved > 0, `有 ${unsaved} 筆微調尚未儲存，離開將全部捨棄（課表會維持微調前的樣子）。確定要離開嗎？`)
  const [busy, setBusy] = useState(false)

  const rooms = useMemo(() => roomsFromConfig(config), [config])
  const nameOf = (id: string) => teacherNames[id] ?? '？'

  // ── 索引 ──
  const lessonById = useMemo(() => new Map(placed.map(p => [p.id, p])), [placed])
  const teacherOptions = useMemo(() => {
    // 領域＝這位老師節數最多的那一科（英語 14 節＋國際教育 7 節 → 領域算英語）。
    // 本土語那類不進引擎的固定課也計入，不然只教本土語的老師會沒有領域。
    const bySubj = new Map<string, Map<string, number>>()
    const addSubj = (tid: string, name: string, n: number) => {
      const m2 = bySubj.get(tid) ?? new Map<string, number>()
      m2.set(name, (m2.get(name) ?? 0) + n); bySubj.set(tid, m2)
    }
    for (const p of placed) addSubj(p.teacherId, normalizeSubject(p.subject), p.size)
    for (const [tid, cells] of Array.from(extras?.teacher ?? [])) for (const c of cells) addSubj(tid, normalizeSubject(c.main), 1)
    const domainOf = (tid: string) => {
      const m2 = bySubj.get(tid)
      if (!m2) return ''
      return Array.from(m2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))[0][0]
    }
    const m = new Map<string, { id: string; name: string; co: boolean; domain: string }>()
    for (const p of placed) {
      if (!m.has(p.teacherId)) m.set(p.teacherId, { id: p.teacherId, name: p.teacherName, co: false, domain: domainOf(p.teacherId) })
      if (p.coTeacherId && !m.has(p.coTeacherId)) m.set(p.coTeacherId, { id: p.coTeacherId, name: p.coTeacherName ?? '外師', co: true, domain: '外師（協同）' })
    }
    for (const tid of Array.from(extras?.teacher.keys() ?? [])) if (!m.has(tid)) m.set(tid, { id: tid, name: teacherNames[tid] ?? '？', co: false, domain: domainOf(tid) })
    // 外師排最後，其餘依領域分組、組內依姓名
    return Array.from(m.values()).sort((a, b) =>
      Number(a.co) - Number(b.co)
      || (subjectRank(a.domain) - subjectRank(b.domain))
      || a.domain.localeCompare(b.domain, 'zh-Hant')
      || a.name.localeCompare(b.name, 'zh-Hant'))
  }, [placed, extras, teacherNames])
  const extraCells = useMemo(() => {
    const m = new Map<string, ExtraCell[]>()
    if (!focusId || mode === 'class') return m
    const list = mode === 'teacher' ? extras?.teacher.get(focusId) : extras?.room.get(focusId)
    for (const e of list ?? []) m.set(e.slot, [...(m.get(e.slot) ?? []), e])
    return m
  }, [extras, mode, focusId])
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
  /** 會變差（罰分 > 0）的方案預設不顯示：課務組要的微調是「不影響分數」的 0 分方案；負分＝有更好的排法，醒目提醒。 */
  const [showWorse, setShowWorse] = useState(false)
  // 會造成必須級違反（罰分 +10 萬以上）的方案一律不給，勾了「顯示會變差」也不給
  const MUST = 1e5
  const legalOptions = useMemo(() => (swapQ?.options ?? []).filter(o => o.softDelta < MUST), [swapQ])
  const visibleOptions = useMemo(() => legalOptions.filter(o => showWorse || o.softDelta <= 0), [legalOptions, showWorse])
  const betterCount = legalOptions.filter(o => o.softDelta < 0).length
  const zeroCount = legalOptions.filter(o => o.softDelta === 0).length
  const worseCount = legalOptions.filter(o => o.softDelta > 0).length
  /** 被點的課所在班級：每格最好的調法（已依罰分排序，取第一個）；被藏起來的正分方案給灰格原因 */
  const optByCell = useMemo(() => {
    const m = new Map<string, SwapOption>()
    for (const o of visibleOptions) if (!m.has(o.targetSlot)) m.set(o.targetSlot, o)
    return m
  }, [visibleOptions])
  const hiddenWhy = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of swapQ?.options ?? []) {
      if (m.has(o.targetSlot)) continue
      if (o.softDelta >= MUST) m.set(o.targetSlot, `會造成必須級違反（${(o.breakdown ?? []).filter(b => b.delta >= MUST).map(b => b.label).join('、') || '必須級規則'}）——不提供`)
      else if (o.softDelta > 0 && !showWorse) m.set(o.targetSlot, `可調但會變差（罰分 +${o.softDelta}）——打開「顯示會變差的方案」才可用`)
    }
    return m
  }, [swapQ, showWorse])

  const [hoverOpt, setHoverOpt] = useState<SwapOption | null>(null)
  const [detailOpt, setDetailOpt] = useState<SwapOption | null>(null)   // 點了「ⓘ」釘住看拆解（滑過會跳，改點擊）
  const [chain, setChain] = useState<SwapOption | null | 'none' | 'busy'>(null)
  const KIND_ZH: Record<SwapOption['kind'], string> = { move: '直接搬', swap2: '兩角互換', swap3: '三角互調', chain: '多角鏈' }
  // 必須級規則（必排未覆蓋、上空上空、導師連四…）在引擎裡是 1e6 級計分：變化量破十萬就是在修／破必須級，不是軟分
  const deltaZh = (d: number) => Math.abs(d) >= MUST
    ? (d < 0 ? `修正必須級違反（目前課表在現在的設定下有必須級違反，這一步能修掉）` : `會造成必須級違反`)
    : d === 0 ? '罰分不變' : d < 0 ? `罰分 −${Math.abs(d)}（變好）` : `罰分 +${d}（變差，越少越好）`
  const bdZh = (o: SwapOption) => (o.breakdown ?? []).filter(b => Math.abs(b.delta) < MUST).slice(0, 4).map(b => `${b.label} ${b.delta > 0 ? '+' : ''}${b.delta}`).join('・')
  const deltaBadge = (d: number) => Math.abs(d) >= MUST ? (d < 0 ? '修必須級' : '違反必須級') : d < 0 ? `更好 ${d}` : `+${d}`

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
  // 不排課備註：教師 → slot → 「類別・說明」，滑過格子時看得到為什麼（輔導團／進修／處理行政…）
  const offNote = useMemo(() => {
    const m: Record<string, Record<string, string>> = {}
    for (const p of config.personalOff) {
      if (!p.teacherId || p.mode === 'on') continue
      const txt = [OFF_CATEGORY_LABEL[p.category] ?? '', p.note?.trim()].filter(Boolean).join('・')
      for (const s2 of p.slots) (m[p.teacherId] ??= {})[s2] = txt
    }
    return m
  }, [config])
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
    if (freeMode) return null   // 自由編輯不用選中→亮燈那一套，改走待排區
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
        if (o) return { ok: true, why: `${KIND_ZH[o.kind]}・${deltaZh(o.softDelta)}${bdZh(o) ? `（${bdZh(o)}）` : ''}${o.kind !== 'move' ? '：' + o.desc : ''}` }
        if (!hrSubject) return { ok: false, why: hiddenWhy.get(slot) ?? swapQ.why[slot] ?? '不合法' }
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

  // ── 待排區：拿下來／放回去 ──
  const trayLabel = (it: TrayItem) => it.kind === 'lesson'
    ? `${it.lesson.classLabel} ${it.lesson.subject}（${it.lesson.teacherName}）${it.lesson.size === 2 ? '・連堂' : ''}`
    : `${classLabelOf(it.classKey)} 導師課「${it.subject}」`
  /** 把課表上的一堂課（或導師課）拿到待排區，格子變空。 */
  function parkLesson(l: PlacedResult) {
    const it: TrayItem = { key: `L${l.id}`, kind: 'lesson', lesson: l }
    setTray(t => [...t, it]); setTrayPick(it.key); setSlotPick(null)
    applyAdjust(placed.filter(x => x.id !== l.id), hr, `${l.classLabel}：${l.subject}（${l.teacherName}）${slotZh(`${l.day}-${l.period}`)} → 待排區`, [])
  }
  function parkHr(classKey: string, slot: string, subject: string) {
    const it: TrayItem = { key: `H${classKey}|${slot}|${subject}|${Date.now()}`, kind: 'hr', classKey, subject }
    const row = hr[classKey]; const cells = { ...row.cells }; delete cells[slot]
    setTray(t => [...t, it]); setTrayPick(it.key); setSlotPick(null)
    applyAdjust(placed, { ...hr, [classKey]: { ...row, cells } }, `${classLabelOf(classKey)}：導師課「${subject}」${slotZh(slot)} → 待排區`, [classKey])
  }
  /** 把待排區的項目放進某個空格。 */
  const ANY_CLASS = '*'   // 教師／教室檢視點的格子只決定「時段」，班級由那堂課自己帶
  function placeFromTray(key: string, classKey: string, slot: string) {
    const it = tray.find(x => x.key === key); if (!it) return
    const [d, q] = slot.split('-').map(Number)
    const own = it.kind === 'lesson' ? it.lesson.classKey : it.classKey
    if (classKey !== ANY_CLASS && own !== classKey) { alert('這堂課屬於別的班，只能放回自己班的格子。'); return }
    classKey = own
    if (it.kind === 'lesson' && it.lesson.size === 2 && q >= 7) { alert('連堂需要相鄰兩節，放不進第 7 節。'); return }
    setTray(t => t.filter(x => x.key !== key)); setTrayPick(null); setSlotPick(null)
    if (it.kind === 'lesson') {
      applyAdjust([...placed, { ...it.lesson, day: d, period: q }], hr,
        `待排區 → ${it.lesson.classLabel}：${it.lesson.subject}（${it.lesson.teacherName}）${slotZh(slot)}`, [])
    } else {
      const row = hr[classKey]
      applyAdjust(placed, { ...hr, [classKey]: { ...row, cells: { ...row.cells, [slot]: it.subject } } },
        `待排區 → ${classLabelOf(classKey)}：導師課「${it.subject}」${slotZh(slot)}`, [classKey])
    }
  }
  /** 待排區拆連堂：一堂兩節拆成兩個單節，之後可分開放到不同時段（自由編輯用；一般模式在課表上按 ✂）。 */
  function splitTrayItem(key: string) {
    const it = tray.find(x => x.key === key)
    if (!it || it.kind !== 'lesson' || it.lesson.size !== 2 || it.lesson.parity !== 'weekly') return
    const a = { ...it.lesson, id: `${it.lesson.id}~a`, size: 1 as const }
    const b = { ...it.lesson, id: `${it.lesson.id}~b`, size: 1 as const }
    setTray(t => t.flatMap(x => x.key !== key ? [x] : [
      { key: `L${a.id}`, kind: 'lesson' as const, lesson: a },
      { key: `L${b.id}`, kind: 'lesson' as const, lesson: b },
    ]))
    setTrayPick(`L${a.id}`)
    applyAdjust(placed, hr, `${it.lesson.classLabel}：${it.lesson.subject}（${it.lesson.teacherName}）連堂拆為兩個單節（待排區）`, [])
  }
  function clickTray(key: string) {
    if (slotPick) { placeFromTray(key, slotPick.classKey, slotPick.slot); return }
    setTrayPick(k => k === key ? null : key)
  }

  /** 自由編輯下的違規清點——只是告知，不擋任何操作。 */
  const freeIssues = useMemo(() => {
    if (!freeTouched) return null
    const clash: string[] = [], inLock: string[] = [], offSlot: string[] = []
    const occ = new Map<string, Map<string, PlacedResult[]>>()
    for (const x of placed) {
      const slots = x.size === 2 ? [`${x.day}-${x.period}`, `${x.day}-${x.period + 1}`] : [`${x.day}-${x.period}`]
      const tm = occ.get(x.teacherId) ?? new Map<string, PlacedResult[]>()
      for (const sl of slots) tm.set(sl, [...(tm.get(sl) ?? []), x])
      occ.set(x.teacherId, tm)
      const locks = lockOf(x.classKey), teach = teachableOf(x.classKey)
      for (const sl of slots) {
        if (locks[sl]) inLock.push(`${x.classLabel} ${x.subject} ${slotZh(sl)}`)
        else if (!teach.has(sl)) offSlot.push(`${x.classLabel} ${x.subject} ${slotZh(sl)}`)
      }
    }
    occ.forEach((tm, tid) => tm.forEach((arr, sl) => {
      // 單雙週互補不算衝堂
      const conflict = arr.length > 1 && arr.some((a, i) => arr.some((b, j) => i < j && (a.parity === 'weekly' || b.parity === 'weekly' || a.parity === b.parity)))
      if (conflict) clash.push(`${nameOf(tid)} ${slotZh(sl)}：${arr.map(x => x.classLabel).join('、')}`)
    }))
    return { clash, inLock, offSlot, total: clash.length + inLock.length + offSlot.length }
  }, [freeTouched, placed, config])

  // ── 套用調整 ──
  function pushUndo() {
    setUndoStack(prev => [...prev.slice(-19), {
      placed: placed.map(p => ({ ...p })),
      hr: Object.fromEntries(Object.entries(hr).map(([k, v]) => [k, { ...v, cells: { ...v.cells } }])),
      adjustments: [...adjustments],
      tray: [...tray],
    }])
  }

  async function persist(nextPlaced: PlacedResult[], nextHr: Record<string, HomeroomRow>, nextAdj: Adjustment[], changedHrClasses: string[], versionId?: string) {
    setSaveState('saving')
    try {
      // versionId＝這份課表對應哪一版。重新整理後才有辦法標出「目前顯示版本」，
      // 否則接續草稿只知道內容、不知道是哪一版。
      const plan = { ...savedPlan, placed: nextPlaced, adjustments: nextAdj, status: planStatus,
        ...(versionId ? { versionId } : {}) }
      const res = await fetch('/api/admin/schedule-plan', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, plan, expectedAt: planAtRef.current }),
      })
      if (res.status === 409) {
        const d = await res.json().catch(() => ({}))
        setSaveState('error')
        // 不一定是「有人同時在改」：這一頁開太久、另一個分頁存過、後台做過修復都會撞到。
        // 重點是給出路——被擋下後每按一次都會再擋一次，不講清楚就只能乾等。
        const when = d.currentAt ? new Date(d.currentAt).toLocaleString('zh-TW') : '（時間不明）'
        if (confirm(`存檔已擋下：你這一頁的課表不是最新的。\n\n`
          + `資料庫最後一次修改是 ${when}，比你開這一頁的時間還新。\n`
          + `可能是別人同時在調課，也可能是你另一個分頁存過、或這一頁開太久了。\n`
          + `（直接存下去會把那次修改整份蓋掉，所以系統先擋住。）\n\n`
          + `你剛剛這一步沒有留下來（課表和版本紀錄都沒有），重新整理後請重調一次。\n\n`
          + `要現在重新整理，載入最新的課表嗎？`)) location.reload()
        return
      }
      if (!res.ok) throw new Error()
      const okData = await res.json().catch(() => ({}))
      if (okData.generatedAt) { planAtRef.current = okData.generatedAt; onPlanAt?.(okData.generatedAt) }
      // 導師課逐班寫，而且要對過才算數。這裡出事最難發現：課表已經寫進去了，
      // 導師課沒跟上就會被搬過來的科任課壓在底下，畫面上看起來就是「導師課不見了」。
      for (const ck of changedHrClasses) {
        const want = nextHr[ck]?.cells ?? {}
        const r = await fetch('/api/admin/schedule-homeroom', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, classKey: ck, action: 'setCells', cells: want }),
        })
        const d = await r.json().catch(() => ({}))
        const same = r.ok && JSON.stringify(d.cells ?? null) === JSON.stringify(want)
        if (!same) {
          setSaveState('error')
          alert(`${classLabelOf(ck)} 的導師課沒有存進去。

`
            + `${d.error ?? (r.ok ? '存回來的內容和送出去的不一樣' : `HTTP ${r.status}`)}

`
            + `課表已經改了，但這一班的導師課還停在原位——`
            + `搬過去的科任課會把它壓住，看起來像導師課不見了。

`
            + `請重新整理，確認 ${classLabelOf(ck)} 的課表，必要時重調一次。`)
          return false
        }
      }
      // savedPlan 同步（後續 persist 以最新為基底）
      savedPlan.placed = nextPlaced
      savedPlan.adjustments = nextAdj
      setSaveState('saved')
      onPersisted?.()
      return true
    } catch { setSaveState('error'); return false }
  }

  function applyAdjust(nextPlaced: PlacedResult[], nextHr: Record<string, HomeroomRow>, desc: string, changedHrClasses: string[]) {
    if (freeMode) { setFreeTouched(true); desc = `【自由編輯】${desc}` }
    pushUndo()
    const adj: Adjustment = { at: new Date().toISOString(), desc }
    const nextAdj = [...adjustments, adj]
    const withRooms = reassignRooms(nextPlaced, rooms, config.weights)
    setPlaced(withRooms); onPlacedChange?.(withRooms)
    setHr(nextHr)
    setAdjustments(nextAdj)
    setSel(null)
    markDirty(changedHrClasses)
  }

  /** 套用查詢器給的一組搬動（直接搬／兩角／三角／多角鏈）：全部合法才套，教室由引擎狀態重配。 */
  function applyOption(opt: SwapOption) {
    if (!finder) return
    const r = finder.apply(opt.moves)
    if (!r.ok) { alert(r.error ?? '此調法已不合法'); return }
    const sl = lessonById.get(opt.lessonId) ?? (sel?.type === 'lesson' ? lessonById.get(sel.id) : null)
    const head = sl ? `${sl.classLabel}：` : ''
    applyAdjust(r.placed, hr, `${head}${KIND_ZH[opt.kind]}｜${opt.desc}｜${deltaZh(opt.softDelta)}`, [])
    setHoverOpt(null); setChain(null); setDetailOpt(null)
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
    if (freeMode) {
      // 自由編輯：點有課的格＝拿到待排區（並選中它）；點空格＝放入選中的待排課，沒選就先把這格記成目標
      if (occ) { parkLesson(occ); return }
      if (hrSubject) { parkHr(classKey, slot, hrSubject); return }
      if (trayPick) { placeFromTray(trayPick, classKey, slot); return }
      setSlotPick(prev => prev && prev.classKey === classKey && prev.slot === slot ? null : { classKey, slot })
      return
    }
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
      // 自由編輯不走查詢器（那條路徑會再驗一次硬規則）：同班有課就互換、沒課就直接搬
      const opt = !freeMode && l.classKey === classKey ? optByCell.get(slot) : undefined
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
    markDirty([])
  }

  function undo() {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    setUndoStack(prev => prev.slice(0, -1))
    setPlaced(last.placed); onPlacedChange?.(last.placed)
    setHr(last.hr)
    setAdjustments(last.adjustments)
    setTray(last.tray); setTrayPick(null); setSlotPick(null)
    setSel(null)
    markDirty(Object.keys(last.hr))
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
        ? `尚有 ${unconfirmed.length} 班導師未確認（${unconfirmed.slice(0, 6).map(classLabelOf).join('、')}${unconfirmed.length > 6 ? '…' : ''}）。\n仍要發布全校課表嗎？`
        : '所有導師皆已確認。發布後全校老師即可查看並下載課表。確定發布全校課表？'
      if (!confirm(msg)) return
    } else if (!confirm('收回全校課表？課表將暫停對全校公開，回到導師排課階段。')) return
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

  // ── 側欄對照小課表：班級檢視點一堂課 → 旁邊顯示該師整週；教師／教室檢視 → 旁邊顯示該班整週（唯讀） ──
  const dispSlots = (p: PlacedResult) => p.parity !== 'weekly'
    ? [`${p.day}-${p.parity === 'odd' ? p.period : p.period + 1}`]
    : p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
  const side = (() => {
    if (!selLesson) return null
    const selSlots = new Set(dispSlots(selLesson))
    if (mode === 'class') {
      const tid = selLesson.teacherId
      const cells = new Map<string, { text: string; sub?: string; kind: 'lesson' | 'extra' | 'hr' }[]>()
      for (const p of placed) {
        if (p.teacherId !== tid && p.coTeacherId !== tid) continue
        const sub = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        for (const sl of dispSlots(p)) cells.set(sl, [...(cells.get(sl) ?? []), { text: `${p.classLabel} ${p.subject}`, sub, kind: 'lesson' as const }])
      }
      for (const e of extras?.teacher.get(tid) ?? []) cells.set(e.slot, [...(cells.get(e.slot) ?? []), { text: e.main, sub: e.sub, kind: 'extra' as const }])
      return { title: `${selLesson.teacherName} 老師課表`, cells, off: new Set(engineInput.teacherBlocked[tid] ?? []), selSlots, periods: 7 }
    }
    const ck = selLesson.classKey
    const g = Number(ck.split('-')[0])
    const cells = new Map<string, { text: string; sub?: string; kind: 'lesson' | 'extra' | 'hr' }[]>()
    const cm = cellsByClass.get(ck)
    for (const sl of Array.from(teachableOf(ck))) {
      const occ = cm?.get(sl)
      if (occ) { cells.set(sl, [{ text: occ.subject, sub: occ.teacherName, kind: 'lesson' }]); continue }
      const hrSubj = hr[ck]?.cells?.[sl]
      if (hrSubj) cells.set(sl, [{ text: hrSubj, sub: nameOf(config.classTeacher[ck] ?? ''), kind: 'hr' }])
    }
    for (const [sl, lock] of Object.entries(lockOf(ck))) { const t = lockTypeMap[lock]; cells.set(sl, [{ text: t?.subject || t?.label || '鎖課', kind: 'extra' }]) }
    return { title: `${selLesson.classLabel} 班級課表`, cells, off: new Set<string>(), selSlots, periods: config.bands[bandOf(g)].periodsPerDay }
  })()
  const trayPanel = adjustMode && (freeMode || tray.length > 0) && (
    <div className="card p-3 w-64 shrink-0 sticky top-2 space-y-2">
      <div className="text-sm font-semibold text-zinc-700">待排區
        <span className="ml-1 text-xs font-normal text-zinc-400">{tray.length} 堂</span>
      </div>
      <p className="text-[11px] text-zinc-500 leading-snug">
        點課表上的課 → 拿到這裡（格子變空）；點這裡的課再點空格 → 放回去。可以先把要動的都拿下來，再一一排。
        連堂（自然、社會等）按 <b>✂</b> 可拆成兩個單節，分開排到不同時段。
      </p>
      {tray.length === 0
        ? <p className="text-xs text-zinc-400 py-2">目前沒有待排的課。</p>
        : <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto">
            {tray.map(it => (
              <div key={it.key}
                className={`flex items-center gap-1 rounded-sm border ${trayPick === it.key
                  ? 'bg-amber-100 border-amber-400 text-amber-900'
                  : it.kind === 'hr' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>
                <button onClick={() => clickTray(it.key)} className="flex-1 text-left text-[11px] leading-tight px-2 py-1.5">
                  {trayLabel(it)}
                </button>
                {it.kind === 'lesson' && it.lesson.size === 2 && it.lesson.parity === 'weekly' && (
                  <button onClick={() => splitTrayItem(it.key)} title="拆成兩個單節，之後可分開放到不同時段"
                    className="px-1.5 py-1 text-[11px] text-zinc-500 hover:text-sky-700">✂</button>
                )}
              </div>
            ))}
          </div>}
      {slotPick && <p className="text-[11px] text-amber-700">
        已選格子：{slotPick.classKey === ANY_CLASS ? slotZh(slotPick.slot) : `${classLabelOf(slotPick.classKey)} ${slotZh(slotPick.slot)}`}——點上面的課放進去。
      </p>}
      {tray.length > 0 && <p className="text-[11px] text-red-600">待排區還有課沒放回去，存檔時這些課會變成未排。</p>}
    </div>
  )
  const sidePanel = side && (
    <div className="card p-3 w-72 shrink-0 sticky top-2 space-y-1">
      <div className="text-sm font-semibold text-zinc-700 truncate">{side.title}
        <span className="text-[10px] font-normal text-zinc-400 ml-1">對照用・深框＝選中的課</span>
      </div>
      <table className="w-full table-fixed border-collapse text-[9px]">
        <thead>
          <tr><th className="w-4 text-zinc-400 font-normal"></th>
            {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: side.periods }, (_, i) => i + 1).map(q => (
            <tr key={q}>
              <td className="text-zinc-400 text-center">{q}</td>
              {SCHEDULE_DAYS.map(d => {
                const k = `${d}-${q}`
                const ls = side.cells.get(k) ?? []
                const isSelHere = side.selSlots.has(k)
                return (
                  <td key={d} className="p-px">
                    <div className={`h-8 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center text-center ${ls.length ? (ls[0].kind === 'extra' ? 'bg-zinc-200 border-zinc-300 text-zinc-600' : ls[0].kind === 'hr' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-sky-50 border-sky-200 text-sky-900') : side.off.has(k) ? 'bg-zinc-100 border-zinc-200 text-zinc-300' : 'border-dashed border-zinc-100'} ${isSelHere ? 'ring-2 ring-zinc-700' : ''}`}>
                      {ls.length === 0 && side.off.has(k) && <span>—</span>}
                      {ls.slice(0, 2).map((x, i2) => (
                        <span key={i2} className="truncate w-full">{x.text}{x.sub && <span className="opacity-60"> {x.sub}</span>}</span>
                      ))}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-semibold text-zinc-700">{embedded ? (adjustMode ? <span className="text-xs font-normal text-zinc-500">點一堂課就能調（會上色）；改動先<b>暫存在畫面上</b>，按「💾 儲存微調」才寫入課表。沒儲存就離開＝全部捨棄（會先問你），課表維持原樣</span> : null) : '年級總覽與調整'}
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
          {saveState === 'saved' && unsaved === 0 && <span className="text-xs text-green-600">✓ 已儲存</span>}
          {saveState === 'error' && <span className="text-xs text-red-600">⚠ 儲存失敗</span>}
          {adjustMode && unsaved > 0 && (
            <span className="text-xs text-amber-600 font-medium">⚠ {unsaved} 筆尚未儲存</span>
          )}
          {adjustMode && unsaved > 0 && !freeTouched && (
            <button onClick={saveAdjust} disabled={saveState === 'saving'} className="btn btn-primary text-xs py-0.5"
              title="寫入課表；同時自動留一份版本，之後可從版本紀錄回到這裡">💾 儲存微調</button>
          )}
          {adjustMode && freeTouched && (
            <button onClick={saveFreeVersion} disabled={saveState === 'saving' || snapState === 'saving'} className="btn btn-primary text-xs py-0.5"
              title="自由編輯的結果只另存成版本，不會寫進正式課表">📌 另存為版本</button>
          )}
          {adjustMode && planStatus !== 'final' && (
            <button onClick={() => {
              if (!freeMode && !confirm('開啟自由編輯？\n\n這個模式下所有硬規則與權重都不檢查——鎖課格、非可排時段、老師衝堂都放行，完全由你決定。\n結果只能「另存為版本」，不會直接寫進正式課表。')) return
              setFreeMode(v => !v); setSel(null)
            }} className={`btn text-xs py-0.5 ${freeMode ? 'btn-danger' : 'btn-secondary'}`}
              title="不檢查任何規則、全由人工決定">{freeMode ? '🔓 自由編輯中（點此關閉）' : '🔓 自由編輯'}</button>
          )}
          {snapState === 'saved' && <span className="text-xs text-green-600">✓ 已存為版本</span>}
          {snapState === 'error' && <span className="text-xs text-red-600">⚠ 存版本失敗</span>}
          {adjustMode && adjustments.length > 0 && (
            <button onClick={snapshot} disabled={snapState === 'saving'} title="把目前微調後的課表另存成一份版本，之後可在版本紀錄找回"
              className="btn btn-secondary text-xs py-0.5">📌 存為版本</button>
          )}
          {adjustMode && undoStack.length > 0 && <button onClick={undo} className="btn btn-secondary text-xs py-0.5">↩ 復原</button>}
          {adjustMode && embedded && onDiscard && adjustments.length > 0 && (
            <button onClick={onDiscard} className="btn btn-danger text-xs py-0.5" title="回到這份課表微調前的樣子；資料庫裡的草稿微調一併清掉">✕ 放棄全部微調（{adjustments.length} 筆）</button>
          )}
          {/* 三顆階段鈕：往回（撤回發布）→ 原地暫停（收回填課）→ 往前（發布全校）。
              同一排、依方向排序，才看得出它們是同一件事的三個方向。 */}
          {!embedded && planStatus === 'published' && onUnpublish && (
            <button onClick={onUnpublish} className="btn btn-danger text-xs py-0.5"
              title="回到草稿階段重新排課。導師已填的內容可能與新課表不符">← 撤回發布</button>
          )}
          {!embedded && planStatus === 'published' && (
            <button onClick={toggleFill} disabled={fillBusy} className={`btn text-xs py-0.5 ${fillOpenState ? 'btn-secondary' : 'btn-primary'}`}
              title={fillOpenState ? '收回後導師端唯讀，課務組可自由調課（搬進空格、與導師課互換）' : '重新開放導師填課；開放期間課務組只能科任課互換'}>
              {fillOpenState ? '🔒 收回導師填課' : '🔓 開放導師填課'}
            </button>
          )}
          {!embedded && planStatus === 'published' && <button onClick={() => setFinal('finalize')} disabled={busy} className="btn btn-primary text-xs py-0.5" title="對全校公開：所有老師可查看並下載全校課表（唯讀）">發布全校課表 →</button>}
          {!embedded && planStatus === 'final' && <button onClick={() => setFinal('unfinalize')} disabled={busy} className="btn btn-danger text-xs py-0.5" title="收回全校公開，回到導師排課階段">↩ 收回全校課表</button>}
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
              {Array.from(new Set(teacherOptions.map(t => t.domain))).map(dm => (
                <optgroup key={dm || '未分類'} label={dm || '未分類'}>
                  {teacherOptions.filter(t => t.domain === dm).map(t => (
                    <option key={t.id} value={t.id}>{t.co ? '★' : ''}{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {mode === 'room' && (
            <select value={roomSelState} onChange={e => setRoomSel(e.target.value)} className="input py-0.5 text-xs w-44">
              <option value="">選擇教室…</option>
              {rooms.filter(r => r.subject).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              {Object.entries(extras?.roomNames ?? {}).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          )}
        </div>
      )}

      {/* 舊的行內調課工具列。調整已全部走「連鎖調課」modal，裡面的東西都不會再出現，
          只剩「協調備註」那個輸入框空占一條——一併關掉。 */}
      {adjustMode && (sel || !embedded) && (
        <div className="card p-2 text-xs text-zinc-500 flex items-center gap-3 flex-wrap">
          <span>
            {sel
              ? sel.type === 'lesson'
                ? <>已選：<b className="text-zinc-700">{selLesson?.classLabel} {selLesson?.subject}（{selLesson?.teacherName}）</b>——
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400 align-middle mx-0.5" />直接搬
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-400 align-middle mx-0.5 ml-2" />兩角互換
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 align-middle mx-0.5 ml-2" />三角互調
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-400 align-middle mx-0.5 ml-2" />與導師課互換
                    ；灰格滑過看原因；滑過彩格會標出牽動到的課（虛線框）。<b className="text-emerald-700">綠色「更好 −N」＝比現在更好，建議採用</b>；沒數字＝不影響分數（微調用）；會變差的預設隱藏{fillOpen && <b className="text-amber-700 ml-2">導師填課開放中：只能科任課之間互換</b>}</>
                : <>已選：<b className="text-zinc-700">{classLabelOf(sel.classKey)} 導師課「{hr[sel.classKey]?.cells?.[sel.slot]}」</b></>
              : adjustMode
                ? '點一堂課（科任或導師課）開始：本班格子會上色——綠＝可直接搬、藍＝兩角互換、橘＝三角、紫＝與導師課互換、灰＝不行（滑過看原因）；再點彩格就完成。教室會自動重新分配。'
                : ''}
          </span>
          {sel && detailOpt && (
            <span className="basis-full text-zinc-600 flex items-start gap-2">
              <span>
                <b className={detailOpt.softDelta < 0 ? 'text-emerald-700' : detailOpt.softDelta > 0 ? 'text-red-600' : 'text-zinc-700'}>{KIND_ZH[detailOpt.kind]} {detailOpt.softDelta === 0 ? '罰分不變' : deltaBadge(detailOpt.softDelta)}</b>
                {(detailOpt.breakdown ?? []).length > 0
                  ? <> ＝ {(detailOpt.breakdown ?? []).filter(b => Math.abs(b.delta) < MUST).map(b => `${b.label} ${b.delta > 0 ? '+' : ''}${b.delta}`).join('・')}</>
                  : <span className="text-zinc-400">（各規則分數互相抵銷或皆無變化）</span>}
                {detailOpt.kind !== 'move' && <span className="text-zinc-400">　{detailOpt.desc}</span>}
              </span>
              <button onClick={() => setDetailOpt(null)} className="text-zinc-400 hover:text-zinc-600 ml-auto shrink-0">✕</button>
            </span>
          )}
          {selLesson?.size === 2 && selLesson.parity === 'weekly' && (
            <button onClick={splitDouble} className="btn btn-secondary text-xs py-0.5">✂ 拆為兩個單節</button>
          )}
          {selLesson && finder && (
            <button onClick={runFindChain} disabled={chain === 'busy'} className="btn btn-secondary text-xs py-0.5" title="三角以上的多角鏈：把擋路的課逐出、再幫它們找位子，最多四層">
              {chain === 'busy' ? '搜尋中…' : '🔗 幫我找一條鏈'}
            </button>
          )}
        </div>
      )}

      {(freeMode || freeTouched) && (
        <div className="card border-red-300 bg-red-50 px-3 py-2 space-y-1">
          <div className="text-sm font-semibold text-red-700">
            {freeMode ? '🔓 自由編輯中——不檢查任何規則' : '🔓 這份課表含自由編輯的內容'}
            <span className="ml-2 text-xs font-normal text-red-600">
              非可排時段、老師衝堂一律放行；結果只能「另存為版本」，不會寫進正式課表。
              <b>鎖課格（灰色）仍然不可動、不可放</b>——鎖課是設定不是課表，要換時段請到
              <a href="/admin/schedule-config?tab=lock" className="underline">排課設定 → 5 鎖課設定</a>。
              {tray.length > 0 && <b className="ml-1">待排區還有 {tray.length} 堂。</b>}
            </span>
          </div>
          {freeIssues && (freeIssues.total > 0
            ? <div className="text-xs text-red-700 space-y-0.5">
                {freeIssues.clash.length > 0 && <div>・老師同時段有兩堂（{freeIssues.clash.length}）：{freeIssues.clash.slice(0, 4).join('；')}{freeIssues.clash.length > 4 ? '…' : ''}</div>}
                {freeIssues.inLock.length > 0 && <div>・排進鎖課格（{freeIssues.inLock.length}）：{freeIssues.inLock.slice(0, 4).join('；')}{freeIssues.inLock.length > 4 ? '…' : ''}</div>}
                {freeIssues.offSlot.length > 0 && <div>・排在非可排時段（{freeIssues.offSlot.length}）：{freeIssues.offSlot.slice(0, 4).join('；')}{freeIssues.offSlot.length > 4 ? '…' : ''}</div>}
              </div>
            : <div className="text-xs text-green-700">目前沒有踩到硬規則。</div>)}
        </div>
      )}

      {adjustMode && !freeMode && selLesson && swapQ && (
        <div className="card p-2 text-xs space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-zinc-500">
            {betterCount > 0
              ? <span className="px-1.5 py-0.5 rounded-sm bg-emerald-600 text-white font-medium">✨ 有 {betterCount} 種排法比現在更好</span>
              : <span className="text-zinc-400">目前這堂沒有更好的排法</span>}
            <span>・不影響分數 <b className="text-zinc-700">{zeroCount}</b> 種</span>
            {worseCount > 0 && (
              <label className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={showWorse} onChange={e => setShowWorse(e.target.checked)} />
                <span>顯示會變差的方案（{worseCount}）</span>
              </label>
            )}
            {chain === 'none' && <span className="text-amber-700">找不到四層內的多角鏈（可能教室全滿或被鎖課卡死）</span>}
          </div>
          {chain && chain !== 'none' && chain !== 'busy' && (
            <div className="flex items-center gap-2 border border-amber-300 bg-amber-50 rounded-sm p-1.5"
              onMouseEnter={() => setHoverOpt(chain)} onMouseLeave={() => setHoverOpt(null)}>
              <span className="text-amber-800">🔗 多角鏈（{chain.moves.length} 堂）・{deltaZh(chain.softDelta)}：{chain.desc}</span>
              <button onClick={() => applyOption(chain)} className="btn btn-primary text-xs py-0.5 ml-auto shrink-0">套用</button>
            </div>
          )}
          {visibleOptions.length > 0 && (
            <ul className="grid gap-1 md:grid-cols-2">
              {visibleOptions.slice(0, 12).map((o, i) => (
                <li key={i} onMouseEnter={() => setHoverOpt(o)} onMouseLeave={() => setHoverOpt(null)}
                  className={`flex items-center gap-2 rounded-sm border px-1.5 py-1 ${o.softDelta < 0 ? 'border-emerald-400 bg-emerald-50' : o.softDelta > 0 ? 'border-red-200 bg-red-50/40' : 'border-zinc-200 bg-white'}`}>
                  <span className={`shrink-0 px-1 rounded-sm text-white ${o.kind === 'move' ? 'bg-emerald-500' : o.kind === 'swap2' ? 'bg-sky-500' : 'bg-amber-500'}`}>{KIND_ZH[o.kind]}</span>
                  <span className={`shrink-0 font-mono ${o.softDelta < 0 ? 'text-emerald-700 font-semibold' : o.softDelta > 0 ? 'text-red-600' : 'text-zinc-400'}`}>{o.softDelta === 0 ? '0' : deltaBadge(o.softDelta)}</span>
                  <button onClick={() => setDetailOpt(o)} title="看是哪條規則變的" className="shrink-0 text-zinc-400 hover:text-zinc-700">ⓘ</button>
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
        <div className="flex gap-3 items-start">
        <div className="card p-3 max-w-md flex-1 space-y-1">
          <div className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
            <span>{mode === 'teacher' ? (teacherOptions.find(t => t.id === focusId)?.name ?? nameOf(focusId)) : (rooms.find(r => r.id === focusId)?.label ?? extras?.roomNames[focusId] ?? '教室')}</span>
            {mode === 'teacher' && (
              <button onClick={() => setChainSeed({ kind: 'teacher', teacherId: focusId })}
                className="text-[10px] px-1.5 py-0.5 rounded-sm border border-zinc-200 text-zinc-500 hover:border-rose-300 hover:text-rose-600 font-normal ml-auto"
                title="從這張課表開始，一步一步把課搬到你要的位置；套用後會自動存成一份版本">⇄ 調課</button>
            )}
            <span className="text-xs font-normal text-zinc-400 ml-2">{freeMode
              ? '自由編輯中：點課＝拿到待排區、點空格＝放回（不檢查任何規則）'
              : !adjustMode ? ''
              : mode === 'teacher' ? '點一堂課可調；彩格＝這堂課可以落到的時段；灰底＝本土語（鎖課時段，不可調）' : '點一堂課可調；彩格＝這堂課可以落到的時段（教室由系統重配，未必還在這間）；灰底＝本土語場次'}</span>
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
                    const ex = extraCells.get(k) ?? []
                    const off = focusOff.has(k)
                    const opt = sel?.type === 'lesson' ? optByCell.get(k) : undefined
                    const why = sel?.type === 'lesson' && !opt && swapQ ? (hiddenWhy.get(k) ?? swapQ.why[k]) : undefined
                    const isSelSrc = sel?.type === 'lesson' && ls.some(x => x.id === sel.id)
                    const isPartner = !!(hoverOpt && ls.some(x => hoverOpt.partnerIds.includes(x.id)))
                    const ringKind = opt ? `${opt.softDelta < 0 ? 'ring-4' : 'ring-2'} ${opt.kind === 'move' ? 'ring-emerald-400' : opt.kind === 'swap2' ? 'ring-sky-400' : 'ring-amber-400'}` : ''
                    const ring = isSelSrc ? 'ring-2 ring-zinc-700' : isPartner ? 'ring-2 ring-amber-500 ring-offset-1' : ringKind
                    const dim = sel && !isSelSrc && !isPartner && !opt ? 'opacity-40' : ''
                    const hoverProps = opt ? { onMouseEnter: () => setHoverOpt(opt), onMouseLeave: () => setHoverOpt(null) } : {}
                    const offTxt = mode === 'teacher' && focusId ? offNote[focusId]?.[k] : ''
                    const title = opt ? `${KIND_ZH[opt.kind]}・${deltaZh(opt.softDelta)}${bdZh(opt) ? `（${bdZh(opt)}）` : ''}${opt.kind !== 'move' ? '：' + opt.desc : ''}` : why ?? (off ? (mode === 'teacher' ? `不排課時段${offTxt ? `（${offTxt}）` : ''}` : '教室不開放') : undefined)
                    const onClick = () => {
                      if (!adjustMode) return   // 預覽就是預覽：調整走「連鎖調課」modal
                      if (freeMode) {
                        // 自由編輯：點有課的格＝拿到待排區；點空格＝放入選中的待排課（班級由那堂課自己帶）
                        const mine = ls[0]
                        if (mine) { parkLesson(mine); return }
                        if (ex.length) return   // 本土語等鎖課時段：不可動也不可放
                        if (trayPick) { placeFromTray(trayPick, ANY_CLASS, k); return }
                        setSlotPick(prev => prev && prev.slot === k && prev.classKey === ANY_CLASS ? null : { classKey: ANY_CLASS, slot: k })
                        return
                      }
                      if (opt) { applyOption(opt); return }
                      if (isSelSrc) { setSel(null); return }
                      const mine = ls[0]
                      if (mine) setSel({ type: 'lesson', id: mine.id })
                    }
                    return (
                      <td key={d} className="p-0.5">
                        <button onClick={onClick} title={title} {...hoverProps}
                          className={`relative w-full h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center ${
                            freeMode && slotPick?.classKey === ANY_CLASS && slotPick?.slot === k ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : ls.length ? (ls[0].parity !== 'weekly' ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900')
                            : ex.length ? 'bg-zinc-200 border-zinc-300 text-zinc-700'
                            : off ? 'bg-rose-50/70 border-rose-200 border-dashed text-rose-300'
                            : freeMode && trayPick ? 'border-dashed border-amber-400 text-amber-500'   // ex（鎖課）已於上一條擋掉，不會亮成可放
                            : 'border-dashed border-zinc-200 text-zinc-300'} ${ring} ${freeMode ? '' : dim} ${adjustMode && (ls.length || opt || freeMode) ? 'cursor-pointer' : 'cursor-default'}`}>
                          {opt && opt.softDelta !== 0 && <span onClick={e => { e.stopPropagation(); setDetailOpt(opt) }} title="看是哪條規則變的" className={`absolute top-0 right-0 text-[8px] leading-none px-0.5 rounded-bl-sm text-white cursor-help ${opt.softDelta < 0 ? 'bg-emerald-600' : 'bg-red-400'}`}>{deltaBadge(opt.softDelta)} ⓘ</span>}
                          {ls.length === 0 && ex.length === 0 && off && <span className="text-[8px]">—</span>}
                          {ls.length === 0 && ex.slice(0, 2).map((e, i) => (
                            <span key={i} className="truncate w-full">
                              <span className="font-medium">{e.main}</span>
                              <span className="text-[8px] opacity-70"> {e.sub}</span>
                            </span>
                          ))}
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
        {trayPanel}
        {sidePanel}
        </div>
      )}

      {mode === 'class' && <div className="flex gap-3 items-start">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 flex-1 min-w-0">
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
                {/* 導師端已經沒有自己取消的按鈕了，退回一律走這裡——要看得見才行 */}
                {!embedded && hrRow?.confirmed_at && (
                  <button onClick={() => unconfirmClass(ck)}
                    title="讓這一班的導師可以重新編輯（填課開放中才有效）"
                    className="text-[10px] px-1.5 py-0.5 rounded-sm border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 ml-auto">
                    ↩ 退回確認
                  </button>
                )}
                <button onClick={() => setChainSeed({ kind: 'class', classKey: ck })}
                  className={`text-[10px] px-1.5 py-0.5 rounded-sm border border-zinc-200 text-zinc-500 hover:border-rose-300 hover:text-rose-600 ${!embedded && hrRow?.confirmed_at ? '' : 'ml-auto'}`}
                  title="從這張課表開始，一步一步把課搬到你要的位置；套用後會自動存成一份版本">⇄ 調課</button>
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
                        // 鎖課永遠不可動、不可放——自由編輯也一樣（鎖課是設定，要改請到「5 鎖課設定」）。
                        // 例外：鎖課格上竟然有課＝資料異常，讓它照常顯示才處理得掉，不然那堂課會被鎖課蓋成隱形。
                        if (lock && !cm?.get(k)) {
                          const t = lockTypeMap[lock]
                          return <td key={d} className="p-0.5"><div title="鎖課（不可調整）" className="h-9 rounded-sm border bg-zinc-200 border-zinc-300 text-zinc-600 flex items-center justify-center truncate px-0.5">{t?.subject || '鎖'}</div></td>
                        }
                        const occ = cm?.get(k)
                        const hrSubj = hrRow?.cells?.[k]
                        // 導師不排課（學年共同 or 個人申報）：不論這格排了什麼都標出來，讓導師一眼看到自己那幾節不在
                        const hrId = config.classTeacher[ck] ?? ''
                        const offSelf = Boolean(hrId && teacherBlocked[hrId]?.has(k))
                        const offCommon = (config.gradeCommonOff[String(Number(ck.split('-')[0]))] ?? []).includes(k)
                        const offHere = offSelf || offCommon
                        const offWhy = offHere
                          ? `${nameOf(hrId) || '導師'}不排課${offSelf && offNote[hrId]?.[k] ? `（${offNote[hrId][k]}）` : offCommon && !offSelf ? '（學年共同）' : ''}：這一節必須是科任課`
                          : undefined
                        const offMark = offHere
                          ? <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-rose-400/70 rounded-l-sm pointer-events-none" />
                          : null
                        const isSelSrc = (sel?.type === 'lesson' && occ?.id === sel.id) || (sel?.type === 'hr' && sel.classKey === ck && sel.slot === k)
                        const st = adjustMode && sel && !isSelSrc ? targetState(ck, k) : null
                        const opt = sel?.type === 'lesson' && selLesson?.classKey === ck ? optByCell.get(k) : undefined
                        const isPartner = !!(hoverOpt && occ && hoverOpt.partnerIds.includes(occ.id))
                        const ringKind = opt ? `${opt.softDelta < 0 ? 'ring-4' : 'ring-2'} ${opt.kind === 'move' ? 'ring-emerald-400' : opt.kind === 'swap2' ? 'ring-sky-400' : 'ring-amber-400'}` : st?.ok ? (hrSubj && sel?.type === 'lesson' ? 'ring-2 ring-violet-400' : 'ring-2 ring-emerald-400') : ''
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
                              <button onClick={() => clickCell(ck, k)} title={[title, offWhy].filter(Boolean).join('｜') || undefined} {...hoverProps}
                                className={`relative w-full h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center ${bi ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900'} ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                                {offMark}
                                {opt && opt.softDelta !== 0 && <span onClick={e => { e.stopPropagation(); setDetailOpt(opt) }} title="看是哪條規則變的" className={`absolute top-0 right-0 text-[8px] leading-none px-0.5 rounded-bl-sm text-white cursor-help ${opt.softDelta < 0 ? 'bg-emerald-600' : 'bg-red-400'}`}>{deltaBadge(opt.softDelta)} ⓘ</span>}
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
                              <button onClick={() => clickCell(ck, k)} title={[title, offWhy].filter(Boolean).join('｜') || undefined}
                                className={`relative w-full h-9 rounded-sm border bg-emerald-50 border-emerald-200 text-emerald-800 px-0.5 truncate ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                                {offMark}{hrSubj}
                              </button>
                            </td>
                          )
                        }
                        const must = mustFillOf[ck]?.has(k)
                        return (
                          <td key={d} className="p-0.5">
                            <button onClick={() => clickCell(ck, k)} title={freeMode && trayPick ? '放進這一格' : title ?? offWhy} {...hoverProps}
                              className={`relative w-full h-9 rounded-sm border border-dashed ${slotPick?.classKey === ck && slotPick?.slot === k ? 'border-amber-500 bg-amber-50 text-amber-700' : freeMode && trayPick ? 'border-amber-400 text-amber-500' : must ? 'border-red-300 text-red-300' : 'border-zinc-200 text-zinc-300'} ${ring} ${dim} ${adjustMode ? 'cursor-pointer' : 'cursor-default'}`}>
                              {opt && opt.softDelta !== 0 && <span onClick={e => { e.stopPropagation(); setDetailOpt(opt) }} title="看是哪條規則變的" className={`absolute top-0 right-0 text-[8px] leading-none px-0.5 rounded-bl-sm text-white cursor-help ${opt.softDelta < 0 ? 'bg-emerald-600' : 'bg-red-400'}`}>{deltaBadge(opt.softDelta)} ⓘ</span>}
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
      {trayPanel}
      {sidePanel}
      </div>}

      {/* 調整紀錄已移除：要回顧改了什麼，看版本紀錄比看流水帳清楚 */}
    
      {/* 連鎖調課：課務組的人工作法——不妥位置 → 妥適位置，被擠掉的繼續找位置，最後一次套用 */}
      <ChainAdjustModal
        open={Boolean(chainSeed)} seed={chainSeed}
        placed={placed} hr={hr} config={config} classCounts={classCounts}
        teacherNames={teacherNames} engineInput={engineInput} fillOpen={fillOpen}
        extraByTeacher={extras?.teacher ?? EMPTY_EXTRAS}
        onClose={() => setChainSeed(null)}
        onApply={async next => {
          const rooms2 = roomsFromConfig(config)
          const re = reassignRooms(next.placed, rooms2, config.weights)
          const desc = next.moves.map(m => `${classLabelOf(m.classKey)} ${m.what} ${slotZh(m.from)}→${slotZh(m.to)}`).join('；')
          const note2 = `連鎖調課 ${next.moves.length} 步：${desc}`
          const adj: Adjustment[] = [...adjustments, { at: new Date().toISOString(), desc: note2 }]
          // 預覽來的版本：它和資料庫不同的那些班，導師課也要一起寫回去
          const cks = Array.from(new Set([...next.moves.map(m => m.classKey), ...(hrForceClasses ?? [])]))
          applyAdjust(re, next.hr, note2, cks)
          setChainSeed(null)
          // 先存版本、再寫課表：課表要把版本 id 一起記下來，重新整理才標得出「目前顯示版本」
          const cls = Array.from(new Set(next.moves.map(m => classLabelOf(m.classKey)))).join('、')
          const vid = await saveVersion({ placed: re, adjustments: adj, silent: true, hr: next.hr,
            label: `連鎖調課 ${next.moves.length} 步（${cls}）` })
          // 「套用」就是套用：直接寫進課表，不要再叫人去按「儲存微調」（那顆已經拿掉了）
          const ok = await persist(re, next.hr, adj, cks, typeof vid === 'string' ? vid : undefined)
          if (ok) { pendingHrRef.current.clear(); setUnsaved(0); onDirtyChange?.(0) }
          else if (typeof vid === 'string') {
            // 課表沒寫成，那這一版就不算數：留著只會變成版本紀錄裡有它、課表卻沒有
            // fetch 遇到 4xx 不會 reject，只 catch 網路錯誤會讓刪不掉的版本靜靜留下來
            const del = await fetch(`/api/admin/schedule-plan-versions?id=${vid}`, { method: 'DELETE' }).catch(() => null)
            if (!del?.ok) console.warn('版本回收失敗，版本紀錄可能對不上課表', vid)
            onVersionSaved?.({})
          }
        }}
      />
</div>
  )
}
