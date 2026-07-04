'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import {
  WEIGHT_LEVELS, WEIGHT_LEVEL_LABEL, defaultScheduleWeights,
  type ScheduleConfig, type ScheduleWeights, type BuiltinRules, type WeightLevel,
  type RuleTemplate, type TemplateRule,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL, orderSubjectNames } from '@/lib/allocation'
import type { GradeSubject } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  gradeSubjects: Record<number, GradeSubject[]>
}

/** 四段權重選鈕（關/低/中/高）。硬性要求一律列為固定硬限制，不提供「必須」。 */
function LevelPicker({ value, onChange }: { value: WeightLevel; onChange: (l: WeightLevel) => void }) {
  return (
    <div className="flex rounded-sm border border-zinc-200 overflow-hidden flex-shrink-0">
      {WEIGHT_LEVELS.map(l => (
        <button key={l} onClick={() => onChange(l)}
          className={`px-2 py-1 text-xs ${value === l
            ? l === 'off' ? 'bg-zinc-400 text-white' : 'bg-zinc-700 text-white'
            : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}>
          {WEIGHT_LEVEL_LABEL[l]}
        </button>
      ))}
    </div>
  )
}

/** 多選 chip 列。 */
function Chips<T extends string | number>({ options, labels, selected, onToggle }: {
  options: T[]; labels?: (v: T) => string; selected: T[]; onToggle: (v: T) => void
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(o => {
        const on = selected.includes(o)
        return (
          <button key={String(o)} onClick={() => onToggle(o)}
            className={`text-xs px-1.5 py-0.5 rounded-sm border ${on ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'}`}>
            {labels ? labels(o) : String(o)}
          </button>
        )
      })}
    </div>
  )
}

// 可調規則清單：依預設權重排序（高 → 中 → 低），tag 標示作用對象
type ParamKey = 'dailyMax' | 'consecMax' | 'homeroomDailyMax'
type SimpleKey = Exclude<keyof BuiltinRules, ParamKey | 'artBiweekly'>
const RULE_ROWS: { key: SimpleKey | ParamKey; hasN?: boolean; name: string; tag: string; def: string; desc: string }[] = [
  { key: 'dailyMax', hasN: true, name: '科任每日節數上限', tag: '科任', def: '高', desc: '科任老師一天最多授課 N 節' },
  { key: 'consecMax', hasN: true, name: '連續授課上限', tag: '科任', def: '高', desc: '連上 N 節後應有空堂（另有固定硬限制：永不連 7）' },
  { key: 'homeroomDailyMax', hasN: true, name: '導師每日節數上限', tag: '導師', def: '高', desc: '每班每日留白 ≤ N 格，避免導師單日上課超過 N 節（低年級科任課少，整天日常態超標屬正常）' },
  { key: 'roomPrefer', name: '專科教室優先', tag: '教室', def: '高', desc: '有對應教室的科目盡量排進專科教室，同時段教室不夠時回原班上課' },
  { key: 'roomManagerFirst', name: '教室管理教師優先', tag: '教室', def: '中', desc: '管理教師的課必分到自己管理的教室（結構保證）；其他老師借用有管理者的教室時扣分，優先引導至無管理者的教室' },
  { key: 'walkCost', name: '走動成本', tag: '科任', def: '中', desc: '老師連續兩節跨教室，距離越遠扣越多（依教室設定的相鄰關係）' },
  { key: 'homeroomMorning', name: '上午留白給導師', tag: '導師', def: '中', desc: '科任課盡量往下午排，讓導師能把國數等考科排上午' },
  { key: 'compact', name: '減少零碎空堂', tag: '科任', def: '低', desc: '單一空堂越少越好（「上空上空」交錯已是固定硬限制，這裡管殘餘的單一空堂）' },
  { key: 'dayBalance', name: '科任每日負擔平衡', tag: '科任', def: '低', desc: '避免科任老師某天塞滿、某天全空' },
  { key: 'homeroomBalance', name: '導師每日負擔平衡', tag: '導師', def: '低', desc: '班級的科任課每日平均分布＝導師每天的課量平均' },
]

const SMART = '智慧探究家：科技創新任務'
const shortName = (s: string) => s === SMART ? '智慧探究' : s

/** 分頁七：權重設定。固定硬限制＋可調規則（依預設權重排序）＋連堂設定＋自訂規則。 */
export default function WeightTab({ config, setConfig, gradeSubjects }: Props) {
  const w = config.weights
  const [addOpen, setAddOpen] = useState(false)
  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))

  function setWeights(fn: (w: ScheduleWeights) => ScheduleWeights) {
    setConfig(c => ({ ...c, weights: fn(c.weights) }))
  }
  function setBuiltin(patch: Partial<BuiltinRules>) {
    setWeights(x => ({ ...x, builtin: { ...x.builtin, ...patch } }))
  }
  function updateTemplate(id: string, patch: Partial<TemplateRule>) {
    setWeights(x => ({ ...x, templates: x.templates.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }
  function addTemplate(template: RuleTemplate) {
    const t: TemplateRule = {
      id: crypto.randomUUID(), template, subjects: [], grades: [], level: template === 'doublePeriod' ? 'high' : 'mid',
      ...(template === 'avoidPeriods' ? { periods: [] } : {}),
      ...(template === 'timePrefer' ? { pref: 'morning' as const } : {}),
    }
    setWeights(x => ({ ...x, templates: [...x.templates, t] }))
    setAddOpen(false)
  }
  function removeTemplate(t: TemplateRule) {
    if (!confirm(`刪除「${t.template === 'doublePeriod' ? '連堂科目' : '自訂規則'}：${t.subjects.map(shortName).join('、') || '未選科目'}」？`)) return
    setWeights(x => ({ ...x, templates: x.templates.filter(p => p.id !== t.id) }))
  }
  function resetAll() {
    if (!confirm('將所有權重與規則恢復為預設值？自訂的規則實例會被還原。')) return
    setWeights(() => defaultScheduleWeights())
  }
  const toggleIn = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

  const dblTemplates = w.templates.filter(t => t.template === 'doublePeriod')
  const customTemplates = w.templates.filter(t => t.template === 'avoidPeriods' || t.template === 'timePrefer')

  const levelOf = (key: SimpleKey | ParamKey): WeightLevel =>
    key === 'dailyMax' || key === 'consecMax' || key === 'homeroomDailyMax' ? w.builtin[key].level : w.builtin[key]
  const setLevel = (key: SimpleKey | ParamKey, l: WeightLevel) => {
    if (key === 'dailyMax' || key === 'consecMax' || key === 'homeroomDailyMax') setBuiltin({ [key]: { ...w.builtin[key], level: l } } as Partial<BuiltinRules>)
    else setBuiltin({ [key]: l } as Partial<BuiltinRules>)
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-zinc-400">
          引擎只排科任課，所有規則都作用在「科任課的落點」。權重四段：關閉／低／中／高，「高」一項約抵「低」九項。
          硬性要求（絕不違反）一律列在固定硬限制，不提供「必須」權重。
        </p>
        <span className="flex gap-2 flex-shrink-0">
          <button onClick={resetAll} className="btn btn-secondary text-xs py-0.5">恢復預設</button>
          <Link href="/admin/schedule-wizard" className="btn btn-primary text-xs py-0.5">▶ 前往排課精靈</Link>
        </span>
      </div>

      {/* 一、固定硬限制 */}
      <div className="card p-3 space-y-1">
        <div className="text-sm font-semibold text-zinc-700">一、固定硬限制 <span className="text-xs font-normal text-zinc-400 ml-1">引擎絕不違反、不可調整；排不下的課列入未排清單</span></div>
        <ul className="text-xs text-zinc-500 list-disc pl-5 space-y-0.5">
          <li>同班／同師／同教室同時段只有一堂課；只用年段可排課時段；避開鎖課格</li>
          <li>不排課標記：導師被標 → 班級課表該格必排科任課；科任被標 → 該格不排其課</li>
          <li>永不連 7 節（連續授課絕對上限 6 節）</li>
          <li>任何老師單日課間空堂最多一段——絕不出現「上、空、上、空」交錯（單一空堂可以）</li>
          <li>同型態同日：老師同一天不混排連堂與單節（連堂日／單節日分開）</li>
          <li>同科同日：同班同科一天最多一次（連堂本身不算）</li>
          <li>同科不隔天：同班同科不排相鄰兩天（每週每科最多 3 個落點：一、三、五）</li>
          <li>科任課同日成塊：同班同日（上、下午各自計）科任課與鎖課連成一塊，導師課不被切碎</li>
          <li>連堂 2 節成對永不拆散；視藝單雙週固定兩格輪替（單週組起始 1/3/5、雙週組 2/4/6）</li>
        </ul>
      </div>

      {/* 二、可調規則（依預設權重排序） */}
      <div className="card p-3 space-y-2">
        <div className="text-sm font-semibold text-zinc-700">二、可調規則 <span className="text-xs font-normal text-zinc-400 ml-1">依預設權重由高到低排序；標籤＝作用對象</span></div>
        {RULE_ROWS.map(row => (
          <div key={row.key} className="flex items-center gap-2 flex-wrap border-b border-zinc-100 last:border-0 pb-2 last:pb-0">
            <div className="flex-1 min-w-52">
              <div className="text-sm text-zinc-700 flex items-center gap-1.5">
                {row.name}
                <span className="text-[10px] px-1 py-0 rounded-sm bg-zinc-100 text-zinc-500 border border-zinc-200">{row.tag}</span>
                <span className="text-[10px] text-zinc-400">預設：{row.def}</span>
              </div>
              <div className="text-[11px] text-zinc-400">{row.desc}</div>
            </div>
            {row.hasN && (
              <label className="text-xs text-zinc-500 flex items-center gap-1">N=
                <input type="number" min={1} max={7}
                  value={(w.builtin[row.key as ParamKey]).n}
                  onChange={e => setBuiltin({ [row.key]: { ...w.builtin[row.key as ParamKey], n: Number(e.target.value) || (w.builtin[row.key as ParamKey]).n } } as Partial<BuiltinRules>)}
                  className="input py-0.5 text-xs w-14 text-center" />
              </label>
            )}
            <LevelPicker value={levelOf(row.key)} onChange={l => setLevel(row.key, l)} />
          </div>
        ))}
      </div>

      {/* 三、連堂設定（結構） */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-700">三、連堂設定 <span className="text-xs font-normal text-zinc-400 ml-1">結構設定，非權重：該科每 2 節排成一組連堂（如生活 6 節＝3 組）；「不同天」由硬限制自動保證</span></div>
          <button onClick={() => addTemplate('doublePeriod')} className="btn btn-secondary text-xs py-0.5">＋ 新增連堂科目</button>
        </div>
        {dblTemplates.length === 0 && <p className="text-xs text-zinc-400">尚無連堂科目。</p>}
        <div className="space-y-2">
          {dblTemplates.map(t => (
            <div key={t.id} className="rounded-md border border-zinc-200 p-2 space-y-1.5">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-400 w-8 pt-0.5 flex-shrink-0">科目</span>
                <Chips options={subjectOptions} labels={shortName} selected={t.subjects}
                  onToggle={s => updateTemplate(t.id, { subjects: toggleIn(t.subjects, s) })} />
                <button onClick={() => removeTemplate(t)} className="btn btn-danger text-xs py-0.5 ml-auto flex-shrink-0">刪除</button>
              </div>
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-400 w-8 pt-0.5 flex-shrink-0">年級</span>
                <Chips options={[...GRADES]} labels={g => GRADE_LABEL[g]} selected={t.grades}
                  onToggle={g => updateTemplate(t.id, { grades: toggleIn(t.grades, g) })} />
                {t.grades.length === 0 && <span className="text-[11px] text-zinc-400 pt-0.5">（未勾＝全年級）</span>}
              </div>
            </div>
          ))}
        </div>
        {/* 視藝單雙週 */}
        <div className="space-y-1 pt-2 border-t border-zinc-100">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1 text-sm text-zinc-700">
              <input type="checkbox" checked={w.builtin.artBiweekly.enabled}
                onChange={e => setBuiltin({ artBiweekly: { ...w.builtin.artBiweekly, enabled: e.target.checked } })} />
              視覺藝術單雙週連堂
            </label>
            <span className="text-xs text-zinc-400">適用年級</span>
            <Chips options={[...GRADES]} labels={g => GRADE_LABEL[g]}
              selected={w.builtin.artBiweekly.grades}
              onToggle={g => setBuiltin({ artBiweekly: { ...w.builtin.artBiweekly, grades: toggleIn(w.builtin.artBiweekly.grades, g) } })} />
          </div>
          <p className="text-[11px] text-zinc-400">
            課表占固定連續兩格：藝術週由視藝老師上、另一週該兩格還給導師（隔週輪替）。
          </p>
        </div>
      </div>

      {/* 四、自訂規則 */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-700">四、自訂規則 <span className="text-xs font-normal text-zinc-400 ml-1">從模板建立，可無限新增</span></div>
          <div className="relative">
            <button onClick={() => setAddOpen(o => !o)} className="btn btn-primary text-xs py-0.5">＋ 新增規則</button>
            {addOpen && (
              <div className="absolute right-0 mt-1 bg-white border border-zinc-200 rounded-md shadow-md z-10 w-40">
                <button onClick={() => addTemplate('avoidPeriods')} className="block w-full text-left px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">科目避開節次</button>
                <button onClick={() => addTemplate('timePrefer')} className="block w-full text-left px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">科目時段偏好</button>
              </div>
            )}
          </div>
        </div>
        {customTemplates.length === 0 && <p className="text-xs text-zinc-400">尚無自訂規則。</p>}
        <div className="space-y-2">
          {customTemplates.map(t => (
            <div key={t.id} className="rounded-md border border-zinc-200 p-2 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-1.5 py-0.5 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200 flex-shrink-0">
                  {t.template === 'avoidPeriods' ? '科目避開節次' : '科目時段偏好'}
                </span>
                {t.template === 'timePrefer' && (
                  <select value={t.pref ?? 'morning'} onChange={e => updateTemplate(t.id, { pref: e.target.value as 'morning' | 'afternoon' })} className="input py-0.5 text-xs w-24">
                    <option value="morning">偏好上午</option>
                    <option value="afternoon">偏好下午</option>
                  </select>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <LevelPicker value={t.level} onChange={l => updateTemplate(t.id, { level: l })} />
                  <button onClick={() => removeTemplate(t)} className="btn btn-danger text-xs py-0.5">刪除</button>
                </span>
              </div>
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-400 w-8 pt-0.5 flex-shrink-0">科目</span>
                <Chips options={subjectOptions} labels={shortName} selected={t.subjects}
                  onToggle={s => updateTemplate(t.id, { subjects: toggleIn(t.subjects, s) })} />
              </div>
              <div className="flex items-start gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-400 w-8 pt-0.5 flex-shrink-0">年級</span>
                <Chips options={[...GRADES]} labels={g => GRADE_LABEL[g]} selected={t.grades}
                  onToggle={g => updateTemplate(t.id, { grades: toggleIn(t.grades, g) })} />
                {t.grades.length === 0 && <span className="text-[11px] text-zinc-400 pt-0.5">（未勾＝全年級）</span>}
              </div>
              {t.template === 'avoidPeriods' && (
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-[11px] text-zinc-400 w-8 pt-0.5 flex-shrink-0">節次</span>
                  <Chips options={[1, 2, 3, 4, 5, 6, 7]} labels={p => `第${p}節`} selected={t.periods ?? []}
                    onToggle={p => updateTemplate(t.id, { periods: toggleIn(t.periods ?? [], p) })} />
                  <label className="flex items-center gap-1 text-[11px] text-zinc-500 pt-0.5">
                    <input type="checkbox" checked={t.fullDayOnly === true}
                      onChange={e => updateTemplate(t.id, { fullDayOnly: e.target.checked ? true : undefined })} />
                    僅整天日適用（半天日不受限）
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
