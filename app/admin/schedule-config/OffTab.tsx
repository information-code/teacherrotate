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

// 個人不排課的類別分頁：輔導團／公假進修／其他（含行政）
type PersonalTab = 'counseling' | 'training' | 'otherx'
const PERSONAL_TABS: { key: PersonalTab; label: string }[] = [
  { key: 'counseling', label: '個人不排課（輔導團）' },
  { key: 'training', label: '個人不排課（公假進修）' },
  { key: 'otherx', label: '個人不排課（其他）' },
]
function entryInTab(p: PersonalOff, tab: PersonalTab): boolean {
  if (tab === 'otherx') return p.category === 'other' || p.category === 'admin'
  return p.category === tab
}
function defaultCategory(tab: PersonalTab): OffCategory {
  return tab === 'otherx' ? 'other' : tab
}

/** 分頁五：不排課標記。學年共同（連動該年級所有導師）與個人（依類別分頁）。
 *  標記時段＝不排該師的課：導師 → 班級課表該時段改排科任課；科任 → 該時段課表留空。 */
export default function OffTab({ config, setConfig, offTeachers, needsRefs }: Props) {
  const [sub, setSub] = useState<'grade' | PersonalTab>('grade')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<PersonalOff | null>(null)   // modal 編輯中的複本；null = 關閉
  const teachers = [...offTeachers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  const nameOf = (id: string) => offTeachers.find(t => t.id === id)?.name ?? '？'
  const workOf = (id: string) => offTeachers.find(t => t.id === id)?.work ?? ''

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
  function removeEntry(p: PersonalOff) {
    if (p.slots.length > 0 && !confirm(`刪除「${nameOf(p.teacherId)}」的${OFF_CATEGORY_LABEL[p.category]}不排課標記？`)) return
    setConfig(c => ({ ...c, personalOff: c.personalOff.filter(x => x.id !== p.id) }))
  }
  function saveDraft() {
    if (!draft || !draft.teacherId) return
    setConfig(c => ({
      ...c,
      personalOff: c.personalOff.some(p => p.id === draft.id)
        ? c.personalOff.map(p => p.id === draft.id ? draft : p)
        : [...c.personalOff, draft],
    }))
    setDraft(null)
  }

  /** 該分頁下某位教師的申報內容。 */
  function needsInTab(n: NeedsRef, tab: PersonalTab): boolean {
    if (tab === 'counseling') return n.counseling
    if (tab === 'training') return n.officialLeave
    return n.other || n.avoidChildGrades.length > 0
  }
  function declaredSlots(n: NeedsRef, tab: PersonalTab): string[] {
    if (tab === 'counseling') return n.counselingSlots
    if (tab === 'training') return n.officialLeaveSlots
    return []
  }
  function existingEntry(teacherId: string, tab: PersonalTab): PersonalOff | undefined {
    return config.personalOff.find(p => p.teacherId === teacherId && entryInTab(p, tab))
  }
  /** 帶入：依目前分頁的類別建立標記（已有同分頁項目或無時段則停用）。 */
  function importNeeds(n: NeedsRef, tab: PersonalTab) {
    const slots = declaredSlots(n, tab)
    if (!slots.length || existingEntry(n.teacherId, tab)) return
    setConfig(c => ({
      ...c,
      personalOff: [...c.personalOff, {
        id: crypto.randomUUID(), teacherId: n.teacherId, category: defaultCategory(tab),
        note: '教師申報帶入', slots: [...slots],
      }],
    }))
  }
  /** 編輯：已有項目 → 編輯該項目；沒有 → 以申報時段預填開新項目。
   *  其他分頁＝管理者認定理由可接受後手動標時段，說明留白由管理者自填。 */
  function editNeeds(n: NeedsRef, tab: PersonalTab) {
    const exist = existingEntry(n.teacherId, tab)
    setDraft(exist ? { ...exist, slots: [...exist.slots] } : {
      id: crypto.randomUUID(), teacherId: n.teacherId, category: defaultCategory(tab),
      note: tab === 'otherx' ? '' : '教師申報帶入', slots: [...declaredSlots(n, tab)],
    })
  }

  const slotText = (slots: string[]) => slots
    .map(parseSlotKey).sort((a, b) => a.day - b.day || a.period - b.period)
    .map(s => `週${'一二三四五'[s.day - 1]}第${s.period}節`).join('、')
  const allPeriods = Array.from({ length: DEFAULT_PERIODS }, (_, i) => i + 1)
  const personalTab = sub !== 'grade' ? sub : null

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        標記＝該時段不排該師的課：導師 → 班級課表該時段改排科任課；科任 → 該時段課表留空。
      </p>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setSub('grade')} className={`btn text-sm py-1 ${sub === 'grade' ? 'btn-primary' : 'btn-secondary'}`}>學年共同不排課</button>
        {PERSONAL_TABS.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)} className={`btn text-sm py-1 ${sub === t.key ? 'btn-primary' : 'btn-secondary'}`}>{t.label}</button>
        ))}
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

      {personalTab && (() => {
        const tab = personalTab
        const tabNeeds = needsRefs
          .filter(n => needsInTab(n, tab))
          .filter(n => !search || n.name.includes(search))
        const entries = config.personalOff
          .filter(p => entryInTab(p, tab))
          .filter(p => !search || nameOf(p.teacherId).includes(search))
        return (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋教師名稱…"
                className="input py-1 text-sm w-44 ml-auto" />
            </div>

            {/* 教師申報列表（攤開） */}
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">教師申報的排課需求
                <span className="text-xs font-normal text-zinc-400 ml-1">{tabNeeds.length} 位；來自配課送出精靈</span>
              </div>
              {tabNeeds.length === 0
                ? <p className="text-sm text-zinc-400 text-center py-4">{search ? '沒有符合搜尋的申報。' : '此類別無教師申報。'}</p>
                : (
                  <table className="table-base mt-2">
                    <thead><tr><th>教師</th><th>申報內容</th><th className="text-center whitespace-nowrap">操作</th></tr></thead>
                    <tbody>
                      {tabNeeds.map(n => {
                        const slots = declaredSlots(n, tab)
                        const exist = existingEntry(n.teacherId, tab)
                        return (
                          <tr key={n.teacherId}>
                            <td className="font-medium text-zinc-800 whitespace-nowrap">{n.name}</td>
                            <td className="text-xs text-zinc-600 space-y-0.5">
                              {tab === 'counseling' && <div>{n.counselingUnsure ? '時間尚不清楚' : slotText(slots) || '未填時段'}</div>}
                              {tab === 'training' && <div>{n.officialLeaveUnsure ? '時間尚不清楚' : slotText(slots) || '未填時段'}</div>}
                              {tab === 'otherx' && (
                                <>
                                  {n.avoidChildGrades.length > 0 && <div>避開子女年段：{n.avoidChildGrades.map(g => GRADE_LABEL[g]).join('、')}（於配班分頁提示）</div>}
                                  {n.other && <div className="whitespace-pre-wrap">{n.otherText || '—'}</div>}
                                </>
                              )}
                              {exist && (
                                <div className="text-green-600">
                                  ✓ 已標記不排課{exist.slots.length ? `：${slotText(exist.slots)}` : '（尚未標時段）'}
                                  {exist.note && <span className="text-zinc-400 ml-1">（{exist.note}）</span>}
                                </div>
                              )}
                            </td>
                            <td className="text-center whitespace-nowrap">
                              {tab === 'otherx'
                                ? <button onClick={() => editNeeds(n, tab)} className="btn btn-secondary text-xs py-0.5">{exist ? '編輯不排課' : '不排課'}</button>
                                : (
                                  <>
                                    <button onClick={() => editNeeds(n, tab)} className="btn btn-secondary text-xs py-0.5 mr-1">編輯</button>
                                    <button onClick={() => importNeeds(n, tab)} disabled={!slots.length || Boolean(exist)} className="btn btn-secondary text-xs py-0.5">帶入</button>
                                  </>
                                )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
            </div>

            {/* 已建立的標記 */}
            {entries.length === 0
              ? <div className="card text-sm text-zinc-400 text-center py-6">{search ? '沒有符合搜尋的標記。' : '此類別尚無標記，可由上方申報帶入／編輯或手動新增。'}</div>
              : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {entries.map(p => (
                    <div key={p.id} className="card p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-zinc-700 flex-1 min-w-0 truncate">
                          {nameOf(p.teacherId)}
                          <span className="text-xs font-normal text-zinc-400 ml-1">{workOf(p.teacherId)}</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-zinc-100 text-zinc-500 border border-zinc-200 flex-shrink-0">{OFF_CATEGORY_LABEL[p.category]}</span>
                        <button onClick={() => setDraft({ ...p, slots: [...p.slots] })} className="btn btn-secondary text-xs py-0.5 flex-shrink-0">編輯</button>
                        <button onClick={() => removeEntry(p)} className="btn btn-danger text-xs py-0.5 flex-shrink-0">刪除</button>
                      </div>
                      {p.note && <div className="text-xs text-zinc-500">{p.note}</div>}
                      <div className="text-xs text-zinc-600">{p.slots.length ? slotText(p.slots) : <span className="text-amber-600">尚未標記時段</span>}</div>
                    </div>
                  ))}
                </div>
              )}

            <div className="flex justify-end">
              <button onClick={() => setDraft({ id: crypto.randomUUID(), teacherId: '', category: defaultCategory(tab), note: '', slots: [] })}
                className="btn btn-primary text-sm py-1">＋ 新增個人不排課</button>
            </div>
          </>
        )
      })()}

      {/* 新增／編輯 modal */}
      {draft && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setDraft(null)}>
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-zinc-700">
              {config.personalOff.some(p => p.id === draft.id) ? '編輯' : '新增'}個人不排課
            </div>
            <select value={draft.teacherId} onChange={e => setDraft(d => d && { ...d, teacherId: e.target.value })} className="input py-1 text-sm w-full">
              <option value="">選擇教師…</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.work ? `（${t.work}）` : ''}</option>)}
            </select>
            <div className="flex gap-1 flex-wrap">
              {OFF_CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setDraft(d => d && { ...d, category: cat })}
                  className={`text-xs px-2 py-0.5 rounded-sm border ${draft.category === cat ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400'}`}>
                  {OFF_CATEGORY_LABEL[cat]}
                </button>
              ))}
            </div>
            <input value={draft.note} onChange={e => setDraft(d => d && { ...d, note: e.target.value })}
              placeholder={draft.category === 'other' ? '說明（類別為其他時請填）' : '補充說明（選填）'}
              className="input py-1 text-sm w-full" />
            <SlotGrid
              periods={allPeriods}
              isOn={k => draft.slots.includes(k)}
              onToggle={k => setDraft(d => d && { ...d, slots: d.slots.includes(k) ? d.slots.filter(x => x !== k) : [...d.slots, k] })}
              onLabel="休" onClass={OFF_ON_CLASS}
            />
            <div className="text-[11px] text-zinc-400 text-right">{draft.slots.length} 節不排課</div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDraft(null)} className="btn btn-secondary text-sm py-1">取消</button>
              <button onClick={saveDraft} disabled={!draft.teacherId} className="btn btn-primary text-sm py-1">儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
