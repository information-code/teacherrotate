'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  GRADE_LABEL, planTotal, subjectCategory, CERT_SUBJECTS, PROJECT_PRESETS, PRINCIPLE_ORDER, OPTIONAL_SUBJECTS,
  defaultSchedulingNeeds,
  type AllocRole, type TeacherAllocation, type ScenarioChoice, type SchedulingNeeds, type AllocationPlan,
} from '@/lib/allocation'
import { ReasonCertModal, ConfirmNotesModal, SchedulingNeedsCard, HomeroomNoticeCard, type ReasonResult } from '@/components/teacher/AllocationSubmitWizard'
import type { HomeroomCtx } from '@/app/teacher/allocation/page'

const OVERTIME_CAP = 6  // 自主＋意願超鐘總額上限

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
  const reductions = homeroom ? (homeroom.scenarios.length ? homeroom.scenarios.map(s => s.reduction) : [0]) : []
  const [projects, setProjects] = useState<{ name: string; hours: number; custom?: boolean }[]>(initial.projects ?? [])
  const projectFiled = projects.reduce((s, p) => s + (Number(p.hours) || 0), 0)  // C：老師列舉的專案減課總數
  // 實際節數 = 基本(A) − 總量管制減課(B) − 專案減課(C，老師列舉)
  const scenarioPeriods = Array.from(new Set(reductions.map(r => base0 - r - projectFiled))).filter(p => p > 0).sort((a, b) => b - a)
  function addProject() { setProjects(p => [...p, { name: PROJECT_PRESETS[0], hours: 0 }]) }
  function removeProject(i: number) { setProjects(p => p.filter((_, idx) => idx !== i)) }
  function setProject(i: number, patch: Partial<{ name: string; hours: number; custom: boolean }>) { setProjects(p => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x))) }

  const principleSubjects = homeroom ? homeroom.subjects.filter(s => subjectCategory(s) === 'principle') : []
  const specialtySubjects = homeroom ? homeroom.subjects.filter(s => subjectCategory(s) === 'specialty') : []
  const optionalSubjects = homeroom ? homeroom.subjects.filter(s => subjectCategory(s) === 'optional').sort((a, b) => OPTIONAL_SUBJECTS.indexOf(a) - OPTIONAL_SUBJECTS.indexOf(b)) : []
  const principleTotal = principleSubjects.reduce((s, ss) => s + (homeroom?.subjectMax[ss] ?? 0), 0)
  // 系統自動配課（無行政方案時的預設）：原則(依序)→選填→專長，填到實際節數為止；原則放不下時依序保留國語/數學/班級活動/自主學習/生活
  function autoFill(P: number): Record<string, number> {
    if (!homeroom) return {}
    const bd: Record<string, number> = {}
    let remaining = P
    const principleOrder = PRINCIPLE_ORDER.filter(s => homeroom.subjects.includes(s))
    for (const s of [...principleOrder, ...optionalSubjects, ...specialtySubjects]) {
      if (remaining <= 0) break
      const cap = homeroom.subjectMax[s] ?? 0
      const give = Math.min(cap, remaining)
      if (give > 0) { bd[s] = give; remaining -= give }
    }
    return bd
  }

  // 行政方案（preset）依「總節數」索引
  const presetsByPeriod: Record<number, AllocationPlan[]> = {}
  if (homeroom) for (const sc of homeroom.scenarios) for (const p of sc.plans) {
    const t = planTotal(p); (presetsByPeriod[t] ??= []).push(p)
  }

  // 以「實際節數」為鍵的方案；初始化時為每個情境預載方案／補滿原則，並校正無理由的偏離
  const [plans, setPlans] = useState<Record<string, ScenarioChoice>>(() => {
    const p: Record<string, ScenarioChoice> = { ...(initial.plans ?? {}) }
    const ro = (initial.locked ?? false) || closed
    if (homeroom && !ro) {
      for (const P of scenarioPeriods) {
        if (!p[String(P)]) {
          const preset = presetsByPeriod[P]?.[0]
          if (preset) p[String(P)] = { planName: preset.name, breakdown: { ...preset.alloc } }
          else p[String(P)] = { planName: null, breakdown: autoFill(P) }  // 無方案 → 系統自動配（原則→選填→專長）
        }
      }
      const pr = normReasons(initial.principleReasons)
      const sr = normReasons(initial.specialtyReasons)
      for (const k of Object.keys(p)) {
        const P = Number(k)
        const bd = { ...p[k].breakdown }
        // 原則配課放得下(P≥原則總數)卻被減又沒理由 → 還原補滿；減太多放不下則保留（不強迫補滿）
        if (P >= principleTotal) for (const s of principleSubjects) { const std = homeroom.subjectMax[s] ?? 0; if ((Number(bd[s]) || 0) !== std && !pr[k]?.[s]) bd[s] = std }
        const spec = presetsByPeriod[P]?.[0]?.alloc ?? {}
        for (const s of specialtySubjects) { const std = Number(spec[s]) || 0; if ((Number(bd[s]) || 0) !== std && !sr[k]?.[s]) bd[s] = std }
        p[k] = { ...p[k], breakdown: bd }
      }
    }
    return p
  })
  const [autonomousAgreed, setAutonomousAgreed] = useState<Record<string, number>>(initial.autonomousOvertime ?? {})
  const [willingOvertime, setWillingOvertime] = useState(initial.willingOvertime ?? 0)
  const [willingSubjects, setWillingSubjects] = useState<string[]>(initial.willingSubjects ?? [])
  const [selfMode, setSelfMode] = useState<Record<string, boolean>>({})
  const [principleReasons, setPrincipleReasons] = useState<Record<string, Record<string, string>>>(() => normReasons(initial.principleReasons))
  const [principleEdit, setPrincipleEdit] = useState<{ P: number; subj: string; revertTo: number | null } | null>(null)
  const [specialtyReasons, setSpecialtyReasons] = useState<Record<string, Record<string, string>>>(() => normReasons(initial.specialtyReasons))
  const [specialtyEdit, setSpecialtyEdit] = useState<{ P: number; subj: string; revertTo: number | null } | null>(null)
  const [subjectWishes, setSubjectWishes] = useState<string[]>(initial.subjectWishes ?? [])  // 行政：想授課科目志願
  const [gradeHours] = useState<Record<string, number>>(initial.gradeHours ?? {})

  const [seg, setSeg] = useState(1)  // 全流程分段（導師 1~5；科任/行政 1~3）
  const [showPeriodsTable, setShowPeriodsTable] = useState(false)
  const [principleReason] = useState(initial.principleReason ?? '')
  const [specialtyReason] = useState(initial.specialtyReason ?? '')
  const [scheduling, setScheduling] = useState<SchedulingNeeds>(initial.scheduling ?? defaultSchedulingNeeds())
  const [reasonModalOpen, setReasonModalOpen] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [noticeAck, setNoticeAck] = useState(false)
  const [locked, setLocked] = useState(initial.locked ?? false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dragWilling, setDragWilling] = useState<number | null>(null)

  const readOnly = locked || closed
  const topRef = useRef<HTMLDivElement>(null)

  const sumOf = (P: number) => homeroom ? homeroom.subjects.reduce((s, subj) => s + (Number(plans[String(P)]?.breakdown[subj]) || 0), 0) : 0
  // 該情境的自主超鐘（合計>實際、且老師已同意該數量）
  const autoOf = (P: number) => { const over = sumOf(P) - P; return (over > 0 && autonomousAgreed[String(P)] === over) ? over : 0 }
  const maxAutonomous = scenarioPeriods.length ? Math.max(0, ...scenarioPeriods.map(autoOf)) : 0
  const willingMax = Math.max(0, OVERTIME_CAP - maxAutonomous)

  // 意願超鐘可支援科目＝排除已配滿的科（在任一情境配到該科上限者）
  const maxedSubjects = (() => {
    const set = new Set<string>()
    if (homeroom) for (const s of homeroom.subjects) {
      const cap = homeroom.subjectMax[s] ?? 0
      if (cap > 0 && scenarioPeriods.some(P => (Number(plans[String(P)]?.breakdown[s]) || 0) >= cap)) set.add(s)
    }
    return set
  })()
  const willingCandidates = allSubjects.filter(s => !maxedSubjects.has(s))
  const willingOrdered = (() => {
    const out = willingSubjects.filter(s => willingCandidates.includes(s))
    for (const s of willingCandidates) if (!out.includes(s)) out.push(s)
    return out
  })()

  // ── 偏離判斷與理由（沿用）──
  function baselineFor(P: number): Record<string, number> {
    return presetsByPeriod[P]?.[0]?.alloc ?? {}
  }
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
    const scenariosMirror: Record<string, ScenarioChoice> = {}
    for (const r of reductions) { const ch = plans[String(base0 - r - projectFiled)]; if (ch) scenariosMirror[String(r)] = ch }
    const aggReasons = (reasons: Record<string, Record<string, string>>, fallback: string) =>
      role === 'homeroom'
        ? Object.keys(reasons).filter(k => plans[k] && Object.keys(reasons[k]).length)
            .sort((a, b) => Number(a) - Number(b))
            .map(k => `實際${k}節 ${Object.entries(reasons[k]).map(([s, r]) => `${s}：${r}`).join('；')}`).join('\n')
        : fallback
    const autoOut: Record<string, number> = {}
    for (const P of scenarioPeriods) { const a = autoOf(P); if (a > 0) autoOut[String(P)] = a }
    return {
      role, work, grade,
      projectReduction: role === 'homeroom' ? projectFiled : (initial.projectReduction ?? 0), extraHours: 0,
      projects,
      scenarios: role === 'homeroom' ? scenariosMirror : (initial.scenarios ?? {}),
      scenariosOriginal: role === 'homeroom' ? scenariosMirror : (initial.scenariosOriginal ?? {}),
      plans, principleReasons, specialtyReasons,
      autonomousOvertime: autoOut, willingOvertime, willingSubjects: willingOrdered.slice(0, willingOvertime > 0 ? undefined : 0),
      overtimeHours: willingOvertime,  // 相容：統計頁的「意願超鐘」沿用 overtimeHours
      gradeHours,
      projectOrder: initial.projectOrder ?? [],
      subjectWishes: subjectWishes.filter(Boolean),
      scheduling, principleReason: aggReasons(principleReasons, principleReason), specialtyReason: aggReasons(specialtyReasons, specialtyReason),
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
  // 專案減課改變 → 實際節數改變 → 為新出現的情境補播方案
  useEffect(() => {
    if (readOnly || role !== 'homeroom' || !homeroom) return
    setPlans(prev => {
      let changed = false
      const p = { ...prev }
      for (const P of scenarioPeriods) {
        if (!p[String(P)]) {
          changed = true
          const preset = presetsByPeriod[P]?.[0]
          if (preset) p[String(P)] = { planName: preset.name, breakdown: { ...preset.alloc } }
          else p[String(P)] = { planName: null, breakdown: autoFill(P) }  // 無方案 → 系統自動配（原則→選填→專長）
        }
      }
      return changed ? p : prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioPeriods.join(',')])

  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (readOnly) return
    setSaveStatus('saving')
    const t = setTimeout(() => { void put(false) }, 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, projects, autonomousAgreed, principleReasons, specialtyReasons, willingOvertime, willingSubjects, subjectWishes, scheduling])

  function setPlanChoice(P: number, fn: (c: ScenarioChoice) => ScenarioChoice) {
    setPlans(prev => ({ ...prev, [String(P)]: fn(prev[String(P)] ?? { planName: null, breakdown: {} }) }))
  }

  // ── 原則／專長即時理由（沿用）──
  function onPrincipleChange(P: number, subj: string, n: number) {
    const oldVal = Number(plans[String(P)]?.breakdown[subj] ?? 0)
    if (n === oldVal) return
    setPlanChoice(P, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))
    if (!subjectDeviates(P, subj, n, 'principle')) { setPrincipleReasons(prev => removeSubjReason(prev, P, subj)); return }
    // 原則放得下(P≥原則總數)卻刻意減 → 要理由；減太多放不下(P<原則總數) → 不是故意的，免理由（僅靠超鐘建議提醒）
    if (P >= principleTotal && !principleReasons[String(P)]?.[subj]) setPrincipleEdit({ P, subj, revertTo: oldVal })
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
    if (!subjectDeviates(P, subj, n, 'specialty')) { setSpecialtyReasons(prev => removeSubjReason(prev, P, subj)); return }
    if (!specialtyReasons[String(P)]?.[subj]) setSpecialtyEdit({ P, subj, revertTo: oldVal })
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

  function setWish(i: number, val: string) { setSubjectWishes(prev => { const a = [prev[0] ?? '', prev[1] ?? '', prev[2] ?? '']; a[i] = val; return a }) }
  function reorderWilling(from: number, to: number) {
    setWillingSubjects(() => { const arr = [...willingOrdered]; const [m] = arr.splice(from, 1); arr.splice(to, 0, m); return arr })
  }

  const certSubjects = (() => {
    const present = new Set<string>()
    if (role === 'homeroom') for (const ch of Object.values(plans)) for (const cs of CERT_SUBJECTS) if ((Number(ch.breakdown[cs]) || 0) > 0) present.add(cs)
    return [...present]
  })()

  function failNext(msg: string) { setError(msg) }
  function goNext() {
    setError(null)
    if (role === 'homeroom') {
      if (!noticeAck) { failNext('請先勾選注意事項中的「我已熟讀上方注意事項」再繼續。'); return }
      const issues: string[] = []
      for (const P of scenarioPeriods) {
        const sum = sumOf(P)
        if (sum < P) issues.push(`「實際 ${P} 節」尚差 ${P - sum} 節，請補足。`)
        else if (sum > P) {
          const over = sum - P
          if (over > OVERTIME_CAP) issues.push(`「實際 ${P} 節」多了 ${over} 節，已超過自願超鐘上限 ${OVERTIME_CAP} 節，請調整方案。`)
          else if (autonomousAgreed[String(P)] !== over) issues.push(`「實際 ${P} 節」多了 ${over} 節，請勾選同意「自願超鐘 ${over} 節」。`)
        }
      }
      if (issues.length) { failNext('尚有以下項目需處理才能繼續：\n• ' + issues.join('\n• ')); return }
    }
    if (certSubjects.length) setReasonModalOpen(true)
    else setSeg(4)
  }
  function onReasonDone(_r: ReasonResult) { setReasonModalOpen(false); setSeg(4) }
  async function onConfirm() { setConfirmModalOpen(false); if (await put(true)) setLocked(true) }

  const willingSeg = role === 'homeroom' ? 4 : 2
  const scheduleSeg = role === 'homeroom' ? 5 : 3
  const lastSeg = scheduleSeg
  const segLabel = (role === 'homeroom'
    ? ['確認節數', '注意事項', '方案配課', '超鐘意願', '排課需求']
    : ['基本資料', '超鐘意願', '排課需求'])[seg - 1] ?? ''

  if (role === 'none') {
    return (
      <div className="space-y-5 max-w-3xl">
        <h2 className="page-title">配課選填</h2>
        <div className="card border-amber-200 bg-amber-50"><p className="text-sm text-amber-800"><span className="font-semibold">您 {year} 學年度無需配課</span>——尚未有本年度工作紀錄，或屬留停／借調等狀態。如有疑問請洽管理員。</p></div>
      </div>
    )
  }

  // ── 導師：方案區塊 ──
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
    if (!ch) return null  // 尚未播種（剛改專案減課）→ 由 effect 補上後重繪
    const presets = presetsByPeriod[P] ?? []
    const hasPlans = presets.length > 0
    const inSelf = !hasPlans || !!selfMode[key]
    const planName = (ch.planName && presets.some(p => p.name === ch.planName)) ? ch.planName : ''
    const sum = sumOf(P)
    const over = sum - P
    const agreed = autonomousAgreed[key] === over

    function pickPlan(v: string) {
      if (v === '') { setPlanChoice(P, () => ({ planName: null, breakdown: { ...ch.breakdown } })); return }
      const plan = presets.find(p => p.name === v)
      setPlanChoice(P, () => ({ planName: v, breakdown: { ...(plan?.alloc ?? {}) } }))
    }
    function enterSelf() { setSelfMode(m => ({ ...m, [key]: true })); setPlanChoice(P, c => ({ planName: null, breakdown: { ...c.breakdown } })) }
    function cancelSelf() { setSelfMode(m => ({ ...m, [key]: false })); setPrincipleReasons(prev => { const mm = { ...prev }; delete mm[key]; return mm }); setSpecialtyReasons(prev => { const mm = { ...prev }; delete mm[key]; return mm }); if (presets[0]) setPlanChoice(P, () => ({ planName: presets[0].name, breakdown: { ...presets[0].alloc } })) }

    const prinEnt = Object.entries(principleReasons[key] ?? {})
    const specEnt = Object.entries(specialtyReasons[key] ?? {})

    return (
      <div key={P} className="card p-4 space-y-3">
        {prinEnt.length > 0 && (
          <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 space-y-0.5">
            <div className="font-semibold">動到原則配課（理由提課發會）：</div>
            {prinEnt.map(([s, rr]) => <div key={s} className="pl-1">・<span className="font-medium">{s}</span>：<span className="whitespace-pre-line">{rr}</span>{!readOnly && <button onClick={() => setPrincipleEdit({ P, subj: s, revertTo: null })} className="ml-1 underline text-red-600 hover:text-red-800">編輯</button>}</div>)}
          </div>
        )}
        {specEnt.length > 0 && (
          <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 space-y-0.5">
            <div className="font-semibold">動到專長配課（課務組排配課依據）：</div>
            {specEnt.map(([s, rr]) => <div key={s} className="pl-1">・<span className="font-medium">{s}</span>：<span className="whitespace-pre-line">{rr}</span>{!readOnly && <button onClick={() => setSpecialtyEdit({ P, subj: s, revertTo: null })} className="ml-1 underline text-amber-700 hover:text-amber-900">編輯</button>}</div>)}
          </div>
        )}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-zinc-700">實際 {P} 節</h3>
          {hasPlans && !selfMode[key] && presets.length > 1 && (
            <select className="input py-1 text-sm w-48" value={planName} disabled={readOnly} onChange={e => pickPlan(e.target.value)}>
              <option value="">請選擇方案</option>
              {presets.map((p, i) => <option key={i} value={p.name}>{p.name || `方案${i + 1}`}</option>)}
            </select>
          )}
        </div>

        {hasPlans && !selfMode[key] && planName && <>
          {block(P, '導師原則配課', principleSubjects, false)}
          {block(P, '導師選填配課', optionalSubjects, false)}
          {block(P, '導師專長配課', specialtySubjects, false)}
        </>}
        {inSelf && <>
          {block(P, '導師原則配課', principleSubjects, !readOnly, <span className="text-zinc-400 font-normal">調整需填理由</span>, (subj, n) => onPrincipleChange(P, subj, n))}
          {block(P, '導師選填配課', optionalSubjects, !readOnly)}
          {block(P, '導師專長配課', specialtySubjects, !readOnly, <span className="text-zinc-400 font-normal">調整需填理由</span>, (subj, n) => onSpecialtyChange(P, subj, n))}
        </>}

        <div className="flex items-end justify-between gap-3 pt-1">
          <div className="text-[11px] text-zinc-400 flex-1">
            {!inSelf && !readOnly && <>已選用方案；如需調整可<button onClick={enterSelf} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改為自訂配課</button>。</>}
            {inSelf && hasPlans && !readOnly && <>自訂配課。<button onClick={cancelSelf} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改選方案</button></>}
          </div>
          <div className={`text-lg font-semibold whitespace-nowrap ${over === 0 ? 'text-green-600' : over < 0 ? 'text-amber-600' : 'text-sky-600'}`}>{over < 0 ? `剩餘 ${-over} 節` : over === 0 ? '剩餘 0 節 ✓' : `超鐘 ${over} 節`}</div>
        </div>

        {/* 合計 > 實際 → 自主超鐘確認 */}
        {over > 0 && (
          over > OVERTIME_CAP
            ? <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">此方案超過實際 {over} 節，已超過自願超鐘上限 {OVERTIME_CAP} 節，請調整。</div>
            : <label className={`flex items-center gap-2 rounded-sm border px-3 py-2 text-xs ${agreed ? 'border-green-300 bg-green-50 text-green-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
                <input type="checkbox" checked={agreed} disabled={readOnly} onChange={e => setAutonomousAgreed(prev => ({ ...prev, [key]: e.target.checked ? over : 0 }))} className="w-4 h-4" />
                <span>此方案合計超過實際 {P} 節，代表你將<strong>自願超鐘 {over} 節</strong>以維持配課完整。</span>
              </label>
        )}

        {/* 未完整授課（某科只配一部分 → 與他人共課）提醒 */}
        {(() => {
          // 原則配課：低於上限（含 0，減太多沒吃下原則）即不完整；其餘科目：0<節數<上限（與他人共課）才算
          const partials = homeroom!.subjects.filter(s => { const v = Number(ch.breakdown[s]) || 0; const cap = homeroom!.subjectMax[s] ?? 0; if (cap <= 0) return false; return principleSubjects.includes(s) ? v < cap : (v > 0 && v < cap) })
          if (!partials.length) return null
          return (
            <div className="rounded-sm border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 space-y-0.5">
              {partials.map(s => (
                <div key={s}>偵測到您的「<span className="font-medium">{s}</span>」課並未完整授課（{ch.breakdown[s]}/{homeroom!.subjectMax[s]} 節），建議您{over < 0 ? '補齊該科目節數' : '超鐘點後補齊該科目節數'}。</div>
              ))}
            </div>
          )
        })()}
      </div>
    )
  }

  return (
    <div ref={topRef} className="space-y-5 max-w-4xl scroll-mt-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課選填 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
            {!readOnly && <span className="ml-2 text-xs font-normal text-zinc-400">步驟 {seg} / {lastSeg} · {segLabel}</span>}
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

      {/* 導師：段1~3（確認節數 / 注意事項 / 方案配課） */}
      {role === 'homeroom' && homeroom && (readOnly ? (
        scenarioPeriods.map(P => periodCard(P))
      ) : <>
          {/* 段1：確認基本授課與專案減課 */}
          {seg === 1 && <>
            {/* A：基本授課節數 */}
            <div className="card p-4 space-y-1">
              <div className="text-sm text-zinc-800"><span className="font-semibold text-zinc-400">A</span>　基本授課節數 <span className="font-semibold text-lg text-zinc-900">{base0}</span> 節</div>
              <p className="text-[11px] text-zinc-400">依據國民中小學教師授課節數訂定基準。</p>
            </div>
            {/* B：列舉專案減課 */}
            <div className="card p-4 space-y-2">
              <div className="text-sm text-zinc-800"><span className="font-semibold text-zinc-400">B</span>　列舉專案減課數 <span className="font-semibold text-lg text-zinc-900">{projectFiled}</span> 節</div>
              <p className="text-[11px] text-zinc-400">請列舉您於下學年度因參與專案或特殊任務產生之減課（例如：學年主任、輔導團、基地團等）。</p>
              {projects.map((p, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const isCustom = !!p.custom || (!!p.name && !PROJECT_PRESETS.includes(p.name))
                    return <>
                      <select value={isCustom ? '__OTHER__' : p.name} disabled={readOnly}
                        onChange={e => { const v = e.target.value; if (v === '__OTHER__') setProject(i, { custom: true, name: PROJECT_PRESETS.includes(p.name) ? '' : p.name }); else setProject(i, { name: v, custom: false }) }}
                        className="input py-0.5 text-sm w-48">
                        {PROJECT_PRESETS.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="__OTHER__">其他（自行輸入）</option>
                      </select>
                      {isCustom && <input value={p.name} disabled={readOnly} onChange={e => setProject(i, { name: e.target.value, custom: true })} placeholder="自行輸入名稱" className="input py-0.5 text-sm flex-1 min-w-[8rem]" autoFocus />}
                    </>
                  })()}
                  <span className="text-xs text-zinc-500">減</span>
                  <NumberInput min={0} max={6} value={p.hours} disabled={readOnly} onChange={n => setProject(i, { hours: Math.min(6, Math.max(0, n)) })} className="input w-14 text-center py-0.5" />
                  <span className="text-xs text-zinc-500">節</span>
                  {!readOnly && <button onClick={() => removeProject(i)} className="text-zinc-400 hover:text-red-500 text-xs">刪除</button>}
                </div>
              ))}
              {!readOnly && <button onClick={addProject} className="btn-secondary text-xs">＋ 新增專案</button>}
              {projectFiled > 0 && <p className="text-xs text-red-600">教學組將依校內會議決議或公文核實，如發現有誤會再與您聯繫。</p>}
            </div>
            {/* C：總量管制減課數 */}
            <div className="card p-4 space-y-1">
              <div className="text-sm text-zinc-800"><span className="font-semibold text-zinc-400">C</span>　總量管制減課數 <span className="font-semibold text-lg text-zinc-900">{reductions.length ? (Math.min(...reductions) === Math.max(...reductions) ? Math.min(...reductions) : `${Math.min(...reductions)}~${Math.max(...reductions)}`) : 0}</span> 節</div>
              <p className="text-[11px] text-zinc-400">將依校內課發會排配課會議決議後確認。</p>
            </div>
            {/* D：最低授課節數（最重要，黃底凸顯） */}
            <div className="card border-amber-300 bg-amber-50 p-4 space-y-1">
              <div className="text-sm font-semibold text-amber-900"><span className="text-amber-500">D</span>　最低授課節數（A − B − C）</div>
              <p className="text-[11px] text-amber-700">你目前可能的實際授課節數：</p>
              {reductions.map(b => (
                <div key={b} className="text-sm text-amber-900">基本 {base0} − 專案減 {projectFiled} − 總量管制減 {b} = <span className="font-bold text-lg text-amber-900">{base0 - b - projectFiled} 節</span></div>
              ))}
            </div>
            <div className="flex justify-end"><button onClick={() => setSeg(2)} className="btn-primary text-sm">下一步</button></div>
          </>}

          {/* 段2：注意事項 */}
          {seg === 2 && <>
            <HomeroomNoticeCard grade={homeroom.grade} />
            <div className="flex items-center justify-between">
              <button onClick={() => setSeg(1)} className="btn-secondary text-sm">上一步</button>
              <button onClick={() => { setNoticeAck(true); setSeg(3) }} className="btn-primary text-sm">我已詳讀注意事項，開始配課</button>
            </div>
          </>}

          {/* 段3：方案配課 */}
          {seg === 3 && <>
            <div className="card border-amber-300 bg-amber-50 p-4 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-amber-900">您需要根據您的「D：最低授課節數」方案進行配課：</div>
                <button onClick={() => setShowPeriodsTable(true)} className="flex-shrink-0 flex items-center gap-1.5 text-xs text-amber-800 border border-amber-300 rounded-sm px-2 py-1 bg-white hover:border-amber-400">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
                  <span className="font-medium">課程節數表</span>
                </button>
              </div>
              {reductions.map(b => (
                <div key={b} className="text-sm text-amber-900">基本 {base0} − 專案減 {projectFiled} − 總量管制減 {b} = <span className="font-bold text-lg text-amber-900">{base0 - b - projectFiled} 節</span></div>
              ))}
            </div>
            {scenarioPeriods.length === 0
              ? <div className="card text-sm text-zinc-400">尚無可配節數，請確認管理者是否已啟用減課情境與輸入専案減課。</div>
              : scenarioPeriods.map(P => periodCard(P))}
            <div className="flex items-center justify-between gap-3">
              <button onClick={() => setSeg(2)} className="btn-secondary text-sm flex-shrink-0">上一步</button>
              {error && <p className="text-sm text-red-700 whitespace-pre-line flex-1 text-right">{error}</p>}
              <button onClick={goNext} className="btn-primary text-sm flex-shrink-0">我已確認我的配課方案</button>
            </div>
          </>}
        </>)}

        {role === 'admin' && (readOnly || seg === 1) && <>
          <div className="card p-4"><div className="flex items-center gap-3 flex-wrap"><span className="text-sm text-zinc-600">實際授課節數</span><span className="text-2xl font-semibold text-zinc-900">{base0 - (initial.projectReduction ?? 0)}</span></div></div>
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
        </>}

        {role === 'subject' && (readOnly || seg === 1) && (
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-3 flex-wrap"><span className="text-sm text-zinc-600">實際授課節數</span><span className="text-2xl font-semibold text-zinc-900">{base0 - (initial.projectReduction ?? 0)}</span></div>
            <p className="text-[11px] text-zinc-400">授課科目與各年級節數由管理者於後續配課時填寫。請於下一步填寫超鐘點意願。</p>
          </div>
        )}

      {/* 超鐘點意願調查（導師段4 / 科任行政段2） */}
      {(readOnly || seg === willingSeg) && (
        <div className="space-y-4">
          {role === 'homeroom' && maxAutonomous > 0 && (
            <div className="card border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">你在配課中最多已同意<strong>自願超鐘 {maxAutonomous} 節</strong>（依實際減課情況）。以下為「額外」願意支援的超鐘意願。</div>
          )}
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-700">超鐘點意願調查</h3>
            <p className="text-[11px] text-zinc-400">除了配課中的自願超鐘，若某些科目缺課，你還願意額外幫忙超鐘幾節？供課務組調度參考。</p>
            <label className="flex items-center gap-2 text-sm"><span className="text-zinc-700">意願超鐘點</span>
              <NumberInput min={0} max={willingMax} value={willingOvertime} disabled={readOnly} onChange={n => setWillingOvertime(Math.min(willingMax, Math.max(0, n)))} className="input w-16 text-center py-0.5" />
              <span className="text-xs text-zinc-400">（最多 {willingMax} 節；自願＋意願合計不超過 {OVERTIME_CAP} 節）</span>
            </label>
            {willingOvertime > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">把你<strong>最願意支援的科目拖到上面</strong>（已排除你已配滿的科）：</p>
                {willingOrdered.length === 0
                  ? <p className="text-[11px] text-zinc-400">目前沒有可支援的科目。</p>
                  : <ul className="space-y-1.5 max-w-md">
                      {willingOrdered.map((s, idx) => (
                        <li key={s} draggable={!readOnly}
                          onDragStart={() => setDragWilling(idx)}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => { if (dragWilling !== null) { reorderWilling(dragWilling, idx); setDragWilling(null) } }}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-sm border text-sm ${idx === 0 ? 'border-green-300 bg-green-50' : 'border-zinc-200 bg-white'} ${!readOnly ? 'cursor-move' : ''}`}>
                          <span className="text-zinc-400">≡</span><span className="text-xs text-zinc-500 w-8">第{idx + 1}</span><span className="font-medium text-zinc-800">{s}</span>
                        </li>
                      ))}
                    </ul>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 排課需求（導師段5 / 科任行政段3） */}
      {(readOnly || seg === scheduleSeg) && <SchedulingNeedsCard value={scheduling} onChange={setScheduling} readOnly={readOnly} />}

      {/* 底部導覽：導師段1~3用段內按鈕；其餘用此導覽 */}
      {!readOnly && (role === 'homeroom' ? seg >= willingSeg : true) && (
        <div className="flex items-center justify-between pt-2">
          {seg > 1 ? <button onClick={() => setSeg(s => s - 1)} className="btn-secondary text-sm">上一步</button> : <span />}
          {seg < lastSeg
            ? <button onClick={() => setSeg(s => s + 1)} className="btn-primary text-sm">下一步</button>
            : <button onClick={() => setConfirmModalOpen(true)} className="btn-primary text-sm">送出並鎖定</button>}
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
