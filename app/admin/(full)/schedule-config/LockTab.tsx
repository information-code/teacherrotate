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
  year: number
}
/** 移動鎖課的檢查結果（伺服器算的，含目標格上的課與本土語場次影響） */
interface MoveInfo {
  classLabel: string; lockLabel: string; from: string; to: string
  problems: string[]
  sitting: { id: string; subject: string; teacherName: string; size: number } | null
  hrMoved: string | null
  hrConfirmed: boolean
  native: { newSession: boolean; sameGradeSlots: string[] } | null
}

/** 分頁四：鎖課設定。先建名目（名目給管理者辨識、科目顯示於課表、顏色區分），再點各班課表格子直接寫上該科目。 */
export default function LockTab({ config, setConfig, classCounts, gradeSubjects, year }: Props) {
  const firstGrade = GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1
  const [grade, setGrade] = useState<number>(firstGrade)
  const [active, setActive] = useState<string | null>(null)   // 選取中的名目 id；null = 未選
  // ── 移動鎖課：整格換位置。目標格若有科任課就和它對調（鎖課讓出來的那格正好給它），
  //    所以不必先找空白格。設定與課表由伺服器一次寫完。 ──
  const [moveMode, setMoveMode] = useState(false)
  const [moveFrom, setMoveFrom] = useState<{ ck: string; slot: string } | null>(null)
  const [moveInfo, setMoveInfo] = useState<MoveInfo | null>(null)
  const [moveErr, setMoveErr] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)
  const slotZh = (s: string) => `${DAY_LABEL[Number(s.split('-')[0])]}第${s.split('-')[1]}節`

  async function pickDest(ck: string, slot: string) {
    if (!moveFrom || moveFrom.ck !== ck) { setMoveErr('請點同一個班的格子'); return }
    if (moveFrom.slot === slot) { setMoveFrom(null); return }
    setMoveBusy(true); setMoveErr(''); setMoveInfo(null)
    try {
      const res = await fetch(`/api/admin/lock-move?year=${year}&classKey=${ck}&from=${moveFrom.slot}&to=${slot}`)
      const d = await res.json()
      if (!res.ok) { setMoveErr(d.error ?? '檢查失敗'); return }
      setMoveInfo(d)
    } finally { setMoveBusy(false) }
  }
  async function doMove() {
    if (!moveFrom || !moveInfo) return
    setMoveBusy(true); setMoveErr('')
    try {
      const res = await fetch('/api/admin/lock-move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, classKey: moveFrom.ck, from: moveInfo.from, to: moveInfo.to }),
      })
      const d = await res.json()
      if (!res.ok) { setMoveErr(d.error ?? '移動失敗'); return }
      alert(`已移動。${d.moved ? `「${d.moved}」已對調到 ${slotZh(moveInfo.from)}。` : ''}`
        + `${d.hrMoved ? `\n導師填的「${d.hrMoved}」已搬到 ${slotZh(moveInfo.from)}——請通知他重新整理。` : ''}`
        + `${d.native?.newSession ? '\n⚠ 這是該年級新的本土語時段，會多出一場場次——請到「6 本土語場次」指定老師與教室。' : ''}`)
      setMoveFrom(null); setMoveInfo(null); setMoveMode(false)
      window.location.reload()   // 設定與課表都被伺服器改過，重新載入才是最新的
    } finally { setMoveBusy(false) }
  }

  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))

  function updateType(id: string, patch: Partial<LockType>) {
    setConfig(c => ({ ...c, lockTypes: c.lockTypes.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }
  function addType() {
    const usedColors = new Set(config.lockTypes.map(t => t.color))
    const color = LOCK_COLOR_KEYS.find(k => !usedColors.has(k)) ?? LOCK_COLOR_KEYS[config.lockTypes.length % LOCK_COLOR_KEYS.length]
    const id = crypto.randomUUID()
    setConfig(c => ({ ...c, lockTypes: [...c.lockTypes, { id, label: '', subject: '', color, isNative: false, byHomeroom: null }] }))
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
    if (moveMode) {
      if (!moveFrom) { if (cur) { setMoveFrom({ ck, slot }); setMoveErr(''); setMoveInfo(null) } else setMoveErr('請先點要移動的那一格鎖課') ; return }
      void pickDest(ck, slot); return
    }
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
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setMoveMode(m => !m); setMoveFrom(null); setMoveInfo(null); setMoveErr('') }}
          className={`btn text-xs py-0.5 ${moveMode ? 'btn-primary' : 'btn-secondary'}`}
          title="把已鎖的一格換到別格；目標格若有科任課會自動對調，設定與課表一次寫完">
          {moveMode ? '✕ 結束移動鎖課' : '🔀 移動鎖課'}
        </button>
        {moveMode && (
          <span className="text-xs text-amber-700">
            {!moveFrom ? '點一下要移動的那一格鎖課' : `已選 ${slotZh(moveFrom.slot)}——再點同一班的目標格`}
          </span>
        )}
        {moveErr && <span className="text-xs text-red-600">{moveErr}</span>}
        {moveBusy && <span className="text-xs text-zinc-400">檢查中…</span>}
      </div>
      {/* 檢查結果用 modal：原本印在頁面最上方，點完格子還要捲回去看，
          而且捲上去之後就看不到自己點了哪一格。 */}
      {moveInfo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !moveBusy && setMoveInfo(null)}>
          <div className="card w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-semibold">移動鎖課</h3>
              <button type="button" onClick={() => setMoveInfo(null)} disabled={moveBusy}
                className="ml-auto text-zinc-400 hover:text-zinc-700 text-sm">✕</button>
            </div>
            <div className="text-sm font-medium text-zinc-800 bg-zinc-50 border border-zinc-200 rounded-sm px-3 py-2">
              {moveInfo.classLabel}　{moveInfo.lockLabel}
              <div className="text-zinc-500 text-xs mt-0.5">{slotZh(moveInfo.from)}　→　{slotZh(moveInfo.to)}</div>
            </div>
            {moveInfo.sitting
              ? <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
                  {slotZh(moveInfo.to)} 目前是「{moveInfo.sitting.subject}（{moveInfo.sitting.teacherName}）」——
                  會和鎖課<b>對調</b>，那堂課移到 {slotZh(moveInfo.from)}。班上佔用的格子總數不變。
                </div>
              : moveInfo.hrMoved
                ? <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">
                    {slotZh(moveInfo.to)} 是導師填的「{moveInfo.hrMoved}」——會和鎖課<b>對調</b>，搬到 {slotZh(moveInfo.from)}。
                    他要填的節數不變，但<b>請通知他重新整理</b>{moveInfo.hrConfirmed ? '（這一班已確認送出）' : ''}。
                  </div>
                : <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-sm px-3 py-2">
                    {slotZh(moveInfo.to)} 是空的，直接移過去；{slotZh(moveInfo.from)} 會變成導師可填的空格。
                  </div>}
            {moveInfo.native && (moveInfo.native.newSession
              ? <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
                  ⚠ 這是該年級<b>新的</b>本土語時段（既有：{moveInfo.native.sameGradeSlots.map(slotZh).join('、') || '無'}），
                  會多出一場場次，需要到「6 本土語場次」指定老師與教室。
                </div>
              : <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-sm px-3 py-2">
                  ✓ 併入該年級既有的本土語時段，場次數不變。
                </div>)}
            {moveInfo.problems.length > 0 && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2 space-y-0.5">
                <div className="font-medium">不能移動：</div>
                {moveInfo.problems.map((x, i2) => <div key={i2}>・{x}</div>)}
              </div>
            )}
            {moveErr && <div className="text-xs text-red-600">{moveErr}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setMoveInfo(null)} disabled={moveBusy} className="btn btn-secondary text-sm">重選目標</button>
              <button type="button" onClick={doMove} disabled={moveBusy || moveInfo.problems.length > 0}
                className="btn btn-primary text-sm">{moveBusy ? '處理中…' : '確認移動'}</button>
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-zinc-400">
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
                {/* 由導師授課？影響導師規則（不連四、上午下限、每日上限、成塊）。自動＝科目在該班導師配課裡就算；
                    只有科目掛班級活動、實際由教練上的「游泳」這類特例才需手動設否 */}
                <label className="flex items-center gap-1 text-xs text-zinc-500 flex-shrink-0" title="這節課是不是導師本人在上。自動：科目在導師配課裡（國語、數學、班級活動…）就算導師課；游泳等由教練上的請設「否」">
                  導師上
                  <select value={t.byHomeroom === null ? 'auto' : t.byHomeroom ? 'yes' : 'no'}
                    onChange={e => updateType(t.id, { byHomeroom: e.target.value === 'auto' ? null : e.target.value === 'yes' })}
                    className="input py-0.5 text-xs w-16">
                    <option value="auto">自動</option>
                    <option value="yes">是</option>
                    <option value="no">否</option>
                  </select>
                </label>
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
                <div key={i} className={`card p-3 space-y-1 ${moveMode && moveFrom && moveFrom.ck !== ck ? 'opacity-40' : ''}`}>
                  <div className="text-sm font-semibold text-zinc-700">
                    {classLabel(grade, i)}
                    {moveMode && moveFrom?.ck === ck && <span className="ml-2 text-[10px] font-normal text-amber-600">移動中</span>}
                  </div>
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
                            // 移動模式的點擊回饋：選中的來源格要一眼看得出來，
                            // 不能選的格子要看起來就不能選——否則點了沒反應會以為壞掉。
                            const isSrc = moveMode && moveFrom?.ck === ck && moveFrom.slot === k
                            const isDst = moveMode && moveInfo != null && moveFrom?.ck === ck && moveInfo.to === k
                            const sameClass = moveMode && moveFrom?.ck === ck
                            const selectable = moveMode && (moveFrom ? sameClass : Boolean(t))
                            const mv = !moveMode ? ''
                              : isSrc ? ' ring-2 ring-amber-500 ring-offset-1 animate-pulse'
                              : isDst ? ' ring-2 ring-sky-500 ring-offset-1'
                              : selectable ? ' hover:ring-2 hover:ring-sky-400 cursor-pointer'
                              : ' opacity-30 cursor-not-allowed'
                            return (
                              <td key={d} className="p-0.5">
                                <button type="button" onClick={() => clickCell(ck, k)} disabled={moveMode && !selectable}
                                  title={moveMode
                                    ? (isSrc ? '移動中——再點一次取消' : selectable ? (moveFrom ? '點這裡當目標' : t ? '點這裡開始移動' : undefined) : '這一格不能選')
                                    : (t ? `${t.label || t.subject}` : undefined)}
                                  className={`relative w-full h-7 rounded-sm border text-[10px] leading-tight truncate px-0 ${t ? '' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-400'}${mv}`}
                                  style={col ? { backgroundColor: col.bg, borderColor: col.border, color: col.text } : undefined}>
                                  {t ? (t.subject || t.label || '？') : ''}
                                  {isSrc && <span className="absolute -top-1 -right-1 text-[8px] bg-amber-500 text-white rounded-full w-3 h-3 leading-3">↦</span>}
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
