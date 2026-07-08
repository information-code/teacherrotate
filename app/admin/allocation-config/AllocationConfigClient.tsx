'use client'

import { useState } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  GRADES, GRADE_LABEL, REDUCTIONS, REDUCTION_LABEL, ADMIN_KIND_LABEL,
  gradeDemand, planTotal, sortSubjects, type AllocationConfig, type GradeConfig, type GradeScenario, type AllocationPlan, type Reduction,
} from '@/lib/allocation'
import { NATIVE_LANGS } from '@/lib/scheduling'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'

interface Props {
  year: number
  initialConfig: AllocationConfig
}

export default function AllocationConfigClient({ year, initialConfig }: Props) {
  // 載入時依課綱順序排序各年級科目（編輯中不重排；新增的科目排在最後）
  const [config, setConfig] = useState<AllocationConfig>(() => {
    const grades: Record<number, GradeConfig> = {}
    for (const k of Object.keys(initialConfig.grades)) {
      const gn = Number(k)
      grades[gn] = { ...initialConfig.grades[gn], subjects: sortSubjects(initialConfig.grades[gn].subjects) }
    }
    return { ...initialConfig, grades }
  })
  const [grade, setGrade] = useState<number>(1)
  const [extraView, setExtraView] = useState(false)   // 「其他」分頁：語別課程（總節數制）
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // 尚未儲存（或儲存中）離開頁面要確認
  useUnsavedGuard(dirty || saveStatus === 'saving')

  const g = config.grades[grade]

  function patchGrade(gr: number, fn: (g: GradeConfig) => GradeConfig) {
    setConfig(c => ({ ...c, grades: { ...c.grades, [gr]: fn(c.grades[gr]) } }))
    setDirty(true)
  }
  function patchScenario(gr: number, r: Reduction, fn: (s: GradeScenario) => GradeScenario) {
    patchGrade(gr, gc => ({ ...gc, scenarios: { ...gc.scenarios, [r]: fn(gc.scenarios[r]) } }))
  }
  function patchPlan(gr: number, r: Reduction, idx: number, fn: (p: AllocationPlan) => AllocationPlan) {
    patchScenario(gr, r, sc => ({ ...sc, plans: sc.plans.map((p, i) => (i === idx ? fn(p) : p)) }))
  }

  async function save() {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/admin/allocation-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, config }),
      })
      if (res.ok) { setSaveStatus('saved'); setDirty(false) } else { setSaveStatus('idle'); alert('儲存失敗，請稍後再試') }
    } catch {
      setSaveStatus('idle'); alert('儲存失敗，請稍後再試')
    }
  }

  const demand = gradeDemand(g)

  return (
    <div className="space-y-5">
      {/* 標題列 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課設定 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span></h2>
          <p className="text-xs text-zinc-400">設定各年級基本授課節數、各領域需求節數，以及各情境（減課版本）的行政配課方案。</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveStatus === 'saved' && !dirty && <span className="text-xs text-green-600">✓ 已儲存</span>}
          {dirty && <span className="text-xs text-amber-600">尚未儲存</span>}
          <button onClick={save} disabled={saveStatus === 'saving'} className="btn-primary text-sm">
            {saveStatus === 'saving' ? '儲存中…' : '儲存設定'}
          </button>
        </div>
      </div>

      {/* 全域：科任 / 行政 基本授課節數 */}
      <div className="card p-4">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">基本授課節數（全校）</div>
        <div className="flex items-center gap-6 flex-wrap text-sm">
          <label className="flex items-center gap-2">
            <span className="text-zinc-700">科任基本節數</span>
            <NumberInput min={0} value={config.subjectBase}
              onChange={n => { setConfig(c => ({ ...c, subjectBase: n })); setDirty(true) }}
              className="input w-16 text-center py-0.5" />
          </label>
          <span className="text-zinc-700">行政基本節數</span>
          {(['principal', 'director', 'chief'] as const).map(k => (
            <label key={k} className="flex items-center gap-1.5">
              <span className="text-zinc-500 text-xs">{ADMIN_KIND_LABEL[k]}</span>
              <NumberInput min={0} value={config.adminBase[k]}
                onChange={n => { setConfig(c => ({ ...c, adminBase: { ...c.adminBase, [k]: n } })); setDirty(true) }}
                className="input w-14 text-center py-0.5" />
            </label>
          ))}
          <span className="text-[11px] text-zinc-400 w-full">導師基本節數於下方各年級分別設定</span>
        </div>
      </div>

      {/* 年級分頁＋其他 */}
      <div className="flex gap-1 flex-wrap">
        {GRADES.map(gr => (
          <button key={gr} onClick={() => { setGrade(gr); setExtraView(false) }}
            className={`px-3 py-1.5 text-sm rounded-sm border ${!extraView && grade === gr ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
            {GRADE_LABEL[gr]}
          </button>
        ))}
        <button onClick={() => setExtraView(true)}
          className={`px-3 py-1.5 text-sm rounded-sm border ${extraView ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
          其他
        </button>
      </div>

      {/* ── 其他課程（本土語語別課）：需求以總節數計，不綁班級數 ── */}
      {extraView && (
        <div className="card p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">其他課程（本土語語別課）</h3>
            <p className="text-xs text-zinc-400 mt-1">
              閩南語＝各年級的「本土語」科目（計入班級需求），不在此設定。
              其他語別（客語、手語、原民語…）需求以<b>總節數</b>計；老師於配課統計按年級配課，
              配不滿的差額由管理者建立虛擬帳號補足（假設全實體，課表生成後再依實際情況改直播／取消）。
            </p>
          </div>
          {config.extraCourses.length === 0 && <p className="text-xs text-zinc-400">尚無其他課程。</p>}
          {config.extraCourses.map((c, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <select value={c.lang}
                onChange={e => { const lang = e.target.value; setConfig(cf => ({ ...cf, extraCourses: cf.extraCourses.map((x, idx) => idx === i ? { ...x, lang, name: x.name && x.name !== x.lang ? x.name : lang } : x) })); setDirty(true) }}
                className="input py-1 text-sm w-36">
                <option value="">選語別…</option>
                {NATIVE_LANGS.filter(l => l !== '閩南語').map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <input value={c.name}
                onChange={e => { const name = e.target.value; setConfig(cf => ({ ...cf, extraCourses: cf.extraCourses.map((x, idx) => idx === i ? { ...x, name } : x) })); setDirty(true) }}
                placeholder="課程名稱（可自訂，如 原住民族語（阿美））" className="input py-1 text-sm flex-1 min-w-48" />
              <label className="flex items-center gap-1 text-sm text-zinc-600">
                需求總節數
                <NumberInput min={0} value={c.totalHours}
                  onChange={n => { setConfig(cf => ({ ...cf, extraCourses: cf.extraCourses.map((x, idx) => idx === i ? { ...x, totalHours: n } : x) })); setDirty(true) }}
                  className="input w-16 text-center py-0.5" />
              </label>
              <button onClick={() => { setConfig(cf => ({ ...cf, extraCourses: cf.extraCourses.filter((_, idx) => idx !== i) })); setDirty(true) }}
                className="text-xs text-red-400 hover:text-red-600">刪除</button>
            </div>
          ))}
          <button onClick={() => { setConfig(cf => ({ ...cf, extraCourses: [...cf.extraCourses, { name: '', lang: '', totalHours: 0 }] })); setDirty(true) }}
            className="btn-secondary text-xs">＋ 新增語別課程</button>
        </div>
      )}

      {/* ── Setting 1：基本 / 需求 ── */}
      <div className="card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700">設定一 — {GRADE_LABEL[grade]} 基本授課節數與需求</h3>
        <div className="flex items-center gap-6 flex-wrap text-sm">
          <label className="flex items-center gap-2">
            <span className="text-zinc-700">班級數</span>
            <NumberInput min={0} value={g.classCount}
              onChange={n => patchGrade(grade, gc => ({ ...gc, classCount: n }))}
              className="input w-16 text-center py-0.5" />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-zinc-700">導師基本授課節數</span>
            <NumberInput min={0} value={g.homeroomBase}
              onChange={n => patchGrade(grade, gc => ({ ...gc, homeroomBase: n }))}
              className="input w-16 text-center py-0.5" />
          </label>
        </div>

        <div className="card p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th>科目 / 領域</th>
                <th className="text-center w-28">每班基本節數</th>
                <th className="text-center w-32">需求總節數<br /><span className="font-normal text-[10px] text-zinc-400">班級數 × 每班節數</span></th>
                <th className="text-center w-24">導師配課<br /><span className="font-normal text-[10px] text-zinc-400">取消＝不出現在<br />老師配課選填</span></th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {g.subjects.map((s, i) => (
                <tr key={i}>
                  <td>
                    <input value={s.name}
                      onChange={e => patchGrade(grade, gc => ({ ...gc, subjects: gc.subjects.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                      className="input py-1" placeholder="科目名稱" />
                  </td>
                  <td className="text-center">
                    <NumberInput min={0} value={s.perClass}
                      onChange={n => patchGrade(grade, gc => ({ ...gc, subjects: gc.subjects.map((x, j) => j === i ? { ...x, perClass: n } : x) }))}
                      className="input w-16 text-center py-1" />
                  </td>
                  <td className="text-center font-medium text-zinc-800">{g.classCount * s.perClass}</td>
                  <td className="text-center">
                    <input type="checkbox" checked={s.homeroom}
                      onChange={e => patchGrade(grade, gc => ({ ...gc, subjects: gc.subjects.map((x, j) => j === i ? { ...x, homeroom: e.target.checked } : x) }))}
                      className="w-4 h-4" />
                  </td>
                  <td>
                    <button onClick={() => patchGrade(grade, gc => ({ ...gc, subjects: gc.subjects.filter((_, j) => j !== i) }))}
                      className="btn-danger text-xs py-0.5 px-1.5">刪除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => patchGrade(grade, gc => ({ ...gc, subjects: [...gc.subjects, { name: '', perClass: 0, homeroom: true }] }))}
          className="btn-secondary text-xs">+ 新增科目</button>
      </div>

      {/* ── Setting 2：情境 / 方案 ── */}
      <div className="card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700">設定二 — {GRADE_LABEL[grade]} 各情境的行政配課方案</h3>
        {REDUCTIONS.map(r => {
          const sc = g.scenarios[r]
          const target = g.homeroomBase - r  // 標準情況（專案減課0、超鐘點0）的目標總節數
          return (
            <div key={r} className="border border-zinc-200 rounded-sm p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sc.enabled}
                  onChange={e => patchScenario(grade, r, s => ({ ...s, enabled: e.target.checked }))}
                  className="w-4 h-4" />
                <span className="font-medium text-zinc-700">{REDUCTION_LABEL[r]}</span>
                {sc.enabled && <span className="text-xs text-zinc-400">目標總節數 {target}（導師基本 {g.homeroomBase} − 減課 {r}）</span>}
              </label>

              {sc.enabled && (
                <div className="space-y-3 pl-6">
                  {sc.plans.length === 0 && <p className="text-xs text-zinc-400">尚無方案，點下方新增。</p>}
                  {sc.plans.map((plan, pi) => {
                    const tot = planTotal(plan)
                    return (
                      <div key={pi} className="border border-zinc-100 bg-zinc-50/50 rounded-sm p-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <input value={plan.name}
                            onChange={e => patchPlan(grade, r, pi, p => ({ ...p, name: e.target.value }))}
                            className="input py-1 w-40" placeholder={`方案${pi + 1}名稱`} />
                          <span className={`text-xs ${tot === target ? 'text-green-600' : 'text-amber-600'}`}>
                            總節數 {tot}{tot !== target && ` / 目標 ${target}`}
                          </span>
                          <button onClick={() => patchScenario(grade, r, s => ({ ...s, plans: s.plans.filter((_, j) => j !== pi) }))}
                            className="btn-danger text-xs py-0.5 px-1.5 ml-auto">刪除方案</button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
                          {g.subjects.filter(s => s.homeroom).map((s, si) => (
                            <div key={si} className="flex items-center gap-1.5">
                              <span className="text-xs text-zinc-600 flex-1 truncate">{s.name || '（未命名）'}</span>
                              <NumberInput min={0} value={plan.alloc[s.name] ?? 0}
                                onChange={n => patchPlan(grade, r, pi, p => ({ ...p, alloc: { ...p.alloc, [s.name]: n } }))}
                                className="input w-12 text-center py-0.5 text-xs" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  <button onClick={() => patchScenario(grade, r, s => ({ ...s, plans: [...s.plans, { name: '', alloc: {} }] }))}
                    className="btn-secondary text-xs">+ 新增方案</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
