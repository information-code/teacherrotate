'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  DEFAULT_PERIODS, OFF_CATEGORIES, OFF_CATEGORY_LABEL, bandOf, parseSlotKey,
  type ScheduleConfig, type OffCategory, type PersonalOff,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import SlotGrid from './SlotGrid'
import type { NeedsRef, OffTeacher } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  offTeachers: OffTeacher[]
  needsRefs: NeedsRef[]
}

const OFF_ON_CLASS = 'bg-rose-400 text-white border-rose-400'

/** 分頁五：不排課標記。學年共同（連動該年級所有導師）與個人（輔導團／行政／進修／其他）。
 *  標記時段＝不排該師的課：導師 → 班級課表該時段改排科任課；科任 → 該時段課表留空。 */
export default function OffTab({ config, setConfig, offTeachers, needsRefs }: Props) {
  const [sub, setSub] = useState<'grade' | 'personal'>('grade')
  const teachers = [...offTeachers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  const nameOf = (id: string) => offTeachers.find(t => t.id === id)?.name ?? '？'

  // ── 學年共同 ──
  function toggleGradeSlot(g: number, k: string) {
    setConfig(c => {
      const key = String(g)
      const cur = c.gradeCommonOff[key] ?? []
      const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]
      const gradeCommonOff = { ...c.gradeCommonOff }
      if (next.length) gradeCommonOff[key] = next; else delete gradeCommonOff[key]
      return { ...c, gradeCommonOff }
    })
  }

  // ── 個人 ──
  function addEntry(init?: Partial<PersonalOff>) {
    setConfig(c => ({
      ...c,
      personalOff: [...c.personalOff, {
        id: crypto.randomUUID(), teacherId: '', category: 'counseling', note: '', slots: [], ...init,
      }],
    }))
  }
  function updateEntry(id: string, patch: Partial<PersonalOff>) {
    setConfig(c => ({ ...c, personalOff: c.personalOff.map(p => p.id === id ? { ...p, ...patch } : p) }))
  }
  function removeEntry(p: PersonalOff) {
    if (p.slots.length > 0 && !confirm(`刪除「${nameOf(p.teacherId)}」的${OFF_CATEGORY_LABEL[p.category]}不排課標記？`)) return
    setConfig(c => ({ ...c, personalOff: c.personalOff.filter(x => x.id !== p.id) }))
  }
  function toggleEntrySlot(id: string, k: string) {
    setConfig(c => ({
      ...c,
      personalOff: c.personalOff.map(p => p.id !== id ? p : {
        ...p, slots: p.slots.includes(k) ? p.slots.filter(x => x !== k) : [...p.slots, k],
      }),
    }))
  }

  /** 帶入某位老師申報的排課需求（輔導團 → 輔導團；公假進修 → 進修）。已有同類別項目則跳過。 */
  function importNeeds(n: NeedsRef) {
    const has = (cat: OffCategory) => config.personalOff.some(p => p.teacherId === n.teacherId && p.category === cat)
    const additions: PersonalOff[] = []
    if (n.counseling && n.counselingSlots.length && !has('counseling')) {
      additions.push({ id: crypto.randomUUID(), teacherId: n.teacherId, category: 'counseling', note: '教師申報帶入', slots: [...n.counselingSlots] })
    }
    if (n.officialLeave && n.officialLeaveSlots.length && !has('training')) {
      additions.push({ id: crypto.randomUUID(), teacherId: n.teacherId, category: 'training', note: '公假進修（教師申報帶入）', slots: [...n.officialLeaveSlots] })
    }
    if (!additions.length) return
    setConfig(c => ({ ...c, personalOff: [...c.personalOff, ...additions] }))
  }
  function importable(n: NeedsRef) {
    const has = (cat: OffCategory) => config.personalOff.some(p => p.teacherId === n.teacherId && p.category === cat)
    return (n.counseling && n.counselingSlots.length > 0 && !has('counseling'))
      || (n.officialLeave && n.officialLeaveSlots.length > 0 && !has('training'))
  }
  const slotText = (slots: string[]) => slots
    .map(parseSlotKey).sort((a, b) => a.day - b.day || a.period - b.period)
    .map(s => `週${'一二三四五'[s.day - 1]}第${s.period}節`).join('、')

  const allPeriods = Array.from({ length: DEFAULT_PERIODS }, (_, i) => i + 1)

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        標記＝該時段不排該師的課：導師 → 班級課表該時段改排科任課；科任 → 該時段課表留空。
      </p>

      <div className="flex gap-2">
        <button onClick={() => setSub('grade')} className={`btn text-sm py-1 ${sub === 'grade' ? 'btn-primary' : 'btn-secondary'}`}>學年共同不排課</button>
        <button onClick={() => setSub('personal')} className={`btn text-sm py-1 ${sub === 'personal' ? 'btn-primary' : 'btn-secondary'}`}>個人不排課</button>
      </div>

      {sub === 'grade' && (
        <>
          <p className="text-xs text-zinc-400">連動該年級（學年）所有導師：標記的時段整個學年共同不排課（例如學年會議、共同備課）。</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {GRADES.map(g => {
              const grid = config.bands[bandOf(g)]
              const selected = new Set(config.gradeCommonOff[String(g)] ?? [])
              return (
                <div key={g} className="card p-3 space-y-1">
                  <div className="text-sm font-semibold text-zinc-700">{GRADE_LABEL[g]}
                    <span className="text-xs font-normal text-zinc-400 ml-1">{selected.size > 0 ? `${selected.size} 節不排課` : '無標記'}</span>
                  </div>
                  <SlotGrid
                    periods={Array.from({ length: grid.periodsPerDay }, (_, i) => i + 1)}
                    enabled={k => Boolean(grid.teachable[k])}
                    isOn={k => selected.has(k)}
                    onToggle={k => toggleGradeSlot(g, k)}
                    onLabel="休" onClass={OFF_ON_CLASS}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}

      {sub === 'personal' && (
        <>
          {needsRefs.length > 0 && (
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">教師申報的排課需求
                <span className="text-xs font-normal text-zinc-400 ml-1">來自配課送出精靈；可一鍵帶入下方個人不排課</span>
              </div>
              <table className="table-base mt-2">
                <thead><tr><th>教師</th><th>申報內容</th><th className="text-center">帶入</th></tr></thead>
                <tbody>
                  {needsRefs.map(n => (
                    <tr key={n.teacherId}>
                      <td className="font-medium text-zinc-800 whitespace-nowrap">{n.name}</td>
                      <td className="text-xs text-zinc-600 space-y-0.5">
                        {n.counseling && <div>輔導團：{n.counselingUnsure ? '時間尚不清楚' : slotText(n.counselingSlots) || '未填時段'}</div>}
                        {n.officialLeave && <div>公假進修：{n.officialLeaveUnsure ? '時間尚不清楚' : slotText(n.officialLeaveSlots) || '未填時段'}</div>}
                        {n.avoidChildGrades.length > 0 && <div>避開子女年段：{n.avoidChildGrades.map(g => GRADE_LABEL[g]).join('、')}（排課時避免授課，非不排課時段）</div>}
                        {n.other && <div>其他：{n.otherText || '—'}</div>}
                      </td>
                      <td className="text-center">
                        <button onClick={() => importNeeds(n)} disabled={!importable(n)} className="btn btn-secondary text-xs py-0.5">
                          {importable(n) ? '帶入' : '已帶入／無時段'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-400">類別：輔導團／行政／進修／其他，不連動學年，逐位教師標記。</p>
            <button onClick={() => addEntry()} className="btn btn-secondary text-xs py-0.5">＋ 新增個人不排課</button>
          </div>

          {config.personalOff.length === 0
            ? <div className="card text-sm text-zinc-400 text-center py-6">尚無個人不排課，可由上方申報帶入或手動新增。</div>
            : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {config.personalOff.map(p => (
                  <div key={p.id} className="card p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={p.teacherId} onChange={e => updateEntry(p.id, { teacherId: e.target.value })} className="input py-1 text-sm flex-1 min-w-0">
                        <option value="">選擇教師…</option>
                        {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.work ? `（${t.work}）` : ''}</option>)}
                      </select>
                      <button onClick={() => removeEntry(p)} className="btn btn-danger text-xs py-0.5 flex-shrink-0">刪除</button>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {OFF_CATEGORIES.map(cat => (
                        <button key={cat} onClick={() => updateEntry(p.id, { category: cat })}
                          className={`text-xs px-2 py-0.5 rounded-sm border ${p.category === cat ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'}`}>
                          {OFF_CATEGORY_LABEL[cat]}
                        </button>
                      ))}
                    </div>
                    <input value={p.note} onChange={e => updateEntry(p.id, { note: e.target.value })}
                      placeholder={p.category === 'other' ? '說明（類別為其他時請填）' : '補充說明（選填）'}
                      className="input py-1 text-sm w-full" />
                    <SlotGrid
                      periods={allPeriods}
                      isOn={k => p.slots.includes(k)}
                      onToggle={k => toggleEntrySlot(p.id, k)}
                      onLabel="休" onClass={OFF_ON_CLASS}
                    />
                    <div className="text-[11px] text-zinc-400 text-right">{p.slots.length} 節不排課</div>
                  </div>
                ))}
              </div>
            )}
        </>
      )}
    </div>
  )
}
