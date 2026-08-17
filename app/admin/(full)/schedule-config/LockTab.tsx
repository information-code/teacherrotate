'use client'

import { useState, useMemo, type Dispatch, type SetStateAction } from 'react'
import {
  SCHEDULE_DAYS, DAY_LABEL, LOCK_COLORS, LOCK_COLOR_KEYS,
  bandOf, classKey, classLabel, parseSlotKey, deriveNativeSessions, type ScheduleConfig, type LockType,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL, orderSubjectNames } from '@/lib/allocation'
import type { GradeSubject } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  extraCourses: { lang: string; grade: number; hours: number }[]                 // 語別課（配課設定「設定二」）
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>        // 各師語別配課節數
  teacherNames: Record<string, string>
}

/** 分頁四：鎖課設定。先建名目（名目給管理者辨識、科目顯示於課表、顏色區分），再點各班課表格子直接寫上該科目。 */
export default function LockTab({ config, setConfig, classCounts, gradeSubjects, extraCourses, hoursByTeacher, teacherNames }: Props) {
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
    setConfig(c => ({ ...c, lockTypes: [...c.lockTypes, { id, label: '', subject: '', color, isNative: false }] }))
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
                {/* 純下拉；本土語只該有一個鎖課名目：已被其他名目用走時，本列不再列出 */}
                <select value={t.subject} onChange={e => updateType(t.id, { subject: e.target.value, isNative: e.target.value === '本土語' })}
                  className="input py-1 text-sm w-36">
                  <option value="">選科目…</option>
                  {!subjectOptions.includes(t.subject) && t.subject && <option value={t.subject}>{t.subject}</option>}
                  {subjectOptions
                    .filter(s => s !== '本土語' || t.subject === '本土語' || !config.lockTypes.some(x => x.id !== t.id && x.subject === '本土語'))
                    .map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => removeType(t)} className="btn btn-danger text-xs py-0.5 flex-shrink-0">刪除</button>
              </div>
            )
          })}
        </div>
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

      {/* ── 本土語場次（自動推導：年級 × 語別 × 本土語鎖課時段）── */}
      <NativeSessionsPanel config={config} setConfig={setConfig} extraCourses={extraCourses} hoursByTeacher={hoursByTeacher} teacherNames={teacherNames} />
    </div>
  )
}

/** 本土語場次面板：每個本土語時段都是候選場次，課務組點狀態——實體（老師到校，耗 1 節配課）／直播（共學不具名）／不開（此時段沒有該語別學生）。
 *  一致性：實體場次數 ＝ 該語別老師配課節數；不等就黃字。存於 config.nativeLang.states（實體＝不存）。 */
function NativeSessionsPanel({ config, setConfig, extraCourses, hoursByTeacher, teacherNames }: {
  config: ScheduleConfig; setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  extraCourses: { lang: string; grade: number; hours: number }[]
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>
  teacherNames: Record<string, string>
}) {
  const derived = useMemo(() => deriveNativeSessions({ config, extraCourses, hoursByTeacher }), [config, extraCourses, hoursByTeacher])
  const roomNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const z of config.roomZones) for (const r of z.rooms) if (r.kind === 'native') m[r.id] = (r.name || '本土語言教室') + r.no
    return m
  }, [config])
  const slotZh = (sl: string) => { const { day, period } = parseSlotKey(sl); return `${DAY_LABEL[day]}第${period}節` }
  const byGrade = new Map<number, Map<string, typeof derived.sessions>>()
  for (const s of derived.sessions) {
    const g = byGrade.get(s.grade) ?? new Map<string, typeof derived.sessions>()
    const arr = g.get(s.lang) ?? []
    arr.push(s); g.set(s.lang, arr); byGrade.set(s.grade, g)
  }
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
  const slotCount = (g: number) => {
    const cnt: Record<string, number> = {}
    for (const [ck2, cells] of Object.entries(config.lockCells)) {
      if (Number(ck2.split('-')[0]) !== g) continue
      for (const [sl, tid] of Object.entries(cells)) if (nativeTypeIds.has(tid)) cnt[sl] = (cnt[sl] ?? 0) + 1
    }
    return cnt
  }
  const hoursOf = (lang: string, g: number) => Object.values(hoursByTeacher).reduce((s2, m) => s2 + (Number(m[lang]?.[String(g)]) || 0), 0)
  function setState(key: string, st: 'physical' | 'stream' | 'cancelled') {
    setConfig(c => {
      const states = { ...c.nativeLang.states }
      if (st === 'physical') delete states[key]; else states[key] = st
      return { ...c, nativeLang: { states } }
    })
  }
  const grades = Array.from(byGrade.keys()).sort()
  if (grades.length === 0) return null
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-semibold text-zinc-700">本土語場次</span>
        <span className="text-xs text-zinc-400">
          由「該年級本土語鎖課時段 × 語別課」自動推導；語別學生在自己班上閩南語的那一節出來集合上課。
          每個時段點狀態：<b>實體</b>＝老師到校（耗 1 節配課）、<b>直播</b>＝共學不具名、<b>不開</b>＝該時段沒有這個語別的學生。
        </span>
      </div>
      <div className="p-3 space-y-3">
        {grades.map(g => {
          const langs = byGrade.get(g)!
          const cnt = slotCount(g)
          const slots = Array.from(new Set(Array.from(langs.values()).flat().map(s => s.slot)))
            .sort((a, b) => { const A = parseSlotKey(a), B = parseSlotKey(b); return A.day - B.day || A.period - B.period })
          return (
            <div key={g}>
              <div className="text-xs font-semibold text-zinc-700 mb-1">{GRADE_LABEL[g]}
                <span className="ml-2 font-normal text-zinc-400">本土語鎖課時段：{slots.map(sl => `${slotZh(sl)}×${cnt[sl] ?? 0}班`).join('、') || '尚未鎖課'}</span>
              </div>
              <table className="table-base no-hover">
                <thead><tr><th className="min-w-[8rem]">語別</th><th className="w-20 text-center">配課</th>{slots.map(sl => <th key={sl} className="text-center">{slotZh(sl)}</th>)}<th className="w-24 text-center">檢核</th></tr></thead>
                <tbody>
                  {Array.from(langs.entries()).map(([lang, list]) => {
                    const hours = hoursOf(lang, g)
                    const physical = list.filter(s => s.state === 'physical').length
                    const ok = physical === hours
                    return (
                      <tr key={lang}>
                        <td className="font-medium text-zinc-800">{lang}</td>
                        <td className="text-center text-zinc-600">{hours} 節</td>
                        {slots.map(sl => {
                          const s = list.find(x => x.slot === sl)
                          if (!s) return <td key={sl} className="text-center text-zinc-300">—</td>
                          const key = `${sl}|${lang}|${g}`
                          const cls = s.state === 'physical' ? 'bg-emerald-600 text-white border-emerald-600' : s.state === 'stream' ? 'bg-sky-600 text-white border-sky-600' : 'bg-zinc-100 text-zinc-500 border-zinc-300'
                          const next = s.state === 'physical' ? 'stream' : s.state === 'stream' ? 'cancelled' : 'physical'
                          const sub = s.state === 'physical'
                            ? (s.teacherId ? (teacherNames[s.teacherId] ?? '？') : '未配課') + (s.roomId ? `・${roomNames[s.roomId]}` : '・教室不足')
                            : s.state === 'stream' ? '共學' : ''
                          const bad = s.state === 'physical' && (!s.teacherId || !s.roomId)
                          return (
                            <td key={sl} className="text-center">
                              <button onClick={() => setState(key, next)} title="點擊切換：實體 → 直播 → 不開"
                                className={`text-xs px-2 py-0.5 rounded-sm border ${cls}`}>{s.state === 'physical' ? '實體' : s.state === 'stream' ? '直播' : '不開'}</button>
                              {sub && <div className={`text-[10px] mt-0.5 ${bad ? 'text-red-500' : 'text-zinc-400'}`}>{sub}</div>}
                            </td>
                          )
                        })}
                        <td className={`text-center text-xs ${ok ? 'text-emerald-700' : 'text-amber-600'}`}>{ok ? '✓' : `實體 ${physical}／配 ${hours}`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}
