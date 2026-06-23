'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  REDUCTION_LABEL, GRADE_LABEL, GRADES, planTotal, subjectCategory, CERT_SUBJECTS,
  type TeacherAllocation, type ScenarioChoice,
} from '@/lib/allocation'
import { ReasonCertModal, ConfirmNotesModal, type ReasonResult } from '@/components/teacher/AllocationSubmitWizard'
import type { HomeroomCtx } from '@/app/teacher/allocation/page'

interface Props {
  year: number
  closed: boolean
  subjectBase: number
  grades: Record<number, HomeroomCtx>
  allSubjects: string[]
  initial: TeacherAllocation
}

type Picked = '' | 'homeroom' | 'subject'

export function SubstituteAllocationPage({ year, closed, subjectBase, grades, allSubjects, initial }: Props) {
  const projectReduction = initial.projectReduction ?? 0  // 管理者事後審核用；不在教師端公式內
  const [picked, setPicked] = useState<Picked>(initial.role === 'homeroom' || initial.role === 'subject' ? initial.role : '')
  const [grade, setGrade] = useState<number | null>(initial.grade ?? null)
  const [scenarios, setScenarios] = useState<Record<string, ScenarioChoice>>(initial.scenarios ?? {})
  const [selfMode, setSelfMode] = useState<Record<string, boolean>>({})
  const [principleUnlocked, setPrincipleUnlocked] = useState<Record<string, boolean>>({})
  const [subjects, setSubjects] = useState<string[]>(initial.subjects ?? [])
  const [sgh, setSgh] = useState<Record<string, Record<string, number>>>(initial.subjectGradeHours ?? {})
  const [step, setStep] = useState(1)
  const [principleReason, setPrincipleReason] = useState(initial.principleReason ?? '')
  const [specialtyReason, setSpecialtyReason] = useState(initial.specialtyReason ?? '')
  const [overtimeHours, setOvertimeHours] = useState(initial.overtimeHours ?? 0)
  const [overtimeOrder, setOvertimeOrder] = useState<string[]>(initial.overtimeOrder ?? [])
  const [projects, setProjects] = useState<{ name: string; hours: number }[]>(initial.projects ?? [])
  const [projectOrder, setProjectOrder] = useState<string[]>(initial.projectOrder ?? [])
  const [reasonModalOpen, setReasonModalOpen] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [locked, setLocked] = useState(initial.locked ?? false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const readOnly = locked || closed

  function deviates(reduction: number, breakdown: Record<string, number>, cat: 'principle' | 'specialty'): boolean {
    if (!grade) return false
    const gc = grades[grade]
    const base = gc.scenarios.find(s => s.reduction === reduction)?.plans[0]?.alloc ?? {}
    return gc.subjects.filter(s => subjectCategory(s) === cat).some(s => (Number(breakdown[s]) || 0) !== (Number(base[s]) || 0))
  }

  function buildData(lock: boolean): TeacherAllocation {
    return {
      role: picked || 'none',
      work: picked === 'homeroom' ? '代理導師' : picked === 'subject' ? '代理科任' : '',
      grade: picked === 'homeroom' ? grade : null,
      projectReduction, extraHours: 0,
      scenarios: picked === 'homeroom' ? scenarios : {},
      subjects: picked === 'subject' ? subjects : [],
      subjectGradeHours: picked === 'subject' ? sgh : {},
      projects, projectOrder: projectOrder.filter(Boolean),
      overtimeHours,
      overtimeOrder: overtimeOrder.filter(Boolean),
      principleReason, specialtyReason,
      acknowledged: lock ? true : (initial.acknowledged ?? false),
      locked: lock,
      submittedAt: lock ? new Date().toISOString() : (initial.submittedAt ?? null),
    }
  }
  async function put(lock: boolean): Promise<boolean> {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/teacher/allocation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: buildData(lock) }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.message ?? '儲存失敗'); setSaveStatus('idle'); return false }
      setSaveStatus('saved'); setError(null); return true
    } catch { setSaveStatus('idle'); setError('儲存失敗'); return false }
  }
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (readOnly) return
    setSaveStatus('saving')
    const t = setTimeout(() => { void put(false) }, 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, grade, scenarios, subjects, sgh, overtimeHours, overtimeOrder, projects, projectOrder, principleReason, specialtyReason])

  function setChoice(r: number, fn: (c: ScenarioChoice) => ScenarioChoice) {
    setScenarios(prev => ({ ...prev, [String(r)]: fn(prev[String(r)] ?? { planName: null, breakdown: {} }) }))
  }
  function toggleSubject(s: string) { setSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]) }
  function setHour(subj: string, g: number, n: number) { setSgh(prev => ({ ...prev, [subj]: { ...(prev[subj] ?? {}), [String(g)]: n } })) }
  function setOrder(i: number, val: string) { setOvertimeOrder(prev => { const a = [prev[0] ?? '', prev[1] ?? '', prev[2] ?? '']; a[i] = val; return a }) }
  function setProjOrder(i: number, val: string) { setProjectOrder(prev => { const a = [prev[0] ?? '', prev[1] ?? '', prev[2] ?? '']; a[i] = val; return a }) }
  function addProject() { setProjects(p => [...p, { name: '', hours: 0 }]) }
  function removeProject(i: number) { setProjects(p => p.filter((_, idx) => idx !== i)) }
  function setProject(i: number, patch: Partial<{ name: string; hours: number }>) { setProjects(p => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x))) }

  const subjectTarget = subjectBase                       // 超鐘點與專案減課不計入教師端
  const subjectSum = subjects.reduce((s, subj) => s + GRADES.reduce((a, g) => a + (Number(sgh[subj]?.[String(g)]) || 0), 0), 0)

  // 第一頁驗證 → 理由/證照 modal 或第二頁
  function goNext() {
    setError(null)
    if (!picked) { setError('請先選擇身分（導師／科任）'); return }
    if (picked === 'homeroom') {
      if (!grade) { setError('請選擇年級'); return }
      const gc = grades[grade]
      const issues: string[] = []
      for (const sc of gc.scenarios) {
        const target = gc.homeroomBase - sc.reduction
        const choice = scenarios[String(sc.reduction)]
        if (!choice || (choice.planName === null && Object.keys(choice.breakdown).length === 0)) { issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：尚未選方案或自配`); continue }
        const sum = Object.values(choice.breakdown).reduce((s, n) => s + (Number(n) || 0), 0)
        if (sum !== target) issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：合計 ${sum} ≠ 目標 ${target}`)
      }
      if (issues.length) { setError('無法繼續：\n' + issues.join('\n')); return }
    }
    if (picked === 'subject') {
      if (subjects.length === 0) { setError('請至少選一個授課科目'); return }
      if (subjectSum !== subjectTarget) { setError(`各科各年級節數合計 ${subjectSum} ≠ 實際授課節數 ${subjectTarget}（${subjectSum < subjectTarget ? '不足' : '超過'} ${Math.abs(subjectSum - subjectTarget)}）。`); return }
    }
    if (wantPrinciple || wantSpecialty || certSubjects.length) setReasonModalOpen(true)
    else setStep(2)
  }
  function onReasonDone(r: ReasonResult) { setPrincipleReason(r.principleReason); setSpecialtyReason(r.specialtyReason); setReasonModalOpen(false); setStep(2) }
  async function onConfirm() { setConfirmModalOpen(false); if (await put(true)) setLocked(true) }

  // modal 情境判定
  const gc = picked === 'homeroom' && grade ? grades[grade] : null
  const wantPrinciple = !!gc && gc.scenarios.some(sc => { const ch = scenarios[String(sc.reduction)]; return !!ch && ch.planName === null && deviates(sc.reduction, ch.breakdown, 'principle') })
  const wantSpecialty = !!gc && gc.scenarios.some(sc => { const ch = scenarios[String(sc.reduction)]; return !!ch && ch.planName === null && deviates(sc.reduction, ch.breakdown, 'specialty') })
  // 證照確認僅導師需要；科任不跳警告理由／證照 modal
  const certSubjects = (() => {
    const present = new Set<string>()
    if (picked === 'homeroom') { for (const ch of Object.values(scenarios)) for (const cs of CERT_SUBJECTS) if ((Number(ch.breakdown[cs]) || 0) > 0) present.add(cs) }
    return [...present]
  })()
  // 減課順序：選填／專長且任一情境 > 0（減課要管是不是 0）
  const reduceOptions = (() => {
    if (picked === 'homeroom' && gc) {
      return gc.subjects.filter(s => { const c = subjectCategory(s); return (c === 'specialty' || c === 'optional') && gc.scenarios.some(sc => (Number(scenarios[String(sc.reduction)]?.breakdown[s]) || 0) > 0) })
    }
    if (picked === 'subject') return subjects.filter(s => subjectCategory(s) !== 'principle')
    return []
  })()
  // 超鐘順序：專長全列（不論是否 0，因為是超鐘點）＋ 選填（>0）
  const overtimeOptions = (() => {
    if (picked === 'homeroom' && gc) {
      return gc.subjects.filter(s => { const c = subjectCategory(s); return c === 'specialty' || (c === 'optional' && gc.scenarios.some(sc => (Number(scenarios[String(sc.reduction)]?.breakdown[s]) || 0) > 0)) })
    }
    if (picked === 'subject') return subjects.filter(s => subjectCategory(s) !== 'principle')
    return []
  })()

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課選填 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度 · 代理教師</span>
            {!readOnly && <span className="ml-2 text-xs font-normal text-zinc-400">步驟 {step} / 2 · {step === 1 ? '配課' : '超鐘意願'}</span>}
          </h2>
          <p className="text-xs text-zinc-500">請先選擇您的身分,再依畫面填寫配課。</p>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
          {saveStatus === 'saved' && !readOnly && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
        </div>
      </div>

      {closed && <div className="card border-amber-200 bg-amber-50"><p className="text-sm text-amber-800"><span className="font-semibold">📋 配課填報已截止</span>——目前唯讀。</p></div>}
      {locked && !closed && <div className="card border-zinc-300 bg-zinc-50"><p className="text-sm text-zinc-700"><span className="font-semibold">🔒 已送出鎖定</span>——如需修改請洽管理員。</p></div>}
      {error && <div className="card border-red-200 bg-red-50"><p className="text-sm text-red-700 whitespace-pre-line">{error}</p></div>}

      {/* ════ 第一頁：配課 ════ */}
      {step === 1 && <>
        <div className="card p-4">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">身分</div>
          <div className="flex gap-2">
            {([['homeroom', '導師'], ['subject', '科任']] as const).map(([v, label]) => (
              <button key={v} disabled={readOnly} onClick={() => setPicked(v)}
                className={`px-4 py-1.5 text-sm rounded-sm border ${picked === v ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>{label}</button>
            ))}
          </div>
        </div>

        {/* 導師 */}
        {picked === 'homeroom' && (
          <>
            <div className="card p-4 flex items-center gap-6 flex-wrap text-sm">
              <label className="flex items-center gap-2"><span className="text-zinc-700">年級</span>
                <select value={grade ?? ''} disabled={readOnly} onChange={e => setGrade(e.target.value ? Number(e.target.value) : null)} className="input py-1 w-28">
                  <option value="">請選擇</option>
                  {GRADES.map(g => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}
                </select>
              </label>
            </div>

            {grade && grades[grade].scenarios.length === 0 && <div className="card text-sm text-zinc-400">管理者尚未為 {GRADE_LABEL[grade]} 啟用情境。</div>}
            {grade && grades[grade].scenarios.map(sc => {
              const g = grades[grade]
              const principleSubjects = g.subjects.filter(s => subjectCategory(s) === 'principle')
              const specialtySubjects = g.subjects.filter(s => subjectCategory(s) === 'specialty')
              const optionalSubjects = g.subjects.filter(s => subjectCategory(s) === 'optional')
              const r = sc.reduction
              const key = String(r)
              const target = g.homeroomBase - r
              const choice = scenarios[key]
              const usablePlans = sc.plans.filter(p => planTotal(p) === target)
              const hasPlans = usablePlans.length > 0
              const inSelf = !hasPlans || !!selfMode[key]
              const planName = (choice?.planName && usablePlans.some(p => p.name === choice.planName)) ? choice.planName : ''
              const sum = choice ? g.subjects.reduce((s, subj) => s + (Number(choice.breakdown[subj]) || 0), 0) : 0
              const principleEditable = inSelf && !readOnly && !!principleUnlocked[key]
              function block(title: string, subjs: string[], editable: boolean, extra?: ReactNode) {
                if (subjs.length === 0) return null
                return (
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold text-zinc-500 flex items-center gap-2">{title}{extra}</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                      {subjs.map((subj, si) => (
                        <div key={si} className="flex items-center gap-1.5">
                          <span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span>
                          {editable
                            ? <NumberInput min={0} value={choice?.breakdown[subj] ?? 0} onChange={n => setChoice(r, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))} className="input w-12 text-center py-0.5 text-xs" />
                            : <span className="w-12 text-center text-xs font-medium text-zinc-800">{choice?.breakdown[subj] ?? 0}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }
              return (
                <div key={r} className="card p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-zinc-700">{REDUCTION_LABEL[r as 0 | 1 | 2]}<span className="ml-2 text-xs font-normal text-zinc-500">目標 {target}</span></h3>
                    {hasPlans && !selfMode[key] && usablePlans.length > 1 && (
                      <select className="input py-1 text-sm w-48" value={planName} disabled={readOnly}
                        onChange={e => { const v = e.target.value; if (!v) { setScenarios(p => { const n = { ...p }; delete n[key]; return n }) } else { const pl = usablePlans.find(p => p.name === v); setChoice(r, () => ({ planName: v, breakdown: { ...(pl?.alloc ?? {}) } })) } }}>
                        <option value="">請選擇方案</option>
                        {usablePlans.map((p, i) => <option key={i} value={p.name}>{p.name || `方案${i + 1}`}</option>)}
                      </select>
                    )}
                  </div>
                  {hasPlans && !selfMode[key] && planName && choice && (
                    <>
                      {block('導師原則配課', principleSubjects, false)}
                      {block('導師選填配課', optionalSubjects, false)}
                      {block('導師專長配課', specialtySubjects, false)}
                    </>
                  )}
                  {inSelf && (
                    <>
                      {block('導師原則配課', principleSubjects, principleEditable,
                        inSelf && !readOnly && !principleUnlocked[key] ? <button onClick={() => setPrincipleUnlocked(m => ({ ...m, [key]: true }))} className="text-zinc-500 underline font-normal">編輯</button> : null)}
                      {block('導師選填配課', optionalSubjects, inSelf && !readOnly)}
                      {block('導師專長配課', specialtySubjects, inSelf && !readOnly)}
                    </>
                  )}

                  <div className="flex items-end justify-between gap-3 pt-1">
                    <div className="text-[11px] text-zinc-400 flex-1">
                      {!inSelf && !readOnly && <>建議直接選用方案；如需調整可<button onClick={() => { setSelfMode(m => ({ ...m, [key]: true })); setChoice(r, c => ({ planName: null, breakdown: { ...(c?.breakdown ?? {}) } })) }} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改為自訂配課</button>。</>}
                      {inSelf && hasPlans && !readOnly && <>自訂配課，各科合計需達 {target} 節。<button onClick={() => { setSelfMode(m => ({ ...m, [key]: false })); setPrincipleUnlocked(m => ({ ...m, [key]: false })); if (usablePlans[0]) setChoice(r, () => ({ planName: usablePlans[0].name, breakdown: { ...usablePlans[0].alloc } })) }} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改選方案</button></>}
                      {inSelf && !hasPlans && <>您的實際授課節數為 {target} 節，與行政方案總數不同，請自行配課使合計達 {target} 節。</>}
                    </div>
                    {(inSelf || planName) && (
                      <div className={`text-lg font-semibold whitespace-nowrap ${sum === target ? 'text-green-600' : 'text-amber-600'}`}>
                        合計 {sum}{sum !== target && <span className="text-xs font-normal"> / 目標 {target}（{sum < target ? '不足' : '超過'} {Math.abs(sum - target)}）</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* 科任 */}
        {picked === 'subject' && (
          <>
            <div className="card p-4 flex items-center gap-6 flex-wrap text-sm">
              <span className="text-zinc-600">實際授課節數 <span className="text-xl font-semibold text-zinc-900">{subjectTarget}</span></span>
            </div>
            <div className="card p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">授課科目（可複選）</div>
              <div className="flex flex-wrap gap-2">
                {allSubjects.map(s => (
                  <label key={s} className={`flex items-center gap-1 px-2 py-1 border rounded-sm text-xs cursor-pointer ${subjects.includes(s) ? 'border-zinc-500 bg-zinc-100' : 'border-zinc-200'}`}>
                    <input type="checkbox" checked={subjects.includes(s)} disabled={readOnly} onChange={() => toggleSubject(s)} className="w-3.5 h-3.5" />{s}
                  </label>
                ))}
              </div>
            </div>
            {subjects.length > 0 && (
              <div className="card p-0 overflow-x-auto">
                <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">各科各年級授課節數</div>
                <table className="table-base mt-2">
                  <thead><tr><th>科目</th>{GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}<th className="text-center">小計</th></tr></thead>
                  <tbody>
                    {subjects.map(subj => {
                      const rowSum = GRADES.reduce((a, g) => a + (Number(sgh[subj]?.[String(g)]) || 0), 0)
                      return (
                        <tr key={subj}>
                          <td className="font-medium">{subj}</td>
                          {GRADES.map(g => <td key={g} className="text-center"><NumberInput min={0} value={Number(sgh[subj]?.[String(g)]) || 0} disabled={readOnly} onChange={n => setHour(subj, g, n)} className="input w-11 text-center py-0.5 text-xs" /></td>)}
                          <td className="text-center text-zinc-500">{rowSum}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className={`text-xs px-4 py-2 ${subjectSum === subjectTarget ? 'text-green-600' : 'text-amber-600'}`}>合計 {subjectSum}{subjectSum !== subjectTarget && ` / 實際授課節數 ${subjectTarget}（${subjectSum < subjectTarget ? '不足' : '超過'} ${Math.abs(subjectSum - subjectTarget)}）`}</p>
              </div>
            )}
          </>
        )}
      </>}

      {/* ════ 第二頁：減超鐘點申請 ════ */}
      {step === 2 && <>
        {/* 一、專案減課 */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-700">一、專案減課</h3>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-500">基本資料</div>
            {projects.length === 0 && <p className="text-xs text-zinc-400">如有專案減課，請按「＋ 新增專案」填寫。</p>}
            {projects.map((p, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                <input value={p.name} disabled={readOnly} onChange={e => setProject(i, { name: e.target.value })} placeholder="專案名稱" className="input flex-1 min-w-[8rem] py-0.5 text-sm" />
                <label className="flex items-center gap-1 text-xs text-zinc-600">減課數<NumberInput min={0} value={p.hours} disabled={readOnly} onChange={n => setProject(i, { hours: n })} className="input w-14 text-center py-0.5" /></label>
                {!readOnly && <button onClick={() => removeProject(i)} className="text-zinc-400 hover:text-red-500 text-xs">刪除</button>}
              </div>
            ))}
            {!readOnly && <button onClick={addProject} className="btn-secondary text-xs">＋ 新增專案</button>}
          </div>
          {projects.some(p => p.hours > 0) && (
            <div className="space-y-2 pt-1">
              <div className="text-xs font-semibold text-zinc-500">減課順序</div>
              <p className="text-[11px] text-zinc-400">指定希望優先減課的科目（僅列非 0 節的選填／專長科目）：</p>
              <div className="flex flex-wrap gap-3">
                {[0, 1, 2].map(i => (
                  <label key={i} className="flex items-center gap-1.5 text-sm"><span className="text-zinc-600 text-xs">順序{['一', '二', '三'][i]}</span>
                    <select value={projectOrder[i] ?? ''} disabled={readOnly} onChange={e => setProjOrder(i, e.target.value)} className="input py-1 text-sm w-32">
                      <option value="">不指定</option>
                      {reduceOptions.filter(s => !projectOrder.includes(s) || projectOrder[i] === s).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {reduceOptions.length === 0 && <p className="text-[11px] text-zinc-400">您目前的配課沒有可減的選填／專長科目。</p>}
            </div>
          )}
          <p className="text-[11px] text-zinc-400">專案減課為申請項目，實際減課數由管理者審核核定，不影響上一頁的配課節數。</p>
        </div>

        {/* 二、超鐘意願 */}
        <div className="card p-4 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700">二、超鐘意願</h3>
          <label className="flex items-center gap-2 text-sm"><span className="text-zinc-700">願意超鐘點節數</span>
            <NumberInput min={0} value={overtimeHours} disabled={readOnly} onChange={setOvertimeHours} className="input w-16 text-center py-0.5" /></label>
          {overtimeHours > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">超鐘順序（願意支援的科目，依優先順序；列出全部專長科目與您有配課的選填科目）：</p>
              <div className="flex flex-wrap gap-3">
                {[0, 1, 2].map(i => (
                  <label key={i} className="flex items-center gap-1.5 text-sm"><span className="text-zinc-600 text-xs">順序{['一', '二', '三'][i]}</span>
                    <select value={overtimeOrder[i] ?? ''} disabled={readOnly} onChange={e => setOrder(i, e.target.value)} className="input py-1 text-sm w-32">
                      <option value="">不指定</option>
                      {overtimeOptions.filter(s => !overtimeOrder.includes(s) || overtimeOrder[i] === s).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {overtimeOptions.length === 0 && <p className="text-[11px] text-zinc-400">您目前的配課沒有可支援的選填／專長科目。</p>}
            </div>
          )}
          <p className="text-[11px] text-zinc-400">超鐘意願供課務組事後安排參考，不影響上一頁的配課節數。</p>
        </div>
      </>}

      {!readOnly && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {step === 1 && <button onClick={goNext} className="btn-primary text-sm">下一步</button>}
          {step === 2 && <>
            <button onClick={() => setStep(1)} className="btn-secondary text-sm">上一步</button>
            <button onClick={() => setConfirmModalOpen(true)} className="btn-primary text-sm">送出並鎖定</button>
          </>}
        </div>
      )}

      {reasonModalOpen && (
        <ReasonCertModal needPrinciple={wantPrinciple} needSpecialty={wantSpecialty} certSubjects={certSubjects}
          initial={{ principleReason, specialtyReason }} onCancel={() => setReasonModalOpen(false)} onDone={onReasonDone} />
      )}
      {confirmModalOpen && <ConfirmNotesModal onCancel={() => setConfirmModalOpen(false)} onConfirm={onConfirm} />}
    </div>
  )
}
