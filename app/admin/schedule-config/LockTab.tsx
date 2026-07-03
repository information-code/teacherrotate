'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  SCHEDULE_DAYS, DAY_LABEL, LOCK_COLORS, LOCK_COLOR_KEYS,
  bandOf, classKey, classLabel, type ScheduleConfig, type LockType,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL, orderSubjectNames } from '@/lib/allocation'
import type { GradeSubject } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
}

/** 分頁四：鎖課設定。先建名目（名目給管理者辨識、科目顯示於課表、顏色區分），再點各班課表格子直接寫上該科目。 */
export default function LockTab({ config, setConfig, classCounts, gradeSubjects }: Props) {
  const firstGrade = GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1
  const [grade, setGrade] = useState<number>(firstGrade)
  const [active, setActive] = useState<string | null>(null)   // 選取中的名目 id；null = 未選

  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))

  function updateType(id: string, patch: Partial<LockType>) {
    setConfig(c => ({ ...c, lockTypes: c.lockTypes.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }
  function addType() {
    const usedColors = new Set(config.lockTypes.map(t => t.color))
    const color = LOCK_COLOR_KEYS.find(k => !usedColors.has(k)) ?? LOCK_COLOR_KEYS[config.lockTypes.length % LOCK_COLOR_KEYS.length]
    const id = crypto.randomUUID()
    setConfig(c => ({ ...c, lockTypes: [...c.lockTypes, { id, label: '', subject: '', color }] }))
    setActive(id)
  }
  function removeType(t: LockType) {
    const used = Object.values(config.lockCells).reduce((s, m) => s + Object.values(m).filter(v => v === t.id).length, 0)
    if (used > 0 && !confirm(`名目「${t.label || t.subject || '未命名'}」已標記 ${used} 格，刪除將一併清除標記。確定刪除？`)) return
    setConfig(c => {
      const lockCells: Record<string, Record<string, string>> = {}
      for (const [ck, m] of Object.entries(c.lockCells)) {
        const next = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== t.id))
        if (Object.keys(next).length) lockCells[ck] = next
      }
      return { ...c, lockTypes: c.lockTypes.filter(x => x.id !== t.id), lockCells }
    })
    if (active === t.id) setActive(null)
  }

  function clickCell(ck: string, slot: string) {
    const cur = config.lockCells[ck]?.[slot]
    setConfig(c => {
      const cells = { ...(c.lockCells[ck] ?? {}) }
      if (cur && (!active || cur === active)) delete cells[slot]        // 再點同名目或未選名目 → 清除
      else if (active) cells[slot] = active                             // 蓋上選取中的名目
      else return c
      const lockCells = { ...c.lockCells }
      if (Object.keys(cells).length) lockCells[ck] = cells; else delete lockCells[ck]
      return { ...c, lockCells }
    })
  }

  const typeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const count = classCounts[grade] ?? 0
  const grid = config.bands[bandOf(grade)]
  const periods = Array.from({ length: grid.periodsPerDay }, (_, i) => i + 1)

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        先新增鎖課名目（名目給管理者辨識，科目為課表格子上顯示的課名），選取名目後點各班課表格子即可鎖定該時段；
        再點一次清除。排課時被鎖的格子視為已占用，該班其他課會避開。
      </p>

      {/* 名目管理 */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-700">鎖課名目</div>
          <button onClick={addType} className="btn btn-secondary text-xs py-0.5">＋ 新增名目</button>
        </div>
        {config.lockTypes.length === 0 && <p className="text-xs text-zinc-400">尚無名目。例如：名目「本土語固定時段」、科目「本土語」。</p>}
        <div className="space-y-2">
          {config.lockTypes.map(t => {
            const col = LOCK_COLORS[t.color] ?? LOCK_COLORS.slate
            const selected = active === t.id
            return (
              <div key={t.id} className={`flex items-center gap-2 flex-wrap rounded-md border p-2 ${selected ? 'border-zinc-500 bg-zinc-50' : 'border-zinc-200'}`}>
                <button onClick={() => setActive(selected ? null : t.id)}
                  className={`btn text-xs py-0.5 flex-shrink-0 ${selected ? 'btn-primary' : 'btn-secondary'}`}>
                  {selected ? '標記中' : '選取標記'}
                </button>
                <span className="w-6 h-6 rounded-sm border flex-shrink-0" style={{ backgroundColor: col.bg, borderColor: col.border }} />
                <div className="flex gap-1 flex-shrink-0">
                  {LOCK_COLOR_KEYS.map(k => (
                    <button key={k} onClick={() => updateType(t.id, { color: k })} title={k}
                      className={`w-4 h-4 rounded-full border ${t.color === k ? 'ring-2 ring-zinc-500 ring-offset-1' : ''}`}
                      style={{ backgroundColor: LOCK_COLORS[k].bg, borderColor: LOCK_COLORS[k].border }} />
                  ))}
                </div>
                <input value={t.label} onChange={e => updateType(t.id, { label: e.target.value })}
                  placeholder="名目（管理者辨識用）" className="input py-1 text-sm flex-1 min-w-32" />
                <input value={t.subject} onChange={e => updateType(t.id, { subject: e.target.value })}
                  placeholder="科目（課表顯示）" list="lock-subject-options" className="input py-1 text-sm w-36" />
                <button onClick={() => removeType(t)} className="btn btn-danger text-xs py-0.5 flex-shrink-0">刪除</button>
              </div>
            )
          })}
        </div>
        <datalist id="lock-subject-options">
          {subjectOptions.map(s => <option key={s} value={s} />)}
        </datalist>
      </div>

      {/* 各班課表標記 */}
      <div className="flex items-center gap-2 flex-wrap">
        {GRADES.map(g => (
          <button key={g} onClick={() => setGrade(g)}
            className={`btn text-sm py-1 ${g === grade ? 'btn-primary' : 'btn-secondary'}`}>
            {GRADE_LABEL[g]}<span className="ml-1 text-[10px] opacity-70">{classCounts[g] ?? 0}班</span>
          </button>
        ))}
        {active && typeMap[active] && (
          <span className="text-xs text-zinc-500 ml-auto">
            標記中：<span className="px-1.5 py-0.5 rounded-sm border text-[11px]"
              style={{ backgroundColor: LOCK_COLORS[typeMap[active].color]?.bg, borderColor: LOCK_COLORS[typeMap[active].color]?.border, color: LOCK_COLORS[typeMap[active].color]?.text }}>
              {typeMap[active].subject || typeMap[active].label || '未命名'}
            </span>
          </span>
        )}
      </div>

      {count === 0
        ? <div className="card text-sm text-zinc-400 text-center py-6">{GRADE_LABEL[grade]}尚未於配課設定設定班級數。</div>
        : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: count }, (_, i) => {
              const ck = classKey(grade, i)
              return (
                <div key={i} className="card p-3 space-y-1">
                  <div className="text-sm font-semibold text-zinc-700">{classLabel(grade, i)}</div>
                  <table className="w-full table-fixed border-collapse text-[11px]">
                    <thead>
                      <tr>
                        <th className="w-8 text-zinc-400 font-normal"></th>
                        {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map(p => (
                        <tr key={p}>
                          <td className="text-zinc-400 text-center">{p}</td>
                          {SCHEDULE_DAYS.map(d => {
                            const k = `${d}-${p}`
                            if (!grid.teachable[k]) return <td key={d} className="p-0.5"><div className="w-full h-7 rounded-sm bg-zinc-100" /></td>
                            const tid = config.lockCells[ck]?.[k]
                            const t = tid ? typeMap[tid] : undefined
                            const col = t ? (LOCK_COLORS[t.color] ?? LOCK_COLORS.slate) : null
                            return (
                              <td key={d} className="p-0.5">
                                <button type="button" onClick={() => clickCell(ck, k)} title={t ? `${t.label || t.subject}` : undefined}
                                  className={`w-full h-7 rounded-sm border text-[10px] leading-tight truncate px-0 ${t ? '' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-400'}`}
                                  style={col ? { backgroundColor: col.bg, borderColor: col.border, color: col.text } : undefined}>
                                  {t ? (t.subject || t.label || '？') : ''}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}
