'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import {
  WEIGHT_LEVELS, WEIGHT_LEVEL_LABEL, RULE_TEMPLATE_LABEL, defaultScheduleWeights,
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

/** 五段權重選鈕。 */
function LevelPicker({ value, onChange }: { value: WeightLevel; onChange: (l: WeightLevel) => void }) {
  return (
    <div className="flex rounded-sm border border-zinc-200 overflow-hidden flex-shrink-0">
      {WEIGHT_LEVELS.map(l => (
        <button key={l} onClick={() => onChange(l)}
          className={`px-2 py-1 text-xs ${value === l
            ? l === 'must' ? 'bg-red-600 text-white' : l === 'off' ? 'bg-zinc-400 text-white' : 'bg-zinc-700 text-white'
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

// 內建規則的顯示定義（key、名稱、說明），依面向分組——全部都是「科任課落點」的規則
type SimpleKey = Exclude<keyof BuiltinRules, 'dailyMax' | 'consecMax' | 'artBiweekly'>
const BUILTIN_GROUPS: { title: string; note?: string; rows: { key: SimpleKey; name: string; desc: string }[] }[] = [
  {
    title: '科任教師課表',
    rows: [
      { key: 'compact', name: '減少零碎空堂', desc: '科任課盡量緊湊，避免上一節空一節' },
      { key: 'dayBalance', name: '每日負擔平衡', desc: '避免科任老師某天塞滿、某天全空' },
      { key: 'batchType', name: '連堂日與單節日分開', desc: '老師某天有連堂課，那天就盡量都排連堂、不混單節課。例：自然老師週一上滿各班連堂（實驗），週四上滿各班單節（講述），備一次課用一整天' },
      { key: 'blockSplit', name: '連堂與單節隔半週', desc: '同一班同一科的連堂和單節，一個排週一～三、另一個排週三～五。例：3年1班自然連堂在週二、單節在週五，不會擠在同半週' },
      { key: 'walkCost', name: '走動成本', desc: '老師連續兩節要跑不同教室時，距離越遠扣越多。例：第2節在A區1樓、第3節要衝到B區3樓就會被扣分（距離依教室設定的相鄰關係計算）' },
    ],
  },
  {
    title: '班級課表',
    rows: [
      { key: 'sameSubjectSameDay', name: '同科同日避免', desc: '同班同科一天不排兩次（連堂本身不算違反）' },
      { key: 'subjectSpread', name: '同科隔天分散', desc: '同班同科盡量分散到不相鄰的天' },
      { key: 'classCohesion', name: '科任課同日成塊', desc: '同班同一天（上、下午分開計）科任課與鎖課要連成一塊，不出現「導師、科任、導師、科任」交錯' },
      { key: 'roomPrefer', name: '專科教室優先', desc: '有對應教室的科目盡量排進專科教室，不夠時回原班上課' },
    ],
  },
  {
    title: '導師留白保護',
    note: '仍是科任課的限制——透過控制科任課落點，讓導師的自排空間品質好',
    rows: [
      { key: 'homeroomMorning', name: '上午留白給導師', desc: '科任課盡量往下午排，讓導師能把國數等考科排上午' },
      { key: 'homeroomBalance', name: '留白每日平衡', desc: '班級的科任課每日平均分布，導師每天都有格子可自排' },
    ],
  },
]

const TEMPLATE_TYPES: RuleTemplate[] = ['avoidPeriods', 'noConsecDays', 'doublePeriod', 'timePrefer']

/** 分頁七：權重設定。內建規則（調權重與參數）＋模板規則（可自行新增實例）。 */
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
      id: crypto.randomUUID(), template, subjects: [], grades: [], level: 'mid',
      ...(template === 'avoidPeriods' ? { periods: [] } : {}),
      ...(template === 'timePrefer' ? { pref: 'morning' as const } : {}),
    }
    setWeights(x => ({ ...x, templates: [...x.templates, t] }))
    setAddOpen(false)
  }
  function removeTemplate(t: TemplateRule) {
    if (!confirm(`刪除規則「${RULE_TEMPLATE_LABEL[t.template]}：${t.subjects.join('、') || '未選科目'}」？`)) return
    setWeights(x => ({ ...x, templates: x.templates.filter(p => p.id !== t.id) }))
  }
  function resetAll() {
    if (!confirm('將所有權重與規則恢復為預設值？自訂的規則實例會被還原。')) return
    setWeights(() => defaultScheduleWeights())
  }
  const toggleIn = <T,>(arr: T[], v: T) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-zinc-400">
          引擎只排科任課，所有規則都作用在「科任課的落點」。權重五段：關閉／低／中／高／必須；
          「高」一項約抵「低」九項。<span className="text-amber-600">「必須」＝硬限制，排不下的課會列入未排清單，請謹慎使用。</span>
        </p>
        <span className="flex gap-2 flex-shrink-0">
          <button onClick={resetAll} className="btn btn-secondary text-xs py-0.5">恢復預設</button>
          <Link href="/admin/schedule-wizard" className="btn btn-primary text-xs py-0.5">▶ 前往排課精靈</Link>
        </span>
      </div>

      {/* 固定硬限制（不可調） */}
      <div className="card p-3 space-y-1">
        <div className="text-sm font-semibold text-zinc-700">固定硬限制 <span className="text-xs font-normal text-zinc-400 ml-1">引擎絕不違反、不可調整</span></div>
        <ul className="text-xs text-zinc-500 list-disc pl-5 space-y-0.5">
          <li>同班／同師／同教室同時段只有一堂課；只用年段可排課時段；避開鎖課格</li>
          <li>不排課標記的時段：導師被標 → 班級課表該格必排科任課；科任被標 → 該格不排其課</li>
          <li>永不連 7 節（連續授課絕對上限 6 節）</li>
        </ul>
      </div>

      {/* 內建規則 */}
      <div className="card p-3 space-y-3">
        <div className="text-sm font-semibold text-zinc-700">內建規則</div>

        {/* 有參數的兩條 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-zinc-500">科任教師課表</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-48">
              <div className="text-sm text-zinc-700">每日節數上限</div>
              <div className="text-[11px] text-zinc-400">科任老師一天最多授課節數</div>
            </div>
            <label className="text-xs text-zinc-500 flex items-center gap-1">N=
              <input type="number" min={1} max={7} value={w.builtin.dailyMax.n}
                onChange={e => setBuiltin({ dailyMax: { ...w.builtin.dailyMax, n: Number(e.target.value) || 6 } })}
                className="input py-0.5 text-xs w-14 text-center" />
            </label>
            <LevelPicker value={w.builtin.dailyMax.level} onChange={l => setBuiltin({ dailyMax: { ...w.builtin.dailyMax, level: l } })} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-48">
              <div className="text-sm text-zinc-700">連續授課上限</div>
              <div className="text-[11px] text-zinc-400">連上 N 節後應有空堂（另有絕對上限 6 連，固定硬限制）</div>
            </div>
            <label className="text-xs text-zinc-500 flex items-center gap-1">N=
              <input type="number" min={1} max={6} value={w.builtin.consecMax.n}
                onChange={e => setBuiltin({ consecMax: { ...w.builtin.consecMax, n: Number(e.target.value) || 3 } })}
                className="input py-0.5 text-xs w-14 text-center" />
            </label>
            <LevelPicker value={w.builtin.consecMax.level} onChange={l => setBuiltin({ consecMax: { ...w.builtin.consecMax, level: l } })} />
          </div>
          {BUILTIN_GROUPS[0].rows.map(row => (
            <div key={row.key} className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-48">
                <div className="text-sm text-zinc-700">{row.name}</div>
                <div className="text-[11px] text-zinc-400">{row.desc}</div>
              </div>
              <LevelPicker value={w.builtin[row.key]} onChange={l => setBuiltin({ [row.key]: l } as Partial<BuiltinRules>)} />
            </div>
          ))}
        </div>

        {BUILTIN_GROUPS.slice(1).map(group => (
          <div key={group.title} className="space-y-2 pt-2 border-t border-zinc-100">
            <div className="text-xs font-semibold text-zinc-500">{group.title}
              {group.note && <span className="font-normal text-zinc-400 ml-1">（{group.note}）</span>}
            </div>
            {group.rows.map(row => (
              <div key={row.key} className="flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-48">
                  <div className="text-sm text-zinc-700">{row.name}</div>
                  <div className="text-[11px] text-zinc-400">{row.desc}</div>
                </div>
                <LevelPicker value={w.builtin[row.key]} onChange={l => setBuiltin({ [row.key]: l } as Partial<BuiltinRules>)} />
              </div>
            ))}
          </div>
        ))}

        {/* 視藝單雙週（結構性） */}
        <div className="space-y-1 pt-2 border-t border-zinc-100">
          <div className="text-xs font-semibold text-zinc-500">視覺藝術單雙週連堂（結構性）</div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1 text-sm text-zinc-700">
              <input type="checkbox" checked={w.builtin.artBiweekly.enabled}
                onChange={e => setBuiltin({ artBiweekly: { ...w.builtin.artBiweekly, enabled: e.target.checked } })} />
              啟用
            </label>
            <span className="text-xs text-zinc-400">適用年級</span>
            <Chips options={[...GRADES]} labels={g => GRADE_LABEL[g]}
              selected={w.builtin.artBiweekly.grades}
              onToggle={g => setBuiltin({ artBiweekly: { ...w.builtin.artBiweekly, grades: toggleIn(w.builtin.artBiweekly.grades, g) } })} />
          </div>
          <p className="text-[11px] text-zinc-400">
            課表占固定連續兩格：藝術週由視藝老師上、另一週該兩格還給導師（隔週輪替）。
            單週組連堂起始節次 1、3、5，雙週組 2、4、6，視藝老師可交錯服務兩組班不衝突。
          </p>
        </div>
      </div>

      {/* 模板規則 */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-700">自訂規則 <span className="text-xs font-normal text-zinc-400 ml-1">從模板建立，可無限新增</span></div>
          <div className="relative">
            <button onClick={() => setAddOpen(o => !o)} className="btn btn-primary text-xs py-0.5">＋ 新增規則</button>
            {addOpen && (
              <div className="absolute right-0 mt-1 bg-white border border-zinc-200 rounded-md shadow-md z-10 w-40">
                {TEMPLATE_TYPES.map(t => (
                  <button key={t} onClick={() => addTemplate(t)} className="block w-full text-left px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50">
                    {RULE_TEMPLATE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {w.templates.length === 0 && <p className="text-xs text-zinc-400">尚無自訂規則。</p>}
        <div className="space-y-2">
          {w.templates.map(t => (
            <div key={t.id} className="rounded-md border border-zinc-200 p-2 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs px-1.5 py-0.5 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200 flex-shrink-0">{RULE_TEMPLATE_LABEL[t.template]}</span>
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
                <Chips options={subjectOptions} selected={t.subjects}
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
              {t.template === 'doublePeriod' && (
                <p className="text-[11px] text-zinc-400 pl-10">該科每週節數中取兩節排成一組連堂，其餘單節。</p>
              )}
              {t.template === 'noConsecDays' && (
                <p className="text-[11px] text-zinc-400 pl-10">同班該科不排在連續兩天（如週二有體育，週一週三就避開）。</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
