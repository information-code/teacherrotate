'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { classKey, classLabel, foreignDemand, type ScheduleConfig, type ForeignTeacherConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import { NumberInput } from '@/components/ui/NumberInput'
import SlotGrid from './SlotGrid'
import type { GradeSubject } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  foreignProfiles: { id: string; name: string }[]   // 聘任別＝外師的帳號（含待聘）
}

const PERIODS = [1, 2, 3, 4, 5, 6, 7]

/** 分頁七：外師設定（協同英語）。外師不是配課單位、不算供需——只是掛在該班該科科任課上的額外資源。
 *  年級規則＝主授（每班 N 節、可排除個別班）；不可到校時段＝硬規則。無基本節數、無減課、無申報對照。 */
export default function ForeignTab({ config, setConfig, classCounts, gradeSubjects, foreignProfiles }: Props) {
  const [addSel, setAddSel] = useState('')
  const [excludeOpen, setExcludeOpen] = useState<Record<string, boolean>>({})   // `${tid}|${ruleIdx}` → 展開排除班級
  const [offOpen, setOffOpen] = useState<Record<string, boolean>>({})           // teacherId → 展開不可到校時段（預設收起，有設定者自動展開）

  const nameOf = (id: string) => foreignProfiles.find(p => p.id === id)?.name ?? '（帳號已移除）'
  const configured = new Set(config.foreignTeachers.map(f => f.teacherId))
  const addable = foreignProfiles.filter(p => !configured.has(p.id))
  const allClasses = GRADES.flatMap(g => Array.from({ length: classCounts[g] ?? 0 }, (_, i) => ({ key: classKey(g, i), label: classLabel(g, i), grade: g })))
  const subjectsOf = (g: number) => (gradeSubjects[g] ?? []).filter(s => s.perClass > 0).map(s => s.name)
  const defaultSubject = (g: number) => subjectsOf(g).find(n => /英/.test(n)) ?? subjectsOf(g)[0] ?? ''

  function update(tid: string, fn: (f: ForeignTeacherConfig) => ForeignTeacherConfig) {
    setConfig(c => ({ ...c, foreignTeachers: c.foreignTeachers.map(f => (f.teacherId === tid ? fn(f) : f)) }))
  }
  function add() {
    if (!addSel) return
    setConfig(c => ({
      ...c,
      foreignTeachers: [...c.foreignTeachers, { teacherId: addSel, gradeRules: [], offSlots: [], note: '' }],
    }))
    setAddSel('')
  }
  function removeFt(tid: string) {
    if (!confirm(`移除「${nameOf(tid)}」的外師掛課設定？（帳號不受影響）`)) return
    setConfig(c => ({ ...c, foreignTeachers: c.foreignTeachers.filter(f => f.teacherId !== tid) }))
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        外師與中師協同授課：配課配在中師、外師只是「跟課」——無基本節數、無減課、不算供需、不影響配課統計。
        「主授」＝該年級每班跟 N 節（預設 1；三～六年級英語、一二年級英語主題課），可排除個別班。
        外師跟的是<b>班</b>，該班該科由誰教（手動配班或精靈自動配）她就搭誰。
        硬規則：同一外師同時段只在一班、不可到校時段不排、單日不連 7。
      </p>

      {/* 新增外師 */}
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm text-zinc-600">新增外師</span>
        {foreignProfiles.length === 0
          ? <span className="text-xs text-amber-600">尚無外師帳號——請先於「帳號資料」新增教師並將聘任別設為「外師」（未定人選可用待聘帳號）。</span>
          : addable.length === 0
            ? <span className="text-xs text-zinc-400">所有外師帳號皆已加入。</span>
            : <>
                <select value={addSel} onChange={e => setAddSel(e.target.value)} className="input py-1 text-sm w-48">
                  <option value="">選擇外師…</option>
                  {addable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={add} disabled={!addSel} className="btn btn-primary text-sm py-1">加入</button>
              </>}
      </div>

      {config.foreignTeachers.length === 0 && (
        <div className="card text-sm text-zinc-400 text-center py-6">尚未設定任何外師。</div>
      )}

      {config.foreignTeachers.map(ft => {
        const demand = foreignDemand(ft, classCounts)
        const total = Object.values(demand).reduce((s, v) => s + v, 0)
        // 各年級小計（顯示用）
        const byGrade: Record<number, number> = {}
        for (const [k, v] of Object.entries(demand)) { const g = Number(k.split('-')[0]); byGrade[g] = (byGrade[g] ?? 0) + v }
        const offShown = offOpen[ft.teacherId] ?? ft.offSlots.length > 0
        return (
          <div key={ft.teacherId} className="card p-4 space-y-3">
            {/* 標頭：姓名｜合計｜備註｜移除 */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-base font-semibold text-zinc-800">{nameOf(ft.teacherId)}</div>
              <span className={`text-xs px-2 py-0.5 rounded-sm border ${total > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-50 text-zinc-400 border-zinc-200'}`}>
                本校合計 {total} 節
                {total > 0 && <span className="ml-1 opacity-70">（{GRADES.filter(g => byGrade[g]).map(g => `${GRADE_LABEL[g]} ${byGrade[g]}`).join('・')}）</span>}
              </span>
              <input value={ft.note} onChange={e => update(ft.teacherId, f => ({ ...f, note: e.target.value }))}
                placeholder="備註（如：建功國小共聘）" className="input py-0.5 text-xs w-48 ml-auto" />
              <button onClick={() => removeFt(ft.teacherId)} className="text-xs text-red-400 hover:text-red-600">移除</button>
            </div>

            {/* 主授（年級整批）：一列一年級 */}
            <section className="border border-zinc-200 rounded-sm">
              <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 border-b border-zinc-200">
                <div className="text-xs font-semibold text-zinc-700">主授年級</div>
                <button onClick={() => update(ft.teacherId, f => {
                  const g = GRADES.find(x => (classCounts[x] ?? 0) > 0 && !f.gradeRules.some(r => r.grade === x)) ?? 1
                  return { ...f, gradeRules: [...f.gradeRules, { grade: g, subject: defaultSubject(g), perClass: 1, excluded: [] }] }
                })} className="btn btn-secondary text-xs py-0.5">＋ 新增年級</button>
              </div>
              {ft.gradeRules.length === 0 && <p className="text-xs text-zinc-400 px-3 py-3">尚未設定——按「＋ 新增年級」，選年級與科目、每班節數（預設 1）。</p>}
              {ft.gradeRules.map((r, idx) => {
                const key = `${ft.teacherId}|${idx}`
                const classes = allClasses.filter(c => c.grade === r.grade)
                const open = !!excludeOpen[key]
                const active = classes.length - r.excluded.length
                return (
                  <div key={idx} className="px-3 py-2 border-b border-zinc-100 last:border-0">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <select value={r.grade} onChange={e => {
                        const g = Number(e.target.value)
                        update(ft.teacherId, f => ({ ...f, gradeRules: f.gradeRules.map((x, i) => i === idx ? { ...x, grade: g, subject: subjectsOf(g).includes(x.subject) ? x.subject : defaultSubject(g), excluded: [] } : x) }))
                      }} className="input py-0.5 text-xs w-20">
                        {GRADES.map(g => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}
                      </select>
                      <select value={r.subject} onChange={e => update(ft.teacherId, f => ({ ...f, gradeRules: f.gradeRules.map((x, i) => i === idx ? { ...x, subject: e.target.value } : x) }))}
                        className="input py-0.5 text-xs w-32">
                        {!subjectsOf(r.grade).includes(r.subject) && <option value={r.subject}>{r.subject || '（選科目）'}</option>}
                        {subjectsOf(r.grade).map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-zinc-500">每班</span>
                      <NumberInput min={0} max={9} value={r.perClass}
                        onChange={n => update(ft.teacherId, f => ({ ...f, gradeRules: f.gradeRules.map((x, i) => i === idx ? { ...x, perClass: n } : x) }))}
                        className="input w-11 py-0.5 text-xs text-center" />
                      <span className="text-zinc-500">節</span>
                      <span className="text-zinc-400">→ {active} 班 × {r.perClass} ＝ <b className="text-zinc-700">{active * r.perClass}</b> 節</span>
                      <button onClick={() => setExcludeOpen(p => ({ ...p, [key]: !open }))}
                        className={`ml-auto px-1.5 py-0.5 rounded-sm border ${r.excluded.length ? 'text-amber-700 border-amber-300 bg-amber-50' : 'text-zinc-400 border-zinc-200 hover:text-zinc-700'}`}>
                        {r.excluded.length ? `已排除 ${r.excluded.length} 班` : '排除班級'}{open ? ' ▴' : ' ▾'}
                      </button>
                      <button onClick={() => update(ft.teacherId, f => ({ ...f, gradeRules: f.gradeRules.filter((_, i) => i !== idx) }))} className="text-red-400 hover:text-red-600" title="刪除此年級">✕</button>
                    </div>
                    {open && (
                      <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                        {classes.map(c => {
                          const ex = r.excluded.includes(c.key)
                          return (
                            <button key={c.key} onClick={() => update(ft.teacherId, f => ({ ...f, gradeRules: f.gradeRules.map((x, i) => i === idx ? { ...x, excluded: ex ? x.excluded.filter(k => k !== c.key) : [...x.excluded, c.key] } : x) }))}
                              className={`text-[11px] px-1.5 py-0.5 rounded-sm border ${ex ? 'bg-zinc-100 text-zinc-400 border-zinc-200 line-through' : 'bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500'}`}>
                              {c.label}
                            </button>
                          )
                        })}
                        <span className="text-[10px] text-zinc-400 ml-1">點班級切換排除（劃線＝不跟）</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>

            {/* 不可到校時段：預設收起，有需要再點開 */}
            <section className="border border-zinc-200 rounded-sm">
              <button onClick={() => setOffOpen(p => ({ ...p, [ft.teacherId]: !offShown }))}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-50">
                <span className="text-zinc-400">{offShown ? '▾' : '▸'}</span>
                <span className="font-semibold text-zinc-700">不可到校時段</span>
                {ft.offSlots.length > 0
                  ? <span className="px-1.5 py-0.5 rounded-sm bg-red-50 text-red-600 border border-red-200">{ft.offSlots.length} 格</span>
                  : <span className="text-zinc-400">未設定（跨校／固定行程才需要）</span>}
              </button>
              {offShown && (
                <div className="px-3 pb-3 pt-1 border-t border-zinc-100">
                  <div className="max-w-xs">
                    <SlotGrid periods={PERIODS}
                      isOn={k => ft.offSlots.includes(k)}
                      onToggle={k => update(ft.teacherId, f => ({ ...f, offSlots: f.offSlots.includes(k) ? f.offSlots.filter(x => x !== k) : [...f.offSlots, k] }))}
                      onLabel="✕" onClass="bg-red-500 text-white border-red-500" />
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-1">點格子標紅＝該時段不排此外師的課（硬規則）。</p>
                </div>
              )}
            </section>
          </div>
        )
      })}
    </div>
  )
}
