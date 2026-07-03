'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { HOMEROOM_SELF, subjectClassKey, classKey, classLabel, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import type { GradeSubject, HomeroomTeacher, SubjectTeacher } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  subjectTeachers: SubjectTeacher[]
  homerooms: HomeroomTeacher[]
}

/** 分頁三：科任配班。從配課結果（科目×年級×節數）帶入可授課教師，指派各班；可手動改派任何科任／行政。 */
export default function SubjectAssignTab({ config, setConfig, classCounts, gradeSubjects, subjectTeachers, homerooms }: Props) {
  const firstGrade = GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1
  const [grade, setGrade] = useState<number>(firstGrade)
  const [showAll, setShowAll] = useState(false)

  const nameOf = (id: string) => subjectTeachers.find(t => t.id === id)?.name ?? homerooms.find(h => h.id === id)?.name ?? '？'
  const hoursOf = (t: SubjectTeacher, subj: string, g: number) => Number(t.hours[subj]?.[String(g)]) || 0
  const supply = (subj: string, g: number) => subjectTeachers.reduce((s, t) => s + hoursOf(t, subj, g), 0)

  function setAssign(g: number, index: number, subject: string, teacherId: string) {
    setConfig(c => {
      const next = { ...c.subjectClassTeacher }
      const k = subjectClassKey(g, index, subject)
      if (teacherId) next[k] = teacherId; else delete next[k]
      return { ...c, subjectClassTeacher: next }
    })
  }

  /** 某老師在某科某年級已被指派的班數。 */
  function assignedCount(tid: string, subj: string, g: number) {
    const count = classCounts[g] ?? 0
    let n = 0
    for (let i = 0; i < count; i++) if (config.subjectClassTeacher[subjectClassKey(g, i, subj)] === tid) n++
    return n
  }

  /** 自動分配：未指定的班依「剩餘容量」由節數多的老師依序認領。 */
  function autoAssign(g: number, subj: string, perClass: number) {
    if (perClass <= 0) return
    const count = classCounts[g] ?? 0
    const eligible = subjectTeachers
      .filter(t => hoursOf(t, subj, g) > 0)
      .sort((a, b) => hoursOf(b, subj, g) - hoursOf(a, subj, g))
    setConfig(c => {
      const next = { ...c.subjectClassTeacher }
      const used: Record<string, number> = {}
      for (let i = 0; i < count; i++) {
        const cur = next[subjectClassKey(g, i, subj)]
        if (cur && cur !== '') used[cur] = (used[cur] ?? 0) + 1
      }
      const queue: string[] = []
      for (const t of eligible) {
        const cap = Math.floor(hoursOf(t, subj, g) / perClass) - (used[t.id] ?? 0)
        for (let i = 0; i < cap; i++) queue.push(t.id)
      }
      for (let i = 0; i < count; i++) {
        const k = subjectClassKey(g, i, subj)
        if (!next[k] && queue.length) next[k] = queue.shift()!
      }
      return { ...c, subjectClassTeacher: next }
    })
  }

  const count = classCounts[grade] ?? 0
  const subjects = (gradeSubjects[grade] ?? []).filter(s =>
    s.perClass > 0 && (showAll || !s.homeroom || supply(s.name, grade) > 0))

  // 教師工作面小結：配課總節數 vs 已派節數（指派班數 × 每班節數，跨全部年級科目）
  const summary = subjectTeachers.map(t => {
    let allocTotal = 0
    for (const m of Object.values(t.hours)) for (const v of Object.values(m)) allocTotal += Number(v) || 0
    let assigned = 0
    for (const g of GRADES) {
      for (const s of gradeSubjects[g] ?? []) {
        if (s.perClass <= 0) continue
        assigned += assignedCount(t.id, s.name, g) * s.perClass
      }
    }
    return { ...t, allocTotal, assigned }
  }).filter(t => t.allocTotal > 0 || t.assigned > 0)

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        依配課結果（科目 × 年級 × 節數）列出可授課教師，指定每班由誰授課；也可手動改派任何科任／行政教師。
        「導師自上」＝該班該科由導師授課、不派科任。
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {GRADES.map(g => (
          <button key={g} onClick={() => setGrade(g)}
            className={`btn text-sm py-1 ${g === grade ? 'btn-primary' : 'btn-secondary'}`}>
            {GRADE_LABEL[g]}<span className="ml-1 text-[10px] opacity-70">{classCounts[g] ?? 0}班</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          顯示全部科目
        </label>
      </div>

      {count === 0
        ? <div className="card text-sm text-zinc-400 text-center py-6">{GRADE_LABEL[grade]}尚未於配課設定設定班級數。</div>
        : subjects.length === 0
          ? <div className="card text-sm text-zinc-400 text-center py-6">此年級沒有需要科任配班的科目（可勾選「顯示全部科目」檢視）。</div>
          : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {subjects.map(s => {
                const total = supply(s.name, grade)
                const demand = count * s.perClass
                const eligible = subjectTeachers
                  .filter(t => hoursOf(t, s.name, grade) > 0)
                  .sort((a, b) => hoursOf(b, s.name, grade) - hoursOf(a, s.name, grade))
                const others = subjectTeachers
                  .filter(t => hoursOf(t, s.name, grade) <= 0)
                  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
                return (
                  <div key={s.name} className="card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-700">{s.name}
                        <span className="text-xs font-normal text-zinc-400 ml-1">每班 {s.perClass} 節</span>
                      </div>
                      <button onClick={() => autoAssign(grade, s.name, s.perClass)} className="btn btn-secondary text-xs py-0.5">自動分配</button>
                    </div>
                    <div className={`text-[11px] ${total < demand ? 'text-amber-600' : 'text-zinc-400'}`}>
                      需求 {demand} 節（{count} 班）｜科任供給 {total} 節{total < demand && '，不足'}
                    </div>
                    <div className="space-y-1">
                      {Array.from({ length: count }, (_, i) => {
                        const k = subjectClassKey(grade, i, s.name)
                        const val = config.subjectClassTeacher[k] ?? ''
                        const homeroomName = nameOf(config.classTeacher[classKey(grade, i)] ?? '')
                        return (
                          <label key={i} className="flex items-center gap-2 text-sm">
                            <span className="text-zinc-600 w-14 flex-shrink-0">{classLabel(grade, i)}</span>
                            <select value={val} onChange={e => setAssign(grade, i, s.name, e.target.value)} className="input py-1 text-sm flex-1 min-w-0">
                              <option value="">未指定</option>
                              <option value={HOMEROOM_SELF}>導師自上{homeroomName !== '？' ? `（${homeroomName}）` : ''}</option>
                              {eligible.length > 0 && (
                                <optgroup label="有配課">
                                  {eligible.map(t => <option key={t.id} value={t.id}>{t.name}（{hoursOf(t, s.name, grade)}節）</option>)}
                                </optgroup>
                              )}
                              {others.length > 0 && (
                                <optgroup label="其他科任／行政（手動調整）">
                                  {others.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </optgroup>
                              )}
                            </select>
                          </label>
                        )
                      })}
                    </div>
                    {eligible.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-zinc-100">
                        {eligible.map(t => {
                          const cap = Math.floor(hoursOf(t, s.name, grade) / s.perClass)
                          const used = assignedCount(t.id, s.name, grade)
                          const over = used > cap
                          return (
                            <span key={t.id} className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${over ? 'bg-red-50 text-red-600 border-red-200' : used === cap ? 'bg-zinc-100 text-zinc-500 border-zinc-200' : 'bg-white text-zinc-500 border-zinc-200'}`}>
                              {t.name} {used}/{cap} 班{over && '（超派）'}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

      {summary.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">教師工作面小結
            <span className="text-xs font-normal text-zinc-400 ml-1">已派節數＝指派班數 × 每班節數（跨全部年級科目）</span>
          </div>
          <table className="table-base mt-2">
            <thead>
              <tr><th>教師</th><th>職務</th><th className="text-center">配課總節數</th><th className="text-center">已派節數</th><th className="text-center">差</th></tr>
            </thead>
            <tbody>
              {summary.map(t => {
                const diff = t.assigned - t.allocTotal
                return (
                  <tr key={t.id}>
                    <td className="font-medium text-zinc-800">{t.name}</td>
                    <td className="text-zinc-500 text-xs">{t.work}</td>
                    <td className="text-center">{t.allocTotal}</td>
                    <td className="text-center">{t.assigned}</td>
                    <td className={`text-center font-medium ${diff === 0 ? 'text-green-700' : diff > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
