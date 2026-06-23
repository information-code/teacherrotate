'use client'

import { useState, useEffect, useRef } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  REDUCTION_LABEL, GRADE_LABEL, GRADES, planTotal,
  type TeacherAllocation, type ScenarioChoice,
} from '@/lib/allocation'
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
  const projectReduction = initial.projectReduction ?? 0 // 管理者設定，唯讀
  const [picked, setPicked] = useState<Picked>(initial.role === 'homeroom' || initial.role === 'subject' ? initial.role : '')
  const [grade, setGrade] = useState<number | null>(initial.grade ?? null)
  const [extraHours, setExtraHours] = useState(initial.extraHours ?? 0)
  const [scenarios, setScenarios] = useState<Record<string, ScenarioChoice>>(initial.scenarios ?? {})
  const [selfMode, setSelfMode] = useState<Record<string, boolean>>({})  // 自配為當下狀態，非從儲存推導
  const [subjects, setSubjects] = useState<string[]>(initial.subjects ?? [])
  const [sgh, setSgh] = useState<Record<string, Record<string, number>>>(initial.subjectGradeHours ?? {})
  const [locked, setLocked] = useState(initial.locked ?? false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const readOnly = locked || closed

  function buildData(lock: boolean): TeacherAllocation {
    return {
      role: picked || 'none',
      work: picked === 'homeroom' ? '代理導師' : picked === 'subject' ? '代理科任' : '',
      grade: picked === 'homeroom' ? grade : null,
      projectReduction, extraHours,
      scenarios: picked === 'homeroom' ? scenarios : {},
      subjects: picked === 'subject' ? subjects : [],
      subjectGradeHours: picked === 'subject' ? sgh : {},
      locked: lock,
      submittedAt: lock ? new Date().toISOString() : (initial.submittedAt ?? null),
    }
  }
  async function put(lock: boolean): Promise<boolean> {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/teacher/allocation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: buildData(lock) }),
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
  }, [picked, grade, extraHours, scenarios, subjects, sgh])

  function setChoice(r: number, fn: (c: ScenarioChoice) => ScenarioChoice) {
    setScenarios(prev => ({ ...prev, [String(r)]: fn(prev[String(r)] ?? { planName: null, breakdown: {} }) }))
  }
  function toggleSubject(s: string) {
    setSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }
  function setHour(subj: string, g: number, n: number) {
    setSgh(prev => ({ ...prev, [subj]: { ...(prev[subj] ?? {}), [String(g)]: n } }))
  }

  const subjectTarget = subjectBase - projectReduction + extraHours
  const subjectSum = subjects.reduce((s, subj) => s + GRADES.reduce((a, g) => a + (Number(sgh[subj]?.[String(g)]) || 0), 0), 0)

  async function submit() {
    setError(null)
    if (!picked) { setError('請先選擇身分（導師／科任）'); return }
    if (picked === 'homeroom') {
      if (!grade) { setError('請選擇年級'); return }
      const gc = grades[grade]
      const issues: string[] = []
      for (const sc of gc.scenarios) {
        const target = gc.homeroomBase - sc.reduction - projectReduction + extraHours
        const choice = scenarios[String(sc.reduction)]
        if (!choice || (choice.planName === null && Object.keys(choice.breakdown).length === 0)) { issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：尚未選方案或自配`); continue }
        const sum = Object.values(choice.breakdown).reduce((s, n) => s + (Number(n) || 0), 0)
        if (sum !== target) issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：合計 ${sum} ≠ 目標 ${target}`)
      }
      if (issues.length) { setError('無法送出：\n' + issues.join('\n')); return }
    }
    if (picked === 'subject') {
      if (subjects.length === 0) { setError('請至少選一個授課科目'); return }
      if (subjectSum !== subjectTarget) { setError(`各科各年級節數合計 ${subjectSum} ≠ 實際授課節數 ${subjectTarget}（${subjectSum < subjectTarget ? '不足' : '超過'} ${Math.abs(subjectSum - subjectTarget)}）。要多授課請增加自願超鐘點。`); return }
    }
    if (!confirm('送出後將鎖定，無法自行修改（需洽管理員）。確定送出？')) return
    if (await put(true)) setLocked(true)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課選填 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度 · 代理教師</span></h2>
          <p className="text-xs text-zinc-500">請先選擇您的身分,再依畫面填寫配課。</p>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
          {saveStatus === 'saved' && !readOnly && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
          {!readOnly && <button onClick={submit} className="btn-primary text-sm">送出並鎖定</button>}
        </div>
      </div>

      {closed && <div className="card border-amber-200 bg-amber-50"><p className="text-sm text-amber-800"><span className="font-semibold">📋 配課填報已截止</span>——目前唯讀。</p></div>}
      {locked && !closed && <div className="card border-zinc-300 bg-zinc-50"><p className="text-sm text-zinc-700"><span className="font-semibold">🔒 已送出鎖定</span>——如需修改請洽管理員。</p></div>}
      {error && <div className="card border-red-200 bg-red-50"><p className="text-sm text-red-700 whitespace-pre-line">{error}</p></div>}

      {/* 身分選擇 */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">身分</div>
        <div className="flex gap-2">
          {([['homeroom', '導師'], ['subject', '科任']] as const).map(([v, label]) => (
            <button key={v} disabled={readOnly}
              onClick={() => setPicked(v)}
              className={`px-4 py-1.5 text-sm rounded-sm border ${picked === v ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
              {label}
            </button>
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
            <span className="flex items-center gap-2"><span className="text-zinc-700">專案減課</span><span className="font-medium w-8 text-center">{projectReduction}</span><span className="text-[11px] text-zinc-400">(管理者設定)</span></span>
            <label className="flex items-center gap-2"><span className="text-zinc-700">自願超鐘點</span>
              <NumberInput min={0} value={extraHours} disabled={readOnly} onChange={setExtraHours} className="input w-14 text-center py-0.5" /></label>
          </div>

          {grade && grades[grade].scenarios.length === 0 && <div className="card text-sm text-zinc-400">管理者尚未為 {GRADE_LABEL[grade]} 啟用情境。</div>}
          {grade && grades[grade].scenarios.map(sc => {
            const gc = grades[grade]
            const r = sc.reduction
            const key = String(r)
            const target = gc.homeroomBase - r - projectReduction + extraHours
            const choice = scenarios[key]
            const usablePlans = sc.plans.filter(p => planTotal(p) === target)
            const hasPlans = usablePlans.length > 0
            const inSelf = !hasPlans || !!selfMode[key]
            const planName = (choice?.planName && usablePlans.some(p => p.name === choice.planName)) ? choice.planName : ''
            const sum = choice ? gc.subjects.reduce((s, subj) => s + (Number(choice.breakdown[subj]) || 0), 0) : 0
            return (
              <div key={r} className="card p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-semibold text-zinc-700">{REDUCTION_LABEL[r as 0 | 1 | 2]}<span className="ml-2 text-xs font-normal text-zinc-500">目標 {target}</span></h3>
                  {hasPlans && !selfMode[key] && (
                    <select className="input py-1 text-sm w-48" value={planName} disabled={readOnly}
                      onChange={e => { const v = e.target.value; if (!v) { setScenarios(p => { const n = { ...p }; delete n[key]; return n }) } else { const pl = usablePlans.find(p => p.name === v); setChoice(r, () => ({ planName: v, breakdown: { ...(pl?.alloc ?? {}) } })) } }}>
                      <option value="">請選擇方案</option>
                      {usablePlans.map((p, i) => <option key={i} value={p.name}>{p.name || `方案${i + 1}`}</option>)}
                    </select>
                  )}
                </div>
                {hasPlans && !selfMode[key] && planName && choice && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                      {gc.subjects.map((subj, si) => <div key={si} className="flex items-center gap-1.5"><span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span><span className="w-12 text-center text-xs font-medium text-zinc-800">{choice.breakdown[subj] ?? 0}</span></div>)}
                    </div>
                    <p className={`text-xs ${sum === target ? 'text-green-600' : 'text-amber-600'}`}>合計 {sum}{sum !== target && ` / 目標 ${target}`}</p>
                  </>
                )}
                {hasPlans && !selfMode[key] && !readOnly && (
                  <p className="text-[11px] text-zinc-400">建議直接選用方案；如需調整可<button onClick={() => { setSelfMode(m => ({ ...m, [key]: true })); setChoice(r, c => ({ planName: null, breakdown: { ...(c?.breakdown ?? {}) } })) }} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改為自訂配課</button>。</p>
                )}
                {inSelf && (
                  <div className="space-y-2">
                    <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-sm px-2 py-1.5">
                      {hasPlans ? <>自訂配課,合計需達 {target}。{!readOnly && <button onClick={() => { setSelfMode(m => ({ ...m, [key]: false })); if (usablePlans[0]) setChoice(r, () => ({ planName: usablePlans[0].name, breakdown: { ...usablePlans[0].alloc } })) }} className="ml-2 underline">改選方案</button>}</> : <>無相符方案(目標 {target}),請自行配課使合計達 {target}。</>}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                      {gc.subjects.map((subj, si) => <div key={si} className="flex items-center gap-1.5"><span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span><NumberInput min={0} value={choice?.breakdown[subj] ?? 0} disabled={readOnly} onChange={n => setChoice(r, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))} className="input w-12 text-center py-0.5 text-xs" /></div>)}
                    </div>
                    <p className={`text-xs ${sum === target ? 'text-green-600' : 'text-amber-600'}`}>合計 {sum}{sum !== target && ` / 目標 ${target}（${sum < target ? '不足' : '超過'} ${Math.abs(sum - target)}）`}</p>
                  </div>
                )}
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
            <span className="text-xs text-zinc-400">= 基本 {subjectBase} − 專案減課 {projectReduction} + 自願超鐘點 {extraHours}</span>
            <label className="flex items-center gap-2"><span className="text-zinc-700">自願超鐘點</span>
              <NumberInput min={0} value={extraHours} disabled={readOnly} onChange={setExtraHours} className="input w-14 text-center py-0.5" /></label>
          </div>

          <div className="card p-4 space-y-2">
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">授課科目（可複選）</div>
            <div className="flex flex-wrap gap-2">
              {allSubjects.map(s => (
                <label key={s} className={`flex items-center gap-1 px-2 py-1 border rounded-sm text-xs cursor-pointer ${subjects.includes(s) ? 'border-zinc-500 bg-zinc-100' : 'border-zinc-200'}`}>
                  <input type="checkbox" checked={subjects.includes(s)} disabled={readOnly} onChange={() => toggleSubject(s)} className="w-3.5 h-3.5" />
                  {s}
                </label>
              ))}
            </div>
          </div>

          {subjects.length > 0 && (
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">各科各年級授課節數（跨年級/跨科）</div>
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
    </div>
  )
}
