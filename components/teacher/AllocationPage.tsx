'use client'

import { useState, useEffect, useRef } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  REDUCTION_LABEL, GRADE_LABEL,
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

const SELF = '__self__'

export function AllocationPage({ year, role, work, grade, roleLabel, base, homeroom, closed, initial }: Props) {
  const [projectReduction, setProjectReduction] = useState(initial.projectReduction ?? 0)
  const [extraHours, setExtraHours] = useState(initial.extraHours ?? 0)
  const [scenarios, setScenarios] = useState<Record<string, ScenarioChoice>>(initial.scenarios ?? {})
  const [locked, setLocked] = useState(initial.locked ?? false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const readOnly = locked || closed

  function buildData(lock: boolean): TeacherAllocation {
    return {
      role, work, grade, projectReduction, extraHours, scenarios,
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
  }, [projectReduction, extraHours, scenarios])

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
      }
      if (issues.length) { setError('無法送出：\n' + issues.join('\n')); return }
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
          <label className="flex items-center gap-2"><span className="text-zinc-700">專案減課</span>
            <NumberInput min={0} value={projectReduction} disabled={readOnly}
              onChange={setProjectReduction} className="input w-14 text-center py-0.5" /></label>
          <label className="flex items-center gap-2"><span className="text-zinc-700">自願超鐘點</span>
            <NumberInput min={0} value={extraHours} disabled={readOnly}
              onChange={setExtraHours} className="input w-14 text-center py-0.5" /></label>
        </div>
        <p className="text-[11px] text-zinc-400 mt-2">實際授課節數 = 基本授課節數 − 減課節數（情境） − 專案減課 + 自願超鐘點</p>
      </div>

      {/* 科任 / 行政：只算節數（無減課） */}
      {(role === 'subject' || role === 'admin') && (
        <div className="card p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-zinc-600">實際授課節數</span>
            <span className="text-2xl font-semibold text-zinc-900">{actual(0)}</span>
            <span className="text-xs text-zinc-400">= 基本 {base ?? 0} − 專案減課 {projectReduction} + 自願超鐘點 {extraHours}</span>
          </div>
        </div>
      )}

      {/* 導師：各情境選方案或自配 */}
      {role === 'homeroom' && homeroom && (
        homeroom.scenarios.length === 0
          ? <div className="card text-sm text-zinc-400">管理者尚未為 {GRADE_LABEL[homeroom.grade]} 啟用任何情境，請稍後再填或洽管理員。</div>
          : homeroom.scenarios.map(sc => {
              const target = actual(sc.reduction)
              const choice = scenarios[String(sc.reduction)]
              const selValue = !choice ? '' : (choice.planName ?? SELF)
              const isSelf = choice?.planName === null && !!choice
              const sum = choice ? Object.values(choice.breakdown).reduce((s, n) => s + (Number(n) || 0), 0) : 0
              return (
                <div key={sc.reduction} className="card p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-zinc-700">{REDUCTION_LABEL[sc.reduction as 0 | 1 | 2]}
                      <span className="ml-2 text-xs font-normal text-zinc-500">目標實際授課節數 {target}</span>
                    </h3>
                    <select className="input py-1 text-sm w-44" value={selValue} disabled={readOnly}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '') { setScenarios(prev => { const n = { ...prev }; delete n[String(sc.reduction)]; return n }) }
                        else if (v === SELF) setChoice(sc.reduction, c => ({ planName: null, breakdown: c.breakdown ?? {} }))
                        else {
                          const plan = sc.plans.find(p => p.name === v)
                          setChoice(sc.reduction, () => ({ planName: v, breakdown: { ...(plan?.alloc ?? {}) } }))
                        }
                      }}>
                      <option value="">請選擇</option>
                      {sc.plans.map((p, i) => <option key={i} value={p.name}>{p.name || `方案${i + 1}`}</option>)}
                      <option value={SELF}>自配</option>
                    </select>
                  </div>

                  {choice && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                        {homeroom.subjects.map((subj, si) => (
                          <div key={si} className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-600 flex-1 truncate">{subj}</span>
                            {isSelf
                              ? <NumberInput min={0} value={choice.breakdown[subj] ?? 0} disabled={readOnly}
                                  onChange={n => setChoice(sc.reduction, c => ({ ...c, breakdown: { ...c.breakdown, [subj]: n } }))}
                                  className="input w-12 text-center py-0.5 text-xs" />
                              : <span className="w-12 text-center text-xs font-medium text-zinc-800">{choice.breakdown[subj] ?? 0}</span>}
                          </div>
                        ))}
                      </div>
                      <p className={`text-xs ${sum === target ? 'text-green-600' : 'text-amber-600'}`}>
                        合計 {sum}{sum !== target && ` / 目標 ${target}（${sum < target ? '不足' : '超過'} ${Math.abs(sum - target)}）`}
                      </p>
                    </>
                  )}
                </div>
              )
            })
      )}
    </div>
  )
}
