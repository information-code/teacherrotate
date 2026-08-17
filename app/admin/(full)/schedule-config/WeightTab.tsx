'use client'

import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import {
  WEIGHT_LEVELS, WEIGHT_LEVEL_LABEL, defaultScheduleWeights, doubleModeOf, DOUBLE_MODE_LABEL,
  type ScheduleConfig, type ScheduleWeights, type BuiltinRules, type WeightLevel,
  type RuleTemplate, type TemplateRule, type DoubleMode,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL, orderSubjectNames } from '@/lib/allocation'
import type { GradeSubject } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  gradeSubjects: Record<number, GradeSubject[]>
}

const SMART = '智慧探究家：科技創新任務'
const shortName = (s: string) => s === SMART ? '智慧探究' : s

/** 四段權重選鈕（關/低/中/高）。硬性要求一律列為固定硬限制，不提供「必須」。 */
function LevelPicker({ value, onChange, size = 'md' }: { value: WeightLevel; onChange: (l: WeightLevel) => void; size?: 'md' | 'sm' }) {
  return (
    <div className="flex rounded-sm border border-zinc-200 overflow-hidden flex-shrink-0">
      {WEIGHT_LEVELS.map(l => (
        <button key={l} onClick={() => onChange(l)}
          className={`${size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'} ${value === l
            ? l === 'off' ? 'bg-zinc-400 text-white' : 'bg-zinc-700 text-white'
            : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}>
          {WEIGHT_LEVEL_LABEL[l]}
        </button>
      ))}
    </div>
  )
}

/** 下拉多選（顯示摘要，點開勾選）——取代 chip 牆。 */
function MultiSelect<T extends string | number>({ options, labels, selected, onChange, allLabel, width = 'w-44' }: {
  options: T[]; labels?: (v: T) => string; selected: T[]; onChange: (next: T[]) => void; allLabel: string; width?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])
  const lab = (v: T) => labels ? labels(v) : String(v)
  const summary = selected.length === 0 ? allLabel : selected.length <= 3 ? selected.map(lab).join('、') : `${selected.slice(0, 2).map(lab).join('、')}…等 ${selected.length} 項`
  return (
    <div ref={ref} className={`relative ${width}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`input py-0.5 text-xs w-full text-left truncate flex items-center justify-between gap-1 ${selected.length === 0 ? 'text-zinc-400' : ''}`}>
        <span className="truncate">{summary}</span><span className="text-zinc-400 flex-shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-zinc-200 rounded-sm shadow-lg p-2 min-w-full w-56 max-h-64 overflow-y-auto">
          <button type="button" onClick={() => onChange([])} className="text-[11px] text-zinc-500 hover:text-zinc-800 mb-1">{allLabel}（清除）</button>
          <div className="grid grid-cols-2 gap-x-2">
            {options.map(o => (
              <label key={String(o)} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o)}
                  onChange={() => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])} />
                <span className="truncate">{lab(o)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 規則表：依作用對象分組；有參數／子規則者，權重非關閉時內嵌顯示 ──
type ParamKey = 'dailyMax' | 'consecMax' | 'homeroomDailyMax'
type MasterKey = 'avoidPeriods' | 'timePrefer'
type SimpleKey = Exclude<keyof BuiltinRules, ParamKey | MasterKey>
type RuleKey = SimpleKey | ParamKey | MasterKey
interface RuleRow { key: RuleKey; name: string; def: string; desc: string; hasN?: boolean; nHint?: string; master?: RuleTemplate; link?: { href: string; label: string } }
const GROUPS: { title: string; note: string; rows: RuleRow[] }[] = [
  { title: '班級', note: '作用在同一班的科任課落點', rows: [
    { key: 'subjectSpread', name: '同科不隔天', def: '中', desc: '同班同科盡量不排相鄰兩天（同科同日仍為固定硬限制）。114-2 人工課表 48 班有違反、一週 ≥4 節的科目結構上無解，故為權重' },
    { key: 'classCohesion', name: '科任課同日成塊', def: '中', desc: '同班同日（上、下午各自計）科任課與鎖課盡量連成一塊，導師課不被切碎。人工課表 32 班有違反、且與「空堂最多一段」互斥，故為權重' },
    { key: 'avoidPeriods', name: '科目避開節次', def: '中', desc: '指定科目避開某些節次（如體育避午餐前後、考科避第 7 節）。可加多組，各組可再調權重；母開關關閉＝全部不計', master: 'avoidPeriods' },
    { key: 'timePrefer', name: '科目時段偏好', def: '關閉', desc: '指定科目偏好上午或下午。可加多組；母開關關閉＝全部不計', master: 'timePrefer' },
    { key: 'homeroomMorning', name: '上午留白給導師', def: '中', desc: '科任課盡量往下午排，讓導師能把國數等考科排上午（人工課表：上午格 46% 是科任、下午 60%，有偏好但不絕對）' },
    { key: 'homeroomBalance', name: '導師每日負擔平衡', def: '低', desc: '班級的科任課每日平均分布＝導師每天的課量平均' },
    { key: 'homeroomDailyMax', name: '導師每日節數上限', def: '高', hasN: true, nHint: '每班每日留白 ≤ N 格', desc: '避免導師單日上課超過 N 節（低年級科任課少，整天日常態超標屬正常）' },
  ] },
  { title: '科任老師', note: '作用在同一位老師的一週課表', rows: [
    { key: 'dailyMax', name: '每日節數上限', def: '高', hasN: true, nHint: '一天最多 N 節', desc: '114-2 人工課表實測最大值恰為 6、0 筆超標' },
    { key: 'consecMax', name: '連續授課上限', def: '高', hasN: true, nHint: '連上 N 節後應有空堂', desc: '另有固定硬限制「永不連 7」。預設 N=5：人工課表在 N=3 下有 110 筆超標、最長 6 連' },
    { key: 'batchType', name: '同型態同日', def: '高', desc: '同一天盡量不混排連堂與單節（連堂日／單節日分開）。人工課表 14/235 組混排，且兼教連堂科目與單節科目的老師結構上無法避免，故為權重' },
    { key: 'compact', name: '減少零碎空堂', def: '低', desc: '單一空堂越少越好（「上空上空」交錯已是固定硬限制，這裡管殘餘的單一空堂）' },
    { key: 'dayBalance', name: '每日負擔平衡', def: '低', desc: '避免某天塞滿、某天全空' },
    { key: 'walkCost', name: '走動成本', def: '高', desc: '連續兩節跨教室，距離越遠扣越多。人工課表 943 組相接中僅 12 組跨專科教室（1.3%）', link: { href: '/admin/schedule-config?tab=room', label: '相鄰關係在「4 教室設定」' } },
  ] },
  { title: '教室', note: '作用在專科教室的分配', rows: [
    { key: 'roomPrefer', name: '專科教室優先', def: '高', desc: '有對應教室的科目盡量排進專科教室，同時段教室不夠時回原班（人工課表：自然連堂 42 組全進自然教室、單節 42 堂全回原班）' },
    { key: 'roomManagerFirst', name: '教室管理教師優先', def: '中', desc: '只作用於「有設管理教師」的教室：管理教師的課必分到自己的教室（結構保證）、其他老師借用時扣分', link: { href: '/admin/schedule-config?tab=room', label: '管理教師在「4 教室設定」' } },
  ] },
]
const isParam = (k: RuleKey): k is ParamKey => k === 'dailyMax' || k === 'consecMax' || k === 'homeroomDailyMax'

const MODE_CYCLE: DoubleMode[] = ['auto', 'double', 'single']
const MODE_CLS: Record<DoubleMode, string> = {
  auto: 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400',
  double: 'bg-zinc-800 text-white border-zinc-800',
  single: 'bg-white text-zinc-800 border-zinc-500',
  biweekly: 'bg-violet-100 text-violet-800 border-violet-300',
}
const MODE_SHORT: Record<DoubleMode, string> = { auto: '·', double: '連', single: '單', biweekly: '雙' }

/** 分頁八：權重設定。規則表（分組、參數內嵌）＋科目連堂矩陣＋固定硬限制（摺疊）。 */
export default function WeightTab({ config, setConfig, gradeSubjects }: Props) {
  const w = config.weights
  const [hardOpen, setHardOpen] = useState(false)
  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))
  // 連堂矩陣列：各年級有開的科目（perClass>0）；灰格＝該年級沒開這科。
  // 註：配課設定的 homeroom 旗標只表示「導師可配」，不代表科任不會教（本校全部科目皆勾），故不以此灰掉
  const matrixSubjects = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).filter(s => s.perClass > 0).map(s => s.name)))))
  const offered = (subj: string, g: number) => (gradeSubjects[g] ?? []).some(s => s.name === subj && s.perClass > 0)
  const perClassOf = (subj: string, g: number) => (gradeSubjects[g] ?? []).find(s => s.name === subj)?.perClass ?? 0

  function setWeights(fn: (w: ScheduleWeights) => ScheduleWeights) { setConfig(c => ({ ...c, weights: fn(c.weights) })) }
  function setBuiltin(patch: Partial<BuiltinRules>) { setWeights(x => ({ ...x, builtin: { ...x.builtin, ...patch } })) }
  const levelOf = (key: RuleKey): WeightLevel => isParam(key) ? w.builtin[key].level : w.builtin[key]
  const setLevel = (key: RuleKey, l: WeightLevel) => {
    if (isParam(key)) setBuiltin({ [key]: { ...w.builtin[key], level: l } } as Partial<BuiltinRules>)
    else setBuiltin({ [key]: l } as Partial<BuiltinRules>)
  }
  function updateTemplate(id: string, patch: Partial<TemplateRule>) {
    setWeights(x => ({ ...x, templates: x.templates.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }
  function addTemplate(template: RuleTemplate) {
    const master = w.builtin[template]
    const t: TemplateRule = {
      id: crypto.randomUUID(), template, subjects: [], grades: [], level: master === 'off' ? 'mid' : master,
      ...(template === 'avoidPeriods' ? { periods: [] } : {}),
      ...(template === 'timePrefer' ? { pref: 'morning' as const } : {}),
    }
    setWeights(x => ({ ...x, templates: [...x.templates, t] }))
  }
  function removeTemplate(t: TemplateRule) {
    setWeights(x => ({ ...x, templates: x.templates.filter(p => p.id !== t.id) }))
  }
  function setMode(subj: string, g: number, mode: DoubleMode) {
    setWeights(x => {
      const dm = { ...x.doubleMode, [subj]: { ...(x.doubleMode[subj] ?? {}) } }
      if (mode === 'auto') delete dm[subj][String(g)]; else dm[subj][String(g)] = mode
      if (Object.keys(dm[subj]).length === 0) delete dm[subj]
      return { ...x, doubleMode: dm }
    })
  }
  function cycleMode(subj: string, g: number) {
    const cur = doubleModeOf(w, subj, g)
    // 視藝：都可以 → 連堂 → 不連堂 → 單雙週；其他：都可以 → 連堂 → 不連堂
    const cycle = subj === '視覺藝術' ? [...MODE_CYCLE, 'biweekly' as DoubleMode] : MODE_CYCLE
    setMode(subj, g, cycle[(cycle.indexOf(cur) + 1) % cycle.length])
  }
  function setRow(subj: string, mode: DoubleMode) { for (const g of GRADES) if (offered(subj, g)) setMode(subj, g, mode) }
  function resetAll() {
    if (!confirm('將所有權重、規則與連堂矩陣恢復為預設值？')) return
    setWeights(() => defaultScheduleWeights())
  }

  const subRows = (template: RuleTemplate) => w.templates.filter(t => t.template === template)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-zinc-400">
          引擎只排科任課，所有規則都作用在「科任課的落點」。權重四段：關閉／低／中／高，「高」一項約抵「低」九項；
          排課時硬限制與權重一次跑，成功條件＝未排 0；排不完時精靈會建議降低哪些權重。
        </p>
        <span className="flex gap-2 flex-shrink-0">
          <button onClick={resetAll} className="btn btn-secondary text-xs py-0.5">恢復預設</button>
          <Link href="/admin/schedule-wizard" className="btn btn-primary text-xs py-0.5">▶ 前往排課精靈</Link>
        </span>
      </div>

      {/* 一、規則表 */}
      {GROUPS.map(gp => (
        <div key={gp.title} className="card p-0 overflow-hidden">
          <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-zinc-700">{gp.title}</span>
            <span className="text-xs text-zinc-400">{gp.note}</span>
          </div>
          {gp.rows.map(r => {
            const lvl = levelOf(r.key)
            const on = lvl !== 'off'
            const isDefault = WEIGHT_LEVEL_LABEL[lvl] === r.def
            return (
              <div key={r.key} className="px-4 py-2.5 border-b border-zinc-100 last:border-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-800">{r.name}
                      <span className={`ml-2 text-[11px] ${isDefault ? 'text-zinc-400' : 'text-amber-600'}`}>預設 {r.def}{!isDefault && '（已調整）'}</span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">{r.desc}
                      {r.link && <Link href={r.link.href} className="ml-1 text-sky-700 hover:underline">{r.link.label} →</Link>}
                    </div>
                  </div>
                  {r.hasN && on && (
                    <label className="flex items-center gap-1 text-xs text-zinc-500 flex-shrink-0 self-center">
                      <span className="hidden sm:inline">{r.nHint}</span> N=
                      <input type="number" min={1} max={7} value={w.builtin[r.key as ParamKey].n}
                        onChange={e => setBuiltin({ [r.key]: { ...w.builtin[r.key as ParamKey], n: Number(e.target.value) } } as Partial<BuiltinRules>)}
                        className="input w-14 text-center py-0.5 text-xs" />
                    </label>
                  )}
                  <div className="self-center"><LevelPicker value={lvl} onChange={l => setLevel(r.key, l)} /></div>
                </div>

                {/* 子規則（母開關非關閉時才顯示） */}
                {r.master && on && (
                  <div className="mt-2 ml-3 pl-3 border-l-2 border-zinc-200 space-y-1.5">
                    {subRows(r.master).length === 0 && <p className="text-xs text-zinc-400">尚無子規則。</p>}
                    {subRows(r.master).map(t => (
                      <div key={t.id} className="flex items-center gap-2 flex-wrap text-xs">
                        <MultiSelect options={subjectOptions} labels={shortName} selected={t.subjects} onChange={v => updateTemplate(t.id, { subjects: v })} allLabel="選科目…" width="w-44" />
                        <MultiSelect options={GRADES as unknown as number[]} labels={g => GRADE_LABEL[g]} selected={t.grades} onChange={v => updateTemplate(t.id, { grades: v.sort((a, b) => a - b) })} allLabel="全年級" width="w-28" />
                        {t.template === 'avoidPeriods' && <>
                          <MultiSelect options={[1, 2, 3, 4, 5, 6, 7]} labels={p => `第 ${p} 節`} selected={t.periods ?? []} onChange={v => updateTemplate(t.id, { periods: v.sort((a, b) => a - b) })} allLabel="選節次…" width="w-32" />
                          <label className="flex items-center gap-1 text-zinc-500 whitespace-nowrap">
                            <input type="checkbox" checked={Boolean(t.fullDayOnly)} onChange={e => updateTemplate(t.id, { fullDayOnly: e.target.checked || undefined })} /> 整天日限定
                          </label>
                        </>}
                        {t.template === 'timePrefer' && (
                          <select value={t.pref ?? 'morning'} onChange={e => updateTemplate(t.id, { pref: e.target.value as 'morning' | 'afternoon' })} className="input py-0.5 text-xs w-24">
                            <option value="morning">偏好上午</option><option value="afternoon">偏好下午</option>
                          </select>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          <LevelPicker size="sm" value={t.level} onChange={l => updateTemplate(t.id, { level: l })} />
                          <button onClick={() => removeTemplate(t)} className="text-red-400 hover:text-red-600" title="刪除這組">✕</button>
                        </span>
                        {t.subjects.length === 0 && <span className="w-full text-[11px] text-amber-600">未選科目＝此組不作用</span>}
                      </div>
                    ))}
                    <button onClick={() => addTemplate(r.master!)} className="text-xs text-sky-700 hover:underline">＋ 新增一組</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {/* 二、科目連堂矩陣（結構設定） */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-700">科目連堂</span>
          <span className="text-xs text-zinc-400">結構設定、非權重——連堂綁定會直接影響排不排得進去。點格子循環切換；列尾一次設整列。</span>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.auto}`}>·</span>都可以（預設：單節排，同科同日相鄰兩節可自然成對）
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.double}`}>連</span>連堂（每 2 節綁一組）
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.single}`}>單</span>不連堂（單節、同科不同日）
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.biweekly}`}>雙</span>單雙週（視藝）
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base no-hover">
            <thead>
              <tr>
                <th className="min-w-[9rem]">科目</th>
                {GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}
                <th className="text-center text-xs font-normal text-zinc-400">整列</th>
              </tr>
            </thead>
            <tbody>
              {matrixSubjects.map(subj => {
                return (
                  <tr key={subj}>
                    <td className="font-medium text-zinc-800">{shortName(subj)}</td>
                    {GRADES.map(g => {
                      const ok = offered(subj, g)
                      const mode = doubleModeOf(w, subj, g)
                      const pc = perClassOf(subj, g)
                      return (
                        <td key={g} className="text-center">
                          {ok
                            ? <button onClick={() => cycleMode(subj, g)} title={`${GRADE_LABEL[g]}${shortName(subj)} 每班 ${pc} 節：${DOUBLE_MODE_LABEL[mode]}（點擊切換）`}
                                className={`w-9 h-7 rounded-sm border text-xs font-medium ${MODE_CLS[mode]}`}>{MODE_SHORT[mode]}</button>
                            : <span className="text-zinc-300">—</span>}
                        </td>
                      )
                    })}
                    <td className="text-center">
                      <select value="" onChange={e => { if (e.target.value) setRow(subj, e.target.value as DoubleMode) }} className="input py-0.5 text-[11px] w-20">
                        <option value="">設整列…</option>
                        <option value="auto">都可以</option><option value="double">連堂</option><option value="single">不連堂</option>
                        {subj === '視覺藝術' && <option value="biweekly">單雙週</option>}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-zinc-400">
          「連堂」不跨午休（固定硬限制）；「都可以」的自然成對同樣不跨午休、且視為一組連堂計入「同型態同日」。單雙週僅視藝：占固定兩格、單週組／雙週組輪替、另一格由導師填課。
        </p>
      </div>

      {/* 三、固定硬限制（摺疊） */}
      <div className="card p-0 overflow-hidden">
        <button onClick={() => setHardOpen(o => !o)} className="w-full px-4 py-2 flex items-center gap-2 text-left hover:bg-zinc-50">
          <span className="text-zinc-400">{hardOpen ? '▾' : '▸'}</span>
          <span className="text-sm font-semibold text-zinc-700">固定硬限制</span>
          <span className="text-xs text-zinc-400">引擎絕不違反、不可調整；排不下的課列入未排清單（依 114-2 人工課表 0 違反者訂）</span>
        </button>
        {hardOpen && (
          <ul className="text-xs text-zinc-500 list-disc pl-9 pr-4 pb-3 space-y-0.5">
            <li>同班／同師／同教室同時段只有一堂課；只用年段可排課時段；避開鎖課格</li>
            <li>不排課標記：導師被標 → 班級課表該格必排科任課；科任被標 → 該格不排其課</li>
            <li>永不連 7 節（連續授課絕對上限 6 節）——導師亦適用：班級整天日至少落 1 堂科任課或鎖課，導師不會整天 7 節連上</li>
            <li>科任老師單日課間空堂最多一段——絕不出現「上、空、上、空」交錯（單一空堂可以；導師不在此限）</li>
            <li>同科同日：同班同科一天最多一次（連堂本身、「都可以」的自然成對不算）</li>
            <li>連堂 2 節成對永不拆散、且不跨午休（不由第 4 節起始）；視藝單雙週固定兩格輪替（單週組起始 1/3/5、雙週組 2/4/6）</li>
            <li>外師：同時段只在一班、不可到校時段不排、單日不連 7</li>
          </ul>
        )}
      </div>
    </div>
  )
}
