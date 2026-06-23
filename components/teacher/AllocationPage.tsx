'use client'

import { useState, useEffect, useRef } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  REDUCTION_LABEL, GRADE_LABEL, GRADES, planTotal,
  type AllocRole, type TeacherAllocation, type ScenarioChoice,
} from '@/lib/allocation'
import type { HomeroomCtx } from '@/app/teacher/allocation/page'

interface Props {
  year: number
  role: AllocRole
  work: string
  grade: number | null
  roleLabel: string
  base: number | null
  homeroom: HomeroomCtx | null
  closed: boolean
  initial: TeacherAllocation
}

export function AllocationPage({ year, role, work, grade, roleLabel, base, homeroom, closed, initial }: Props) {
  const projectReduction = initial.projectReduction ?? 0  // 由管理者設定，教師端唯讀
  const [extraHours, setExtraHours] = useState(initial.extraHours ?? 0)
  // A. 預設選方案：只要目標對得上方案，一律預設方案（即使先前存的是自配，也回到方案）
  const [scenarios, setScenarios] = useState<Record<string, ScenarioChoice>>(() => {
    const s: Record<string, ScenarioChoice> = { ...(initial.scenarios ?? {}) }
    const ro = (initial.locked ?? false) || closed
    if (homeroom && !ro) {
      for (const sc of homeroom.scenarios) {
        const k = String(sc.reduction)
        const tgt = (base ?? 0) - sc.reduction - projectReduction + (initial.extraHours ?? 0)
        const usable = sc.plans.filter(p => planTotal(p) === tgt)
        const cur = s[k]
        const curIsUsablePlan = !!cur?.planName && usable.some(p => p.name === cur.planName)
        if (usable.length > 0 && !curIsUsablePlan) s[k] = { planName: usable[0].name, breakdown: { ...usable[0].alloc } }
      }
    }
    return s
  })
  // 自配為當下狀態（非從儲存推導）：唯有按「改為自訂」才進自配
  const [selfMode, setSelfMode] = useState<Record<string, boolean>>({})
  const [gradeHours, setGradeHours] = useState<Record<string, number>>(initial.gradeHours ?? {})  // 正式科任：各年級節數（單一領域）
  const [locked, setLocked] = useState(initial.locked ?? false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const readOnly = locked || closed

  function buildData(lock: boolean): TeacherAllocation {
    return {
      role, work, grade, projectReduction, extraHours, scenarios, gradeHours,
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
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message ?? '儲存失敗'); setSaveStatus('idle'); return false
      }
      setSaveStatus('saved'); setError(null); return true
    } catch {
      setSaveStatus('idle'); setError('儲存失敗'); return false
    }
  }

  // 自動儲存草稿（鎖定/截止後不存）
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (readOnly) return
    setSaveStatus('saving')
    const t = setTimeout(() => { void put(false) }, 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectReduction, extraHours, scenarios, gradeHours])

  // 實際授課節數（某情境）
  const actual = (reduction: number) => (base ?? 0) - reduction - projectReduction + extraHours

  function setChoice(r: number, fn: (c: ScenarioChoice) => ScenarioChoice) {
    const key = String(r)
    setScenarios(prev => ({ ...prev, [key]: fn(prev[key] ?? { planName: null, breakdown: {} }) }))
  }

  async function submit() {
    setError(null)
    // 導師：每個啟用情境都要選好且總節數=目標
    if (role === 'homeroom' && homeroom) {
      const issues: string[] = []
      for (const sc of homeroom.scenarios) {
        const choice = scenarios[String(sc.reduction)]
        const target = actual(sc.reduction)
        if (!choice || (choice.planName === null && Object.keys(choice.breakdown).length === 0)) {
          issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：尚未選擇方案或自配`)
          continue
        }
        const sum = Object.values(choice.breakdown).reduce((s, n) => s + (Number(n) || 0), 0)
        if (sum !== target) issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：總節數 ${sum} ≠ 目標 ${target}`)
        // 有相符方案卻仍自配 → 需填理由；若無相符方案（被迫自配）則不需
        const hasPlans = sc.plans.some(p => planTotal(p) === target)
        if (choice.planName === null && hasPlans && !(choice.reason ?? '').trim()) issues.push(`${REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}：自訂配課需填寫理由`)
      }
      if (issues.length) { setError('無法送出：\n' + issues.join('\n')); return }
    }
    if (role === 'subject') {
      const tgt = actual(0)
      const sum = GRADES.reduce((s, g) => s + (Number(gradeHours[String(g)]) || 0), 0)
      if (sum !== tgt) { setError(`各年級授課節數合計 ${sum} ≠ 實際授課節數 ${tgt}（${sum < tgt ? '不足' : '超過'} ${Math.abs(sum - tgt)}）。如需多授課請增加自願超鐘點。`); return }
    }
    if (!confirm('送出後將鎖定，無法自行修改（需洽管理員）。確定送出？')) return
    if (await put(true)) setLocked(true)
  }

  // ── 無需配課 ──
  if (role === 'none') {
    return (
      <div className="space-y-5 max-w-3xl">
        <h2 className="page-title">配課選填</h2>
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">您 {year} 學年度無需配課</span>
            ——尚未有本年度工作紀錄，或屬留停／借調等狀態。如有疑問請洽管理員。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課選填 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span></h2>
          <p className="text-xs text-zinc-500">
            身分：<span className="font-medium text-zinc-700">{roleLabel}</span>
            {role === 'homeroom' && grade && <span className="ml-1">· {GRADE_LABEL[grade]}（系統判定）</span>}
            <span className="ml-1 text-zinc-400">· 工作：{work}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
          {saveStatus === 'saved' && !readOnly && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
          {!readOnly && <button onClick={submit} className="btn-primary text-sm">送出並鎖定</button>}
        </div>
      </div>

      {closed && (
        <div className="card border-amber-200 bg-amber-50"><p className="text-sm text-amber-800"><span className="font-semibold">📋 配課填報已截止</span>——目前唯讀。</p></div>
      )}
      {locked && !closed && (
        <div className="card border-zinc-300 bg-zinc-50"><p className="text-sm text-zinc-700"><span className="font-semibold">🔒 您的配課已送出鎖定</span>——如需修改請洽管理員。</p></div>
      )}
      {error && <div className="card border-red-200 bg-red-50"><p className="text-sm text-red-700 whitespace-pre-line">{error}</p></div>}

      {/* 共用：專案減課 / 自願超鐘點 */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">節數調整</div>
        <div className="flex items-center gap-6 flex-wrap text-sm">
          <span className="text-zinc-600">基本授課節數 <span className="font-medium text-zinc-900">{base ?? '—'}</span></span>
          <span className="flex items-center gap-2"><span className="text-zinc-700">專案減課</span>
            <span className="font-medium text-zinc-900 w-10 text-center">{projectReduction}</span>
            <span className="text-[11px] text-zinc-400">(管理者設定)</span></span>
          <label className="flex items-center gap-2"><span className="text-zinc-700">自願超鐘點</span>
            <NumberInput min={0} value={extraHours} disabled={readOnly}
              onChange={setExtraHours} className="input w-14 text-center py-0.5" /></label>
        </div>
        <p className="text-[11px] text-zinc-400 mt-2">實際授課節數 = 基本授課節數 − 減課節數（情境） − 專案減課 + 自願超鐘點</p>
      </div>

      {/* 行政：只算節數（無減課、不配課） */}
      {role === 'admin' && (
        <div className="card p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-zinc-600">實際授課節數</span>
            <span className="text-2xl font-semibold text-zinc-900">{actual(0)}</span>
            <span className="text-xs text-zinc-400">= 基本 {base ?? 0} − 專案減課 {projectReduction} + 自願超鐘點 {extraHours}</span>
          </div>
        </div>
      )}

      {/* 科任：填各年級授課節數（單一領域），合計＝實際授課節數 */}
      {role === 'subject' && (() => {
        const tgt = actual(0)
        const ghSum = GRADES.reduce((s, g) => s + (Number(gradeHours[String(g)]) || 0), 0)
        return (
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-zinc-600">實際授課節數</span>
              <span className="text-xl font-semibold text-zinc-900">{tgt}</span>
              <span className="text-xs text-zinc-400">= 基本 {base ?? 0} − 專案減課 {projectReduction} + 自願超鐘點 {extraHours}</span>
            </div>
            <p className="text-xs text-zinc-500">請填各年級授課節數（合計需等於實際授課節數；要多授課請增加上方自願超鐘點）：</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {GRADES.map(g => (
                <label key={g} className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-600 w-9 flex-shrink-0">{GRADE_LABEL[g]}</span>
                  <NumberInput min={0} value={gradeHours[String(g)] ?? 0} disabled={readOnly}
                    onChange={n => setGradeHours(prev => ({ ...prev, [String(g)]: n }))}
                    className="input w-12 text-center py-0.5 text-xs" />
                </label>
              ))}
            </div>
            <p className={`text-xs ${ghSum === tgt ? 'text-green-600' : 'text-amber-600'}`}>
              合計 {ghSum}{ghSum !== tgt && ` / 實際 ${tgt}（${ghSum < tgt ? '不足' : '超過'} ${Math.abs(ghSum - tgt)}）`}
            </p>
          </div>
        )
      })()}

      {/* 導師：各情境選方案或自配 */}
      {role === 'homeroom' && homeroom && (
        homeroom.scenarios.length === 0
          ? <div className="card text-sm text-zinc-400">管理者尚未為 {GRADE_LABEL[homeroom.grade]} 啟用任何情境，請稍後再填或洽管理員。</div>
          : homeroom.scenarios.map(sc => {
              const r = sc.reduction
              const key = String(r)
              const target = actual(r)
              const choice = scenarios[key]
              const usablePlans = sc.plans.filter(p => planTotal(p) === target)  // 僅總數=目標的方案可用
              const hasPlans = usablePlans.length > 0
              const inSelf = !hasPlans || !!selfMode[key]   // 無相符方案 → 強制自配；否則唯有按鈕進自配
              const planName = (choice?.planName && usablePlans.some(p => p.name === choice.planName)) ? choice.planName : ''
              const sum = choice ? homeroom.subjects.reduce((s, subj) => s + (Number(choice.breakdown[subj]) || 0), 0) : 0

              function pickPlan(v: string) {
                if (v === '') { setScenarios(prev => { const n = { ...prev }; delete n[key]; return n }); return }
                const plan = usablePlans.find(p => p.name === v)
                setChoice(r, () => ({ planName: v, breakdown: { ...(plan?.alloc ?? {}) } }))
              }
              function enterSelf() {
                if (!confirm('自訂配課自由度較大、可能影響全校排課，且需經行政確認。\n建議優先選用行政提供的方案。確定要自訂？')) return
                setSelfMode(m => ({ ...m, [key]: true }))
                setChoice(r, c => ({ planName: null, breakdown: { ...(c?.breakdown ?? {}) }, reason: c?.reason ?? '' }))
              }
              function cancelSelf() {
                setSelfMode(m => ({ ...m, [key]: false }))
                if (usablePlans[0]) setChoice(r, () => ({ planName: usablePlans[0].name, breakdown: { ...usablePlans[0].alloc } }))
                else setScenarios(prev => { const n = { ...prev }; delete n[key]; return n })
              }

              return (
                <div key={r} className="card p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-zinc-700">{REDUCTION_LABEL[r as 0 | 1 | 2]}
                      <span className="ml-2 text-xs font-normal text-zinc-500">目標實際授課節數 {target}</span>
                    </h3>
                    {hasPlans && !selfMode[key] && (
                      <select className="input py-1 text-sm w-48" value={planName} disabled={readOnly} onChange={e => pickPlan(e.target.value)}>
                        <option value="">請選擇方案</option>
                        {usablePlans.map((p, i) => <option key={i} value={p.name}>{p.name || `方案${i + 1}`}</option>)}
                      </select>
                    )}
                  </div>

                  {/* 方案模式：唯讀顯示 */}
                  {hasPlans && !selfMode[key] && planName && choice && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                        {homeroom.subjects.map((subj, si) => (
                          <div key={si} className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span>
                            <span className="w-12 text-center text-xs font-medium text-zinc-800">{choice.breakdown[subj] ?? 0}</span>
                          </div>
                        ))}
                      </div>
                      <p className={`text-xs ${sum === target ? 'text-green-600' : 'text-amber-600'}`}>合計 {sum}{sum !== target && ` / 目標 ${target}`}</p>
                    </>
                  )}

                  {/* 有相符方案、非自配：自訂入口一直可用（即使已選方案） */}
                  {hasPlans && !selfMode[key] && !readOnly && (
                    <p className="text-[11px] text-zinc-400">
                      建議直接選用方案；如需調整可
                      <button onClick={enterSelf} className="ml-1 text-zinc-500 underline hover:text-zinc-700">改為自訂配課</button>。
                    </p>
                  )}

                  {/* 自配模式（被迫或自願） */}
                  {inSelf && (
                    <div className="space-y-2">
                      {hasPlans ? (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1.5">
                          ⚠ 自訂配課自由度大、可能影響全校排課，需經行政確認。如非必要，建議改選行政方案。
                          {!readOnly && <button onClick={cancelSelf} className="ml-2 underline">改選方案</button>}
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-sm px-2 py-1.5">
                          您的實際授課節數為 <strong className="text-zinc-800">{target}</strong> 節（已含專案減課／超鐘點調整），與本情境的行政方案總數不同，因此由您自行配課即可，使各科合計達 {target} 節。
                        </div>
                      )}
                      {hasPlans && (
                        <label className="block text-xs">
                          <span className="text-zinc-600">自訂理由（必填）</span>
                          <input value={choice?.reason ?? ''} disabled={readOnly}
                            onChange={e => setChoice(r, c => ({ ...c, reason: e.target.value }))}
                            className="input py-1 w-full mt-1" placeholder="請說明為何需要自訂配課" />
                        </label>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                        {homeroom.subjects.map((subj, si) => (
                          <div key={si} className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span>
                            <NumberInput min={0} value={choice?.breakdown[subj] ?? 0} disabled={readOnly}
                              onChange={n => setChoice(r, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))}
                              className="input w-12 text-center py-0.5 text-xs" />
                          </div>
                        ))}
                      </div>
                      <p className={`text-xs ${sum === target ? 'text-green-600' : 'text-amber-600'}`}>
                        合計 {sum}{sum !== target && ` / 目標 ${target}（${sum < target ? '不足' : '超過'} ${Math.abs(sum - target)}）`}
                      </p>
                    </div>
                  )}
                </div>
              )
            })
      )}
    </div>
  )
}
