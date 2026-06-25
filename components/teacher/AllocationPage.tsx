'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  GRADE_LABEL, GRADES, planTotal, subjectCategory, CERT_SUBJECTS, OVERTIME_REJECT_OTHERS,
  defaultSchedulingNeeds, periodBounds, possiblePeriods, mandatoryPeriods, reducedBaseGroups,
  groupPeriods,
  type AllocRole, type TeacherAllocation, type ScenarioChoice, type SchedulingNeeds, type AllocationPlan,
} from '@/lib/allocation'
import { ReasonCertModal, ConfirmNotesModal, SchedulingNeedsCard, HomeroomNoticeCard, type ReasonResult } from '@/components/teacher/AllocationSubmitWizard'
import type { HomeroomCtx } from '@/app/teacher/allocation/page'

interface Props {
  year: number
  role: AllocRole
  work: string
  grade: number | null
  roleLabel: string
  base: number | null
  homeroom: HomeroomCtx | null
  allSubjects: string[]
  closed: boolean
  initial: TeacherAllocation
}

export function AllocationPage({ year, role, work, grade, roleLabel, base, homeroom, allSubjects, closed, initial }: Props) {
  const base0 = base ?? 0
  const reductions = homeroom ? homeroom.scenarios.map(s => s.reduction) : []

  // 行政方案（preset）依「總節數」索引；超鐘節數無 preset → 只能自配
  const presetsByPeriod: Record<number, AllocationPlan[]> = {}
  if (homeroom) for (const sc of homeroom.scenarios) for (const p of sc.plans) {
    const t = planTotal(p); (presetsByPeriod[t] ??= []).push(p)
  }

  const [projectFiled, setProjectFiled] = useState(initial.projectFiled ?? 0)
  const [overtimeHours, setOvertimeHours] = useState(initial.overtimeHours ?? 0)

  // 以「實際節數」為鍵的方案；初始化時為必填節數預載行政方案，並校正「無理由的偏離」
  const [plans, setPlans] = useState<Record<string, ScenarioChoice>>(() => {
    const p: Record<string, ScenarioChoice> = { ...(initial.plans ?? {}) }
    const ro = (initial.locked ?? false) || closed
    if (homeroom && !ro) {
      for (const P of mandatoryPeriods({ base: base0, reductions })) {
        if (!p[String(P)] && (presetsByPeriod[P]?.length)) p[String(P)] = { planName: presetsByPeriod[P][0].name, breakdown: { ...presetsByPeriod[P][0].alloc } }
      }
      // 載入校正（逐科）：偏離但該科沒有理由 → 還原為標準值（避免重整後殘留無理由的偏離）
      const prinSubs = homeroom.subjects.filter(s => subjectCategory(s) === 'principle')
      const specSubs = homeroom.subjects.filter(s => subjectCategory(s) === 'specialty')
      const pr = normReasons(initial.principleReasons)
      const sr = normReasons(initial.specialtyReasons)
      for (const k of Object.keys(p)) {
        const P = Number(k)
        const bd = { ...p[k].breakdown }
        for (const s of prinSubs) { const std = homeroom.subjectMax[s] ?? 0; if ((Number(bd[s]) || 0) !== std && !pr[k]?.[s]) bd[s] = std }
        const spec = presetsByPeriod[P]?.[0]?.alloc ?? presetsByPeriod[base0]?.[0]?.alloc ?? {}
        for (const s of specSubs) { const std = Number(spec[s]) || 0; if ((Number(bd[s]) || 0) !== std && !sr[k]?.[s]) bd[s] = std }
        p[k] = { ...p[k], breakdown: bd }
      }
    }
    return p
  })
  const [ranking, setRanking] = useState<Record<string, number[]>>(initial.ranking ?? {})
  const [openCard, setOpenCard] = useState<Record<string, boolean>>({})
  const [selfMode, setSelfMode] = useState<Record<string, boolean>>({})
  const [principleReasons, setPrincipleReasons] = useState<Record<string, Record<string, string>>>(() => normReasons(initial.principleReasons))
  const [principleEdit, setPrincipleEdit] = useState<{ P: number; subj: string; revertTo: number | null } | null>(null)
  const [specialtyReasons, setSpecialtyReasons] = useState<Record<string, Record<string, string>>>(() => normReasons(initial.specialtyReasons))
  const [specialtyEdit, setSpecialtyEdit] = useState<{ P: number; subj: string; revertTo: number | null } | null>(null)

  // 科任／行政沿用欄位
  const [gradeHours, setGradeHours] = useState<Record<string, number>>(initial.gradeHours ?? {})
  const [subjectWishes, setSubjectWishes] = useState<string[]>(initial.subjectWishes ?? [])
  const [overtimeOrder, setOvertimeOrder] = useState<string[]>(initial.overtimeOrder ?? [])

  const [step, setStep] = useState(1)
  const [showPeriodsTable, setShowPeriodsTable] = useState(false)
  const [principleReason, setPrincipleReason] = useState(initial.principleReason ?? '')
  const [specialtyReason, setSpecialtyReason] = useState(initial.specialtyReason ?? '')
  const [scheduling, setScheduling] = useState<SchedulingNeeds>(initial.scheduling ?? defaultSchedulingNeeds())
  const [reasonModalOpen, setReasonModalOpen] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [noticeAck, setNoticeAck] = useState(false)
  const [locked, setLocked] = useState(initial.locked ?? false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dragGroup, setDragGroup] = useState<{ rb: number; idx: number } | null>(null)

  const readOnly = locked || closed

  const principleSubjects = homeroom ? homeroom.subjects.filter(s => subjectCategory(s) === 'principle') : []
  const specialtySubjects = homeroom ? homeroom.subjects.filter(s => subjectCategory(s) === 'specialty') : []
  const optionalSubjects = homeroom ? homeroom.subjects.filter(s => subjectCategory(s) === 'optional') : []

  // 區間與分組
  const bounds = periodBounds({ base: base0, reductions, projectFiled, overtime: overtimeHours })
  const mandatorySet = new Set(mandatoryPeriods({ base: base0, reductions }))
  const periodsAsc = possiblePeriods({ base: base0, reductions, projectFiled, overtime: overtimeHours }).slice().sort((a, b) => a - b) // 低到高
  const stdPeriods = periodsAsc.filter(P => mandatorySet.has(P))     // 總量管制配課方案（必填）
  const extraPeriods = periodsAsc.filter(P => !mandatorySet.has(P))  // 因專案減課（低）或超鐘點（高）而新增
  const groups = reducedBaseGroups({ base: base0, reductions, projectFiled }) // 由高到低

  // 專長配課基準＝行政方案（該節數 → 減0），無方案則視為 0。
  // 不採老師自己的方案當基準：否則老師在某張卡把某科調成 1，就會變成其他卡的「標準」，
  // 導致把該科改回真正的原始值 0 時被誤判為偏離而要求理由。
  function baselineFor(P: number): Record<string, number> {
    return presetsByPeriod[P]?.[0]?.alloc ?? presetsByPeriod[base0]?.[0]?.alloc ?? {}
  }
  // 單科是否偏離標準：原則＝各科上限；專長＝行政方案（無則 0）
  function subjectDeviates(P: number, subj: string, val: number, cat: 'principle' | 'specialty'): boolean {
    const std = cat === 'principle' ? (homeroom?.subjectMax[subj] ?? 0) : (Number(baselineFor(P)[subj]) || 0)
    return (Number(val) || 0) !== std
  }
  function removeSubjReason(map: Record<string, Record<string, string>>, P: number, subj: string) {
    const inner = { ...(map[String(P)] ?? {}) }
    delete inner[subj]
    const next = { ...map }
    if (Object.keys(inner).length) next[String(P)] = inner; else delete next[String(P)]
    return next
  }

  function buildData(lock: boolean): TeacherAllocation {
    // 鏡射標準減課情境（減0/1/2）回 scenarios，供配課統計頁沿用
    const scenariosMirror: Record<string, ScenarioChoice> = {}
    for (const r of reductions) { const ch = plans[String(base0 - r)]; if (ch) scenariosMirror[String(r)] = ch }
    // 把各節數的原則／專長配課理由彙整成單一字串，供配課統計頁的「配課理由」沿用
    const aggReasons = (reasons: Record<string, Record<string, string>>, fallback: string) =>
      role === 'homeroom'
        ? Object.keys(reasons).filter(k => plans[k] && Object.keys(reasons[k]).length)
            .sort((a, b) => Number(a) - Number(b))
            .map(k => `實際${k}節 ${Object.entries(reasons[k]).map(([s, r]) => `${s}：${r}`).join('；')}`).join('\n')
        : fallback
    const principleAgg = aggReasons(principleReasons, principleReason)
    const specialtyAgg = aggReasons(specialtyReasons, specialtyReason)
    return {
      role, work, grade,
      projectReduction: initial.projectReduction ?? 0, extraHours: 0,
      scenarios: role === 'homeroom' ? scenariosMirror : (initial.scenarios ?? {}),
      plans, principleReasons, specialtyReasons, ranking, projectFiled,
      gradeHours,
      projects: initial.projects ?? [], projectOrder: initial.projectOrder ?? [],
      overtimeHours, overtimeOrder: overtimeOrder.filter(Boolean),
      subjectWishes: subjectWishes.filter(Boolean),
      scheduling, principleReason: principleAgg, specialtyReason: specialtyAgg,
      acknowledged: lock ? true : (initial.acknowledged ?? false),
      locked: lock,
      submittedAt: lock ? new Date().toISOString() : (initial.submittedAt ?? null),
    }
  }
  async function put(lock: boolean): Promise<boolean> {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/teacher/allocation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: buildData(lock) }) })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.message ?? '儲存失敗'); setSaveStatus('idle'); return false }
      setSaveStatus('saved'); setError(null); return true
    } catch { setSaveStatus('idle'); setError('儲存失敗'); return false }
  }
  const firstRun = useRef(true)
  const topRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (readOnly) return
    setSaveStatus('saving')
    const t = setTimeout(() => { void put(false) }, 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, principleReasons, specialtyReasons, ranking, projectFiled, overtimeHours, overtimeOrder, gradeHours, scheduling, principleReason, specialtyReason, subjectWishes])

  const actual = (reduction: number) => base0 - reduction

  // ── 方案（以實際節數為鍵）操作 ──
  function setPlanChoice(P: number, fn: (c: ScenarioChoice) => ScenarioChoice) {
    setPlans(prev => ({ ...prev, [String(P)]: fn(prev[String(P)] ?? { planName: null, breakdown: {} }) }))
  }
  function proposePeriod(P: number) {
    setPlans(prev => {
      if (prev[String(P)]) return prev
      const presets = presetsByPeriod[P] ?? []
      if (presets.length > 0) return { ...prev, [String(P)]: { planName: presets[0].name, breakdown: { ...presets[0].alloc } } }
      // 超鐘／專案節數：自配，預載減0(基本)方案當起點，並把導師原則配課補滿（已有值者不覆蓋）
      const seed: Record<string, number> = { ...(prev[String(base0)]?.breakdown ?? {}) }
      for (const s of principleSubjects) if (!(Number(seed[s]) > 0)) seed[s] = homeroom?.subjectMax[s] ?? 0
      return { ...prev, [String(P)]: { planName: null, breakdown: seed } }
    })
    setOpenCard(o => ({ ...o, [P]: true }))
    if ((presetsByPeriod[P]?.length ?? 0) === 0) {
      setSelfMode(m => ({ ...m, [P]: true }))
      // 從減0種子帶入專長配課時，連同減0的專長理由一起帶（避免被載入校正還原）
      setSpecialtyReasons(prev => (prev[String(base0)] && !prev[String(P)]) ? { ...prev, [String(P)]: prev[String(base0)] } : prev)
    }
  }
  function unproposePeriod(P: number) {
    setPlans(prev => { const n = { ...prev }; delete n[String(P)]; return n })
    setPrincipleReasons(prev => { const m = { ...prev }; delete m[String(P)]; return m })
    setSpecialtyReasons(prev => { const m = { ...prev }; delete m[String(P)]; return m })
    setOpenCard(o => ({ ...o, [P]: false }))
  }

  // ── 原則配課即時理由 ──
  function onPrincipleChange(P: number, subj: string, n: number) {
    const oldVal = Number(plans[String(P)]?.breakdown[subj] ?? 0)
    if (n === oldVal) return
    setPlanChoice(P, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))
    if (!subjectDeviates(P, subj, n, 'principle')) { // 該科改回標準 → 移除該科理由
      setPrincipleReasons(prev => removeSubjReason(prev, P, subj))
      return
    }
    if (!principleReasons[String(P)]?.[subj]) setPrincipleEdit({ P, subj, revertTo: oldVal }) // 該科已有理由則不重複打擾
  }
  function confirmPrincipleReason(reason: string) {
    if (!principleEdit) return
    const { P, subj } = principleEdit
    setPrincipleReasons(prev => ({ ...prev, [String(P)]: { ...(prev[String(P)] ?? {}), [subj]: reason } }))
    setPrincipleEdit(null)
  }
  function cancelPrincipleEdit() {
    if (!principleEdit) return
    const { P, subj, revertTo } = principleEdit
    if (revertTo !== null) setPlanChoice(P, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: revertTo } }))
    setPrincipleEdit(null)
  }
  function onSpecialtyChange(P: number, subj: string, n: number) {
    const oldVal = Number(plans[String(P)]?.breakdown[subj] ?? 0)
    if (n === oldVal) return
    setPlanChoice(P, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))
    if (!subjectDeviates(P, subj, n, 'specialty')) { // 該科改回標準 → 移除該科理由
      setSpecialtyReasons(prev => removeSubjReason(prev, P, subj))
      return
    }
    if (!specialtyReasons[String(P)]?.[subj]) setSpecialtyEdit({ P, subj, revertTo: oldVal }) // 該科已有理由則不重複打擾
  }
  function confirmSpecialtyReason(reason: string) {
    if (!specialtyEdit) return
    const { P, subj } = specialtyEdit
    setSpecialtyReasons(prev => ({ ...prev, [String(P)]: { ...(prev[String(P)] ?? {}), [subj]: reason } }))
    setSpecialtyEdit(null)
  }
  function cancelSpecialtyEdit() {
    if (!specialtyEdit) return
    const { P, subj, revertTo } = specialtyEdit
    if (revertTo !== null) setPlanChoice(P, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: revertTo } }))
    setSpecialtyEdit(null)
  }

  // 方案摘要：非 0 科目（依配課科目順序），供第二頁排序卡回顧
  function planSummary(P: number): string {
    const bd = plans[String(P)]?.breakdown ?? {}
    return (homeroom?.subjects ?? []).filter(s => (Number(bd[s]) || 0) > 0).map(s => `${s}${bd[s]}`).join('  ')
  }

  // ── 分組排序 ──
  function groupRankedPeriods(rb: number): number[] {
    const inGroup = groupPeriods(rb, overtimeHours).filter(P => !!plans[String(P)] && P >= bounds.lower && P <= bounds.upper)
    const saved = (ranking[String(rb)] ?? []).filter(P => inGroup.includes(P))
    for (const P of inGroup) if (!saved.includes(P)) saved.push(P)
    return saved
  }
  function reorderGroup(rb: number, from: number, to: number) {
    setRanking(prev => {
      const cur = groupRankedPeriods(rb)
      const arr = [...cur]
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return { ...prev, [String(rb)]: arr }
    })
  }

  function setWish(i: number, val: string) { setSubjectWishes(prev => { const a = [prev[0] ?? '', prev[1] ?? '', prev[2] ?? '']; a[i] = val; return a }) }
  function setOrder(i: number, val: string) {
    setOvertimeOrder(prev => {
      const a = [prev[0] ?? '', prev[1] ?? '', prev[2] ?? '']
      if (val === OVERTIME_REJECT_OTHERS) { for (let k = i; k < 3; k++) a[k] = OVERTIME_REJECT_OTHERS } else a[i] = val
      return a
    })
  }
  const overtimeOptions = role === 'subject' ? allSubjects : []

  // 證照判定（跨所有已提方案）。原則／專長配課改為即時填理由，此處只判證照。
  const certSubjects = (() => {
    const present = new Set<string>()
    if (role === 'homeroom') for (const ch of Object.values(plans)) for (const cs of CERT_SUBJECTS) if ((Number(ch.breakdown[cs]) || 0) > 0) present.add(cs)
    return [...present]
  })()

  function failNext(msg: string) {
    setError(msg)
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function goNext() {
    setError(null)
    if (role === 'homeroom') {
      if (!noticeAck) { failNext('請先勾選注意事項中的「我已熟讀上方注意事項」再繼續。'); return }
      const issues: string[] = []
      // 只檢查目前畫面上實際存在的節數（避免之前調超鐘留下、現已不顯示的殘留方案誤判）
      for (const P of mandatoryPeriods({ base: base0, reductions })) {
        if (!plans[String(P)]) issues.push(`「實際 ${P} 節」方案尚未提出（必填，請於上方提出並配滿 ${P} 節）。`)
      }
      for (const P of periodsAsc) {
        const ch = plans[String(P)]
        if (!ch) continue
        const sum = Object.values(ch.breakdown).reduce((s, n) => s + (Number(n) || 0), 0)
        if (sum !== P) {
          const diff = P - sum
          issues.push(`「實際 ${P} 節」方案目前合計 ${sum} 節，需配滿 ${P} 節（${diff > 0 ? `還差 ${diff}` : `多了 ${-diff}`} 節）。`)
        }
      }
      if (issues.length) { failNext('尚有以下項目需處理才能繼續：\n• ' + issues.join('\n• ')); return }
    }
    // 原則／專長配課的理由已於編輯當下即時填寫；此處只處理證照確認
    if (certSubjects.length) setReasonModalOpen(true)
    else setStep(2)
  }
  function onReasonDone(r: ReasonResult) { setPrincipleReason(r.principleReason); setSpecialtyReason(r.specialtyReason); setReasonModalOpen(false); setStep(2) }
  async function onConfirm() { setConfirmModalOpen(false); if (await put(true)) setLocked(true) }

  const stepLabel = role === 'homeroom'
    ? (step === 1 ? '配課' : step === 2 ? '方案排序' : '排課需求')
    : (step === 1 ? '配課' : step === 2 ? '減超鐘點申請' : '排課需求')

  if (role === 'none') {
    return (
      <div className="space-y-5 max-w-3xl">
        <h2 className="page-title">配課選填</h2>
        <div className="card border-amber-200 bg-amber-50"><p className="text-sm text-amber-800"><span className="font-semibold">您 {year} 學年度無需配課</span>——尚未有本年度工作紀錄，或屬留停／借調等狀態。如有疑問請洽管理員。</p></div>
      </div>
    )
  }

  // ── 導師：方案區塊渲染 ──
  function block(P: number, title: string, subjs: string[], editable: boolean, extra?: ReactNode, onCell?: (subj: string, n: number) => void) {
    if (subjs.length === 0) return null
    const ch = plans[String(P)]
    return (
      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-zinc-500 flex items-center gap-2">{title}{extra}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
          {subjs.map((subj, si) => {
            const cap = homeroom!.subjectMax[subj] ?? 0
            return (
              <div key={si} className="flex items-center gap-1.5"><span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span>
                {editable
                  ? <NumberInput min={0} max={cap > 0 ? cap : undefined} value={ch?.breakdown[subj] ?? 0} onChange={n => onCell ? onCell(subj, n) : setPlanChoice(P, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))} className="input w-12 text-center py-0.5 text-xs" />
                  : <span className="w-12 text-center text-xs font-medium text-zinc-800">{ch?.breakdown[subj] ?? 0}</span>}
                {cap > 0 && <span className="text-[10px] text-zinc-400 whitespace-nowrap">/{cap}</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function periodCard(P: number) {
    const key = String(P)
    const ch = plans[key]
    const proposed = !!ch
    const presets = presetsByPeriod[P] ?? []
    const hasPlans = presets.length > 0
    const inSelf = !hasPlans || !!selfMode[key]
    const planName = (ch?.planName && presets.some(p => p.name === ch.planName)) ? ch.planName : ''
    const sum = ch ? homeroom!.subjects.reduce((s, subj) => s + (Number(ch.breakdown[subj]) || 0), 0) : 0
    const isMandatory = mandatorySet.has(P)
    const isOvertime = P > base0
    const open = proposed && (openCard[key] ?? true)

    function pickPlan(v: string) {
      if (v === '') { setPlanChoice(P, () => ({ planName: null, breakdown: { ...(ch?.breakdown ?? {}) } })); return }
      const plan = presets.find(p => p.name === v)
      setPlanChoice(P, () => ({ planName: v, breakdown: { ...(plan?.alloc ?? {}) } }))
    }
    function enterSelf() { setSelfMode(m => ({ ...m, [key]: true })); setPlanChoice(P, c => ({ planName: null, breakdown: { ...(c?.breakdown ?? {}) } })) }
    function cancelSelf() { setSelfMode(m => ({ ...m, [key]: false })); setPrincipleReasons(prev => { const mm = { ...prev }; delete mm[key]; return mm }); setSpecialtyReasons(prev => { const mm = { ...prev }; delete mm[key]; return mm }); if (presets[0]) setPlanChoice(P, () => ({ planName: presets[0].name, breakdown: { ...presets[0].alloc } })) }

    const prinEnt = Object.entries(principleReasons[key] ?? {})
    const specEnt = Object.entries(specialtyReasons[key] ?? {})

    return (
      <div key={P} className={`card p-4 space-y-3 ${!proposed ? 'border-dashed' : ''}`}>
        {prinEnt.length > 0 && (
          <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 space-y-0.5">
            <div className="font-semibold">動到原則配課（理由提課發會）：</div>
            {prinEnt.map(([s, r]) => (
              <div key={s} className="pl-1">・<span className="font-medium">{s}</span>：<span className="whitespace-pre-line">{r}</span>{!readOnly && <button onClick={() => setPrincipleEdit({ P, subj: s, revertTo: null })} className="ml-1 underline text-red-600 hover:text-red-800">編輯</button>}</div>
            ))}
          </div>
        )}
        {specEnt.length > 0 && (
          <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 space-y-0.5">
            <div className="font-semibold">動到專長配課（課務組排配課依據）：</div>
            {specEnt.map(([s, r]) => (
              <div key={s} className="pl-1">・<span className="font-medium">{s}</span>：<span className="whitespace-pre-line">{r}</span>{!readOnly && <button onClick={() => setSpecialtyEdit({ P, subj: s, revertTo: null })} className="ml-1 underline text-amber-700 hover:text-amber-900">編輯</button>}</div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-zinc-700">實際 {P} 節
            {isMandatory && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-zinc-800 text-white rounded-sm">必填</span>}
          </h3>
          <div className="flex items-center gap-2">
            {proposed && hasPlans && !selfMode[key] && presets.length > 1 && (
              <select className="input py-1 text-sm w-48" value={planName} disabled={readOnly} onChange={e => pickPlan(e.target.value)}>
                <option value="">請選擇方案</option>
                {presets.map((p, i) => <option key={i} value={p.name}>{p.name || `方案${i + 1}`}</option>)}
              </select>
            )}
            {!proposed && !readOnly && <button onClick={() => proposePeriod(P)} className="btn-primary text-xs">提出方案</button>}
            {proposed && !readOnly && (
              <button onClick={() => setOpenCard(o => ({ ...o, [key]: !open }))} className="text-xs text-zinc-500 underline">{open ? '收合' : '展開'}</button>
            )}
            {proposed && !isMandatory && !readOnly && <button onClick={() => unproposePeriod(P)} className="text-xs text-zinc-400 hover:text-red-500">移除</button>}
          </div>
        </div>

        {!proposed && <p className="text-[11px] text-zinc-400">{isOvertime ? '願意超鐘上到此節數才需提出；提出後會預載你的基本方案當起點。' : '此節數可選擇是否提出方案。'}</p>}

        {proposed && open && <>
          {hasPlans && !selfMode[key] && planName && <>
            {block(P, '導師原則配課', principleSubjects, false)}
            {block(P, '導師選填配課', optionalSubjects, false)}
            {block(P, '導師專長配課', specialtySubjects, false)}
          </>}
          {inSelf && <>
            {block(P, '導師原則配課', principleSubjects, inSelf && !readOnly, <span className="text-zinc-400 font-normal">調整需填理由</span>, (subj, n) => onPrincipleChange(P, subj, n))}
            {block(P, '導師選填配課', optionalSubjects, inSelf && !readOnly)}
            {block(P, '導師專長配課', specialtySubjects, inSelf && !readOnly, <span className="text-zinc-400 font-normal">調整需填理由</span>, (subj, n) => onSpecialtyChange(P, subj, n))}
          </>}
          <div className="flex items-end justify-between gap-3 pt-1">
            <div className="text-[11px] text-zinc-400 flex-1">
              {!inSelf && !readOnly && <>已選用方案；如需調整可<button onClick={enterSelf} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改為自訂配課</button>。</>}
              {inSelf && hasPlans && !readOnly && <>自訂配課，各科合計需達 {P} 節。<button onClick={cancelSelf} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改選方案</button></>}
            </div>
            <div className={`text-lg font-semibold whitespace-nowrap ${sum === P ? 'text-green-600' : 'text-amber-600'}`}>合計 {sum}{sum !== P && <span className="text-xs font-normal"> / 目標 {P}（{sum < P ? '不足' : '超過'} {Math.abs(sum - P)}）</span>}</div>
          </div>
        </>}
      </div>
    )
  }

  return (
    <div ref={topRef} className="space-y-5 max-w-4xl scroll-mt-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課選填 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
            {!readOnly && <span className="ml-2 text-xs font-normal text-zinc-400">步驟 {step} / 3 · {stepLabel}</span>}
          </h2>
          <p className="text-xs text-zinc-500">
            身分：<span className="font-medium text-zinc-700">{roleLabel}</span>
            {role === 'homeroom' && grade && <span className="ml-1">· {GRADE_LABEL[grade]}（系統判定）</span>}
            <span className="ml-1 text-zinc-400">· 工作：{work}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
          {saveStatus === 'saved' && !readOnly && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
        </div>
      </div>

      {closed && <div className="card border-amber-200 bg-amber-50"><p className="text-sm text-amber-800"><span className="font-semibold">📋 配課填報已截止</span>——目前唯讀。</p></div>}
      {locked && !closed && <div className="card border-zinc-300 bg-zinc-50"><p className="text-sm text-zinc-700"><span className="font-semibold">🔒 您的配課已送出鎖定</span>——如需修改請洽管理員。</p></div>}
      {error && <div className="card border-red-200 bg-red-50"><p className="text-sm text-red-700 whitespace-pre-line">{error}</p></div>}

      {/* ════ 第一頁 ════ */}
      {step === 1 && <>
        {role === 'homeroom' && homeroom && <>
          {/* 上半：實際節數區間 */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">實際授課節數區間</div>
              <button onClick={() => setShowPeriodsTable(true)} className="flex items-center gap-1.5 text-xs text-zinc-600 border border-zinc-200 rounded-sm px-2 py-1 hover:border-zinc-400 hover:text-zinc-900 hover:bg-zinc-50">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                <span className="font-medium">課程節數表</span>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-[11px] text-zinc-400">基本授課節數</div><div className="text-lg font-semibold text-zinc-900">{base0}</div></div>
              <div><div className="text-[11px] text-zinc-400">總量管制減課</div><div className="text-sm text-zinc-700 pt-1">最少 {reductions.length ? Math.min(...reductions) : 0}～最多 {reductions.length ? Math.max(...reductions) : 0} 節</div></div>
              <label className="block"><div className="text-[11px] text-zinc-400">計畫專案減課</div><NumberInput min={0} value={projectFiled} disabled={readOnly} onChange={n => setProjectFiled(Math.max(0, n))} className="input w-16 text-center py-0.5 mt-1" /></label>
              <label className="block"><div className="text-[11px] text-zinc-400">意願超鐘點（0~6）</div><NumberInput min={0} max={6} value={overtimeHours} disabled={readOnly} onChange={n => setOvertimeHours(Math.min(6, Math.max(0, n)))} className="input w-16 text-center py-0.5 mt-1" /></label>
            </div>
            <div className="border-t border-zinc-100 pt-2 flex items-center gap-6 text-sm">
              <span className="text-zinc-600 inline-flex items-center gap-1">實際節數可能範圍
                <span className="group relative inline-flex">
                  <span className="w-4 h-4 rounded-full border border-zinc-300 text-zinc-400 text-[10px] leading-none flex items-center justify-center cursor-help">i</span>
                  <span className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-64 rounded-sm bg-zinc-800 text-white text-[11px] font-normal px-2.5 py-1.5 z-20 shadow-lg pointer-events-none">下限＝基本−最大減課−專案減課；上限＝基本−最小減課＋超鐘。</span>
                </span>
              </span>
              <span>下限 <span className="text-lg font-semibold text-zinc-900">{bounds.lower}</span></span>
              <span>上限 <span className="text-lg font-semibold text-zinc-900">{bounds.upper}</span></span>
            </div>
          </div>

          <HomeroomNoticeCard grade={homeroom.grade} ack={noticeAck} onAckChange={setNoticeAck} readOnly={readOnly} />

          {/* 下半之一：總量管制配課方案（必填） */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-500">總量管制配課方案</div>
            {stdPeriods.length === 0
              ? <div className="card text-sm text-zinc-400">尚無可填節數，請確認管理者是否已啟用減課情境。</div>
              : stdPeriods.map(P => periodCard(P))}
          </div>

          {/* 下半之二：因專案減課或超鐘點而新增（沒有專案／超鐘者不顯示） */}
          {extraPeriods.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-xs font-semibold text-zinc-500">因專案減課或超鐘點而新增的方案</div>
              {extraPeriods.map(P => periodCard(P))}
            </div>
          )}
        </>}

        {role === 'admin' && (
          <div className="card p-4"><div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-zinc-600">實際授課節數</span><span className="text-2xl font-semibold text-zinc-900">{actual(0)}</span>
          </div></div>
        )}
        {role === 'admin' && (
          <div className="card p-4 space-y-2">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">想授課科目志願</div>
            <p className="text-[11px] text-zinc-400">請依序選擇您希望授課的科目（全科可選，供課務組安排參考）。</p>
            <div className="flex flex-wrap gap-3 pt-1">
              {[0, 1, 2].map(i => (
                <label key={i} className="flex items-center gap-1.5 text-sm"><span className="text-zinc-600 text-xs">志願{['一', '二', '三'][i]}</span>
                  <select value={subjectWishes[i] ?? ''} disabled={readOnly} onChange={e => setWish(i, e.target.value)} className="input py-1 text-sm w-32">
                    <option value="">不指定</option>
                    {allSubjects.filter(s => !subjectWishes.includes(s) || subjectWishes[i] === s).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
        {role === 'subject' && (
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-3 flex-wrap"><span className="text-sm text-zinc-600">實際授課節數</span><span className="text-2xl font-semibold text-zinc-900">{actual(0)}</span></div>
            <p className="text-[11px] text-zinc-400">授課科目與各年級節數由管理者於後續配課時填寫。</p>
          </div>
        )}
      </>}

      {/* ════ 第二頁 ════ */}
      {step === 2 && role === 'homeroom' && (
        <div className="space-y-4">
          <div className="card border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
            依「<strong>可能被減幾節</strong>」分成幾種情況。每一種情況，把你<strong>最想要的方案拖到最上面</strong>。（你無法決定自己會不會被減課，所以每種情況都先排好偏好。）
          </div>
          {groups.every(rb => groupRankedPeriods(rb).length === 0) && (
            <div className="card text-sm text-zinc-400">尚無已提方案，請回上一步提出方案後再回來排序。</div>
          )}
          {groups.map(rb => {
            const ordered = groupRankedPeriods(rb)
            if (ordered.length === 0) return null  // 空組（該情況尚未提方案）不顯示，提方案在第一頁進行
            const net = base0 - rb
            const grpLabel = net === 0 ? '沒有減課' : `若被減 ${net} 節`
            return (
              <div key={rb} className="card p-4 space-y-2">
                <div className="text-sm font-semibold text-zinc-700">{grpLabel}</div>
                <ul className="space-y-1.5">
                  {ordered.map((P, idx) => (
                    <li key={P}
                      draggable={!readOnly}
                      onDragStart={() => setDragGroup({ rb, idx })}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => { if (dragGroup && dragGroup.rb === rb) { reorderGroup(rb, dragGroup.idx, idx); setDragGroup(null) } }}
                      className={`px-3 py-2 rounded-sm border ${idx === 0 ? 'border-green-300 bg-green-50' : 'border-zinc-200 bg-white'} ${!readOnly ? 'cursor-move' : ''}`}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-zinc-400">≡</span>
                        <span className="text-xs text-zinc-500 w-10">第{idx + 1}名</span>
                        <span className="font-medium text-zinc-800">{P} 節</span>
                        <span className="text-xs text-zinc-500">{P === rb ? '標準' : `超鐘 +${P - rb}`}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 pl-[3.4rem]">{planSummary(P) || '（未配課）'}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      {/* 科任／行政：第二頁＝超鐘意願 */}
      {step === 2 && role !== 'homeroom' && (
        <div className="card p-4 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700">超鐘意願</h3>
          <label className="flex items-center gap-2 text-sm"><span className="text-zinc-700">願意超鐘點節數</span>
            <NumberInput min={0} max={6} value={overtimeHours} disabled={readOnly} onChange={setOvertimeHours} className="input w-16 text-center py-0.5" />
            <span className="text-xs text-zinc-400">（最多 6 節）</span></label>
          {role === 'subject' && overtimeHours > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">超鐘順序（願意支援的科目，依優先順序，可選任一科目）。選「⛔ 其他領域不願意」後，後面的順序會自動補上同值。</p>
              <div className="flex flex-wrap gap-3">
                {[0, 1, 2].map(i => {
                  const lockedByReject = overtimeOrder.slice(0, i).includes(OVERTIME_REJECT_OTHERS)
                  return (
                    <label key={i} className="flex items-center gap-1.5 text-sm"><span className="text-zinc-600 text-xs">順序{['一', '二', '三'][i]}</span>
                      <select value={overtimeOrder[i] ?? ''} disabled={readOnly || lockedByReject} onChange={e => setOrder(i, e.target.value)} className="input py-1 text-sm w-40">
                        <option value="">不指定</option>
                        {overtimeOptions.filter(s => !overtimeOrder.includes(s) || overtimeOrder[i] === s).map(s => <option key={s} value={s}>{s}</option>)}
                        <option value={OVERTIME_REJECT_OTHERS}>⛔ 其他領域不願意</option>
                      </select>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          <p className="text-[11px] text-zinc-400">超鐘意願供課務組事後安排參考。</p>
        </div>
      )}

      {/* ════ 第三頁：排課需求 ════ */}
      {step === 3 && <SchedulingNeedsCard value={scheduling} onChange={setScheduling} readOnly={readOnly} />}

      {!readOnly && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {step === 1 && <button onClick={goNext} className="btn-primary text-sm">下一步</button>}
          {step === 2 && <>
            <button onClick={() => setStep(1)} className="btn-secondary text-sm">上一步</button>
            <button onClick={() => setStep(3)} className="btn-primary text-sm">下一步</button>
          </>}
          {step === 3 && <>
            <button onClick={() => setStep(2)} className="btn-secondary text-sm">上一步</button>
            <button onClick={() => setConfirmModalOpen(true)} className="btn-primary text-sm">送出並鎖定</button>
          </>}
        </div>
      )}

      {reasonModalOpen && (
        <ReasonCertModal needPrinciple={false} needSpecialty={false} certSubjects={certSubjects}
          initial={{ principleReason, specialtyReason }} onCancel={() => setReasonModalOpen(false)} onDone={onReasonDone} />
      )}
      {confirmModalOpen && <ConfirmNotesModal onCancel={() => setConfirmModalOpen(false)} onConfirm={onConfirm} />}
      {principleEdit && (
        <CategoryReasonModal cat="principle" subj={principleEdit.subj} initial={principleReasons[String(principleEdit.P)]?.[principleEdit.subj] ?? ''}
          onConfirm={confirmPrincipleReason} onCancel={cancelPrincipleEdit} />
      )}
      {specialtyEdit && (
        <CategoryReasonModal cat="specialty" subj={specialtyEdit.subj} initial={specialtyReasons[String(specialtyEdit.P)]?.[specialtyEdit.subj] ?? ''}
          onConfirm={confirmSpecialtyReason} onCancel={cancelSpecialtyEdit} />
      )}

      {showPeriodsTable && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 cursor-zoom-out" onClick={() => setShowPeriodsTable(false)}>
          <img src="/images/課程節數表.png" alt="課程節數表" className="max-w-full max-h-[90vh] rounded shadow-xl bg-white" />
        </div>
      )}
    </div>
  )
}

// 把（可能為舊格式或不完整的）理由資料正規化成 實際節數 → 科目 → 理由
function normReasons(raw?: Record<string, unknown>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object') {
      const inner: Record<string, string> = {}
      for (const [s, r] of Object.entries(v as Record<string, unknown>)) if (typeof r === 'string' && r.trim()) inner[s] = r
      if (Object.keys(inner).length) out[k] = inner
    }
  }
  return out
}

// 調整導師原則／專長配課 → 即時填理由 modal（取消則由呼叫端還原數字）
function CategoryReasonModal({ cat, subj, initial, onConfirm, onCancel }: { cat: 'principle' | 'specialty'; subj: string; initial: string; onConfirm: (r: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const isPrin = cat === 'principle'
  const examples = isPrin
    ? ['因擔任學校法定／重大職務，經行政協調部分節數由具資格教師協同。', '經課程發展委員會通過之實驗／特色課程，採協同或跨領域統整。']
    : ['具該領域教師證、加註專長或第二專長學分證明。', '具相關學歷背景（主修／輔系／研究所）足以勝任該科教學。', '曾受該領域研習／培訓並取得時數證明，具教學經驗。']
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-4">
        <h3 className="font-semibold text-zinc-900">{isPrin ? '調整原則配課' : '調整專長配課'}</h3>
        <p className={`text-sm border rounded-sm px-3 py-2 ${isPrin ? 'text-red-700 bg-red-50 border-red-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
          {isPrin
            ? <>您調整了{subj ? <>「<strong>{subj}</strong>」的</> : '本方案的'}原則配課，請填寫理由。理由將提交至<strong>課發會－排配課會議討論決議</strong>，並顯示於此方案上方（同一方案僅需一則理由，可涵蓋多科）。</>
            : <>您已調整{subj ? <>「<strong>{subj}</strong>」</> : '本方案的'}專長配課，請填寫理由。您的理由將成為<strong>課務組排配課的依據</strong>，並顯示於此方案上方（同一方案僅需一則理由，可涵蓋多科）。</>}
        </p>
        <div className="text-[11px] text-zinc-400 space-y-0.5">
          <div className="font-medium text-zinc-500">{isPrin ? '範例（限非常重要之原因）：' : '範例（請舉證可勝任，如學歷背景或專業證照）：'}</div>
          {examples.map((e, i) => <div key={i} className="pl-2">• {e}</div>)}
        </div>
        <textarea value={reason} onChange={e => setReason(e.target.value)} className="input w-full" rows={3} placeholder={`請說明調整${isPrin ? '原則' : '專長'}配課的理由（必填）`} autoFocus />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button onClick={onCancel} className="btn-secondary text-sm">取消（還原數字）</button>
          <button onClick={() => { if (!reason.trim()) { setErr('請填寫理由，或按「取消」還原數字'); return } onConfirm(reason.trim()) }} className="btn-primary text-sm">確認</button>
        </div>
      </div>
    </div>
  )
}
