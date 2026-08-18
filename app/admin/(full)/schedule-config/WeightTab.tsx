'use client'

import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import {
  WEIGHT_LEVELS, WEIGHT_LEVEL_LABEL, defaultScheduleWeights, doubleModeOf, DOUBLE_MODE_LABEL, BANDS, BAND_LABEL, DAY_MODES, DAY_MODE_LABEL,
  ROOM_USES, ROOM_USE_LABEL, roomUseOf, type RoomUse,
  type ScheduleConfig, type ScheduleWeights, type BuiltinRules, type WeightLevel,
  type RuleTemplate, type TemplateRule, type DoubleMode, type DaySpread, type DayMode,
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
type ParamKey = 'dailyMax' | 'consecMax' | 'homeroomDailyMax' | 'homeroomMorning'
type MasterKey = 'avoidPeriods' | 'timePrefer' | 'subjectApart'
type SpreadKey = 'hourlyBalance'
type SimpleKey = Exclude<keyof BuiltinRules, ParamKey | MasterKey | SpreadKey>
type RuleKey = SimpleKey | ParamKey | MasterKey | SpreadKey
interface RuleRow { key: RuleKey; name: string; def: string; desc: string; hasN?: boolean; spread?: boolean; nHint?: string; master?: RuleTemplate; link?: { href: string; label: string } }
// 規則依「為誰而設」分組——每一條權重都是因為某個人的處境才存在，依作用對象分組比依技術面向直覺。
// 鐘點教師在引擎裡沒有專屬規則（受的是與科任、行政完全相同的那一組），故三者合併為一組。
const GROUPS: { title: string; note: string; rows: RuleRow[] }[] = [
  { title: '導師', note: '為導師而設：留白落在哪裡、每天要上幾節、會不會被切碎', rows: [
    { key: 'homeroomMorning', name: '上午導師課下限', def: '中', hasN: true, nHint: '每天上午至少 N 節導師課', desc: '保障導師每天上午（1~4 節）有 N 節自己的課可排國數。刻意是「下限」不是「越多越好」——單調版本會把科任課全擠到下午、讓上午 4 格全成導師課而撞上「不連四」硬限制' },
    { key: 'homeroomDailyMax', name: '導師每日節數上限', def: '高', hasN: true, nHint: '每班每日留白 ≤ N 格', desc: '導師單日最多上 N 節。導師一週僅 14~15 節，N=3 等於強制用滿五天、形狀只剩 3/3/3/3/2——「每週平均分散」由這條涵蓋，不另設規則。另有固定硬限制「導師連上上限」＝不連四' },
    { key: 'classCohesion', name: '科任課同日成塊', def: '高', desc: '同班同日（上、下午各自計）科任課與鎖課盡量連成一塊，導師課不被切碎。人工課表 32 班有違反、且與「空堂最多一段」互斥，故為權重' },
  ] },
  { title: '科任・行政', note: '為授課老師本人而設：一週課表的鬆緊、空堂與移動', rows: [
    { key: 'dailyMax', name: '每日節數上限', def: '高', hasN: true, nHint: '一天最多 N 節', desc: '114-2 人工課表實測最大值恰為 6、0 筆超標' },
    { key: 'consecMax', name: '連續授課上限', def: '高', hasN: true, nHint: '連上 N 節後應有空堂', desc: '另有固定硬限制「永不連 7」。預設 N=5：人工課表在 N=3 下有 110 筆超標、最長 6 連' },
    { key: 'walkCost', name: '走動成本', def: '高', desc: '相鄰兩堂課跨教室，距離越遠扣越多；不同區同層＝4，跨樓再加 3×樓層差，中間有空堂或跨午休減半。上去了就待在同層比上去又下來便宜', link: { href: '/admin/schedule-config?tab=room', label: '樓層與相鄰關係在「4 教室設定」' } },
    { key: 'roomPrefer', name: '專科教室優先', def: '高', desc: '有對應教室的科目盡量排進專科教室，同時段教室不夠時回原班（人工課表：自然連堂 42 組全進自然教室、單節 42 堂全回原班）' },
    { key: 'roomManagerFirst', name: '教室管理教師優先', def: '中', desc: '只作用於「有設管理教師」的教室：管理教師的課必分到自己的教室（結構保證）、其他老師借用時扣分', link: { href: '/admin/schedule-config?tab=room', label: '管理教師在「4 教室設定」' } },
    { key: 'batchType', name: '同型態同日', def: '高', desc: '同一天盡量不混排連堂與單節（連堂日／單節日分開）。人工課表 14/235 組混排，且兼教連堂科目與單節科目的老師結構上無法避免，故為權重' },
    { key: 'compact', name: '減少零碎空堂', def: '低', desc: '單一空堂越少越好（「上空上空」交錯已是固定硬限制，這裡管殘餘的單一空堂）' },
  ] },
  { title: '鐘點', note: '鐘點老師多半希望少跑幾趟學校。上面「科任・行政」那組的規則同樣作用在鐘點身上，這裡只放身分專屬的', rows: [
    { key: 'hourlyBalance', name: '鐘點每週分布', def: '中', spread: true, desc: '預設「集中」：一週五天不要都跑，盡量壓在設定的天數之內。若某位鐘點老師只有固定幾天能到校，請改用「個人不排課時段」（硬限制）更可靠' },
  ] },
  { title: '其他', note: '不專屬於誰、對學生的學習節奏與全校都好的安排', rows: [
    { key: 'subjectApart', name: '科目互斥同日', def: '中', desc: '列出的幾科（如體育與健康、自然與社會）同班盡量不同一天出現。可加多組；權重而非硬限制——排不開時寧可有一天並存也不要排不出來', master: 'subjectApart' },
    { key: 'avoidPeriods', name: '科目避開節次', def: '中', desc: '指定科目避開某些節次（如體育避午餐前後、考科避第 7 節）。可加多組，各組可再調權重；母開關關閉＝全部不計', master: 'avoidPeriods' },
    { key: 'timePrefer', name: '科目時段偏好', def: '關閉', desc: '指定科目偏好上午或下午。可加多組；母開關關閉＝全部不計', master: 'timePrefer' },
  ] },
]
const isParam = (k: RuleKey): k is ParamKey => k === 'dailyMax' || k === 'consecMax' || k === 'homeroomDailyMax' || k === 'homeroomMorning'
const isSpread = (k: RuleKey): k is SpreadKey => k === 'hourlyBalance'

const MODE_CYCLE: DoubleMode[] = ['auto', 'double', 'single']
const MODE_CLS: Record<DoubleMode, string> = {
  auto: 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400',
  double: 'bg-zinc-800 text-white border-zinc-800',
  single: 'bg-white text-zinc-800 border-zinc-500',
  biweekly: 'bg-violet-100 text-violet-800 border-violet-300',
}
const MODE_SHORT: Record<DoubleMode, string> = { auto: '·', double: '連', single: '單', biweekly: '雙' }

/** 分頁九：權重設定。規則表（分組、參數內嵌）＋科目連堂矩陣＋固定硬限制（摺疊）。 */
export default function WeightTab({ config, setConfig, gradeSubjects }: Props) {
  const w = config.weights
  const [hardOpen, setHardOpen] = useState(false)
  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))
  // 連堂矩陣列：各年級有開的科目（perClass>0）；灰格＝該年級沒開這科。
  // 註：配課設定的 homeroom 旗標只表示「導師可配」，不代表科任不會教（本校全部科目皆勾），故不以此灰掉
  const matrixSubjects = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).filter(s => s.perClass > 0).map(s => s.name)))))
  const offered = (subj: string, g: number) => (gradeSubjects[g] ?? []).some(s => s.name === subj && s.perClass > 0)
  const perClassOf = (subj: string, g: number) => (gradeSubjects[g] ?? []).find(s => s.name === subj)?.perClass ?? 0

  // 有綁定科目的專科教室 → 這些科目才需要設定使用時機
  const roomSubjects = Array.from(new Set(config.roomZones.flatMap(z => z.rooms.filter(r => r.kind === 'subject' && r.subject).map(r => r.subject))))
  function setWeights(fn: (w: ScheduleWeights) => ScheduleWeights) { setConfig(c => ({ ...c, weights: fn(c.weights) })) }
  function setBuiltin(patch: Partial<BuiltinRules>) { setWeights(x => ({ ...x, builtin: { ...x.builtin, ...patch } })) }
  const levelOf = (key: RuleKey): WeightLevel =>
    isParam(key) || isSpread(key) ? (w.builtin[key] as { level: WeightLevel }).level : w.builtin[key] as WeightLevel
  const setLevel = (key: RuleKey, l: WeightLevel) => {
    if (isParam(key) || isSpread(key)) setBuiltin({ [key]: { ...(w.builtin[key] as object), level: l } } as Partial<BuiltinRules>)
    else setBuiltin({ [key]: l } as Partial<BuiltinRules>)
  }
  const spreadOf = (key: SpreadKey) => w.builtin[key]
  const setSpread = (key: SpreadKey, patch: Partial<DaySpread>) =>
    setBuiltin({ [key]: { ...w.builtin[key], ...patch } } as Partial<BuiltinRules>)
  function updateTemplate(id: string, patch: Partial<TemplateRule>) {
    setWeights(x => ({ ...x, templates: x.templates.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }
  function addTemplate(template: RuleTemplate) {
    const master = w.builtin[template]
    const t: TemplateRule = {
      id: crypto.randomUUID(), template, subjects: [], grades: [], level: master === 'off' ? 'mid' : master,
      ...(template === 'avoidPeriods' ? { periods: [] } : {}),
      ...(template === 'timePrefer' ? { pref: 'morning' as const } : {}),   // subjectApart：只用 subjects/grades
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
                  {isSpread(r.key) && on && (() => {
                    const sp = spreadOf(r.key)
                    return (
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 flex-shrink-0 self-center">
                        <span className="inline-flex border border-zinc-200 rounded-full overflow-hidden text-[11px]">
                          {DAY_MODES.map(m => (
                            <button key={m} onClick={() => setSpread(r.key as SpreadKey, { mode: m })}
                              className={`px-2 py-0.5 ${sp.mode === m ? 'bg-zinc-200 text-zinc-800 font-medium' : 'bg-white text-zinc-400 hover:text-zinc-600'}`}>
                              {DAY_MODE_LABEL[m]}
                            </button>
                          ))}
                        </span>
                        {sp.mode === 'concentrate' && (
                          <label className="flex items-center gap-1">壓在
                            <input type="number" min={1} max={5} value={sp.days}
                              onChange={e => setSpread(r.key as SpreadKey, { days: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
                              className="input w-12 text-center py-0.5 text-xs" />天內
                          </label>
                        )}
                      </div>
                    )
                  })()}
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
                        {t.template === 'subjectApart'
                          ? t.subjects.length < 2 && <span className="w-full text-[11px] text-amber-600">互斥至少要選兩科</span>
                          : t.subjects.length === 0 && <span className="w-full text-[11px] text-amber-600">未選科目＝此組不作用</span>}
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

      {/* 二之二、專科教室使用時機矩陣（結構設定，科目 × 年級） */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 border-b border-zinc-100">
          <span className="text-sm font-semibold text-zinc-700">專科教室使用時機</span>
          <span className="text-xs text-zinc-400 ml-2">哪些課要進專科教室。點格子循環切換：一律使用／只有連堂／不使用</span>
        </div>
        {roomSubjects.length === 0
          ? <p className="px-4 py-3 text-xs text-zinc-400">「4 教室設定」裡還沒有綁定科目的專科教室。</p>
          : <div className="overflow-x-auto">
              <table className="table-base no-hover">
                <thead><tr><th className="min-w-[7rem]">科目</th>{GRADES.map(g => <th key={g} className="text-center w-20">{GRADE_LABEL[g]}</th>)}</tr></thead>
                <tbody>
                  {roomSubjects.map(subj => (
                    <tr key={subj}>
                      <td className="font-medium whitespace-nowrap">{shortName(subj)}</td>
                      {GRADES.map(g => {
                        const u = roomUseOf(w, subj, g)
                        const nextU = ROOM_USES[(ROOM_USES.indexOf(u) + 1) % ROOM_USES.length]
                        return (
                          <td key={g} className="text-center">
                            <button
                              onClick={() => setWeights(x => {
                                const ru = { ...x.roomUse, [subj]: { ...(x.roomUse[subj] ?? {}) } }
                                if (nextU === 'always') delete ru[subj][String(g)]
                                else ru[subj][String(g)] = nextU
                                return { ...x, roomUse: ru }
                              })}
                              title={`點擊改為「${ROOM_USE_LABEL[nextU]}」`}
                              className={`w-full px-1 py-0.5 text-[11px] rounded-sm border ${
                                u === 'always' ? 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'
                                : u === 'double' ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : 'bg-zinc-100 text-zinc-600 border-zinc-300'}`}>
                              {ROOM_USE_LABEL[u]}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        <p className="px-4 py-2 text-[11px] text-zinc-400">
          「只有連堂」＝單節留在原班上，不占專科教室、也不扣「專科教室優先」的分。依 114-2 人工課表逐年級核對（零例外）：
          自然科學連堂 42 組全進自然教室、單節 42 堂全留原班；視覺藝術三年級連堂與單節全留原班、四～六年級全進手作教室；
          音樂 42 堂、表演藝術 21 堂、智慧探究家 42 組皆 100% 進專科教室。
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
            <li className="flex items-center gap-2 flex-wrap">
              <span>老師連續授課絕對上限</span>
              <input type="number" min={2} max={6} value={w.hardParams.maxRunTeacher}
                onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, maxRunTeacher: Math.min(6, Math.max(2, Number(e.target.value) || 6)) } }))}
                className="input w-14 text-center py-0.5 text-xs" />
              <span>節（科任與外師；預設 6＝永不連 7）</span>
            </li>
            <li className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span>導師連上絕對上限</span>
                <input type="number" min={2} max={6} value={w.hardParams.maxRunHomeroom}
                  onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, maxRunHomeroom: Math.min(6, Math.max(2, Number(e.target.value) || 3)) } }))}
                  className="input w-14 text-center py-0.5 text-xs" />
                <span>節（＝班級同日連續留白不得超過此數，引擎會用科任課／鎖課切開；預設 3＝導師不連四）</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-zinc-400">適用年段</span>
                {BANDS.map(b => (
                  <label key={b} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={w.hardParams.homeroomRunBands.includes(b)}
                      onChange={e => setWeights(x => ({
                        ...x,
                        hardParams: {
                          ...x.hardParams,
                          homeroomRunBands: e.target.checked
                            ? BANDS.filter(k => k === b || x.hardParams.homeroomRunBands.includes(k))
                            : x.hardParams.homeroomRunBands.filter(k => k !== b),
                        },
                      }))} />
                    <span>{BAND_LABEL[b]}</span>
                  </label>
                ))}
                {w.hardParams.homeroomRunBands.length === 0
                  ? <span className="text-amber-600">未選任何年段＝此限制停用</span>
                  : <span className="text-zinc-400">避免導師整個上午連上、中間沒有一節可喘息／改作業</span>}
              </div>
            </li>
            <li className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={w.hardParams.roomManagerOnly}
                  onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, roomManagerOnly: e.target.checked } }))} />
                <span>有設管理教師的專科教室，<b>只有管理教師能用</b></span>
              </label>
              <span className="text-zinc-400">
                用不到就回原班，不借別人的教室；沒設管理教師的教室仍開放給所有人。
                {!w.hardParams.roomManagerOnly && <span className="text-amber-600 ml-1">關閉時：借別人的教室（扣「教室管理教師優先」）永遠比回原班（扣「專科教室優先」）便宜，老師會在各教室間跑來跑去</span>}
              </span>
            </li>
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
