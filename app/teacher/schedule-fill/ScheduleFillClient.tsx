'use client'

import { useEffect, useRef, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL } from '@/lib/scheduling'
import { orderSubjectNames } from '@/lib/allocation'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'
import type { FixedCell } from './page'

interface Props {
  year: number
  classLabel: string
  periodsPerDay: number
  teachable: string[]
  fixed: Record<string, FixedCell>
  breakdown: Record<string, number>       // 科目 → 應排節數
  initialCells: Record<string, string>    // slotKey → 科目
  confirmedAt: string | null
  finalized: boolean
}

/** 教師端：導師排課選填。把自己的配課填入班級課表留白格，全部填完後確認送出。 */
export default function ScheduleFillClient({ year, classLabel, periodsPerDay, teachable, fixed, breakdown, initialCells, confirmedAt, finalized }: Props) {
  const [cells, setCells] = useState<Record<string, string>>(initialCells)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<boolean>(Boolean(confirmedAt))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [confirming, setConfirming] = useState(false)
  const readOnly = confirmed || finalized

  const subjects = orderSubjectNames(Object.keys(breakdown))
  const placedCount = (s: string) => Object.values(cells).filter(v => v === s).length
  const remaining = (s: string) => (breakdown[s] ?? 0) - placedCount(s)
  const allDone = subjects.every(s => remaining(s) === 0)
  const teachSet = new Set(teachable)

  // 自動儲存（debounce）
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    if (readOnly) return
    setSaveStatus('saving')
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/teacher/schedule-fill', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, cells }),
        })
        setSaveStatus(res.ok ? 'saved' : 'error')
      } catch { setSaveStatus('error') }
    }, 800)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells])

  useUnsavedGuard(saveStatus === 'saving' || saveStatus === 'error')

  function clickCell(k: string) {
    if (readOnly) return
    if (fixed[k] || !teachSet.has(k)) return
    setCells(prev => {
      const next = { ...prev }
      if (next[k]) { delete next[k]; return next }          // 點已填的格 → 移除
      if (selected && remaining(selected) > 0) next[k] = selected
      return next
    })
  }

  async function confirmSubmit() {
    if (!allDone) return
    if (!confirm('確認送出後即不可自行修改（如需調整請洽教務處）。確定送出？')) return
    setConfirming(true)
    try {
      const res = await fetch('/api/teacher/schedule-fill', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, cells, confirm: true }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? '送出失敗'); return }
      setConfirmed(true)
    } finally { setConfirming(false) }
  }

  const periods = Array.from({ length: periodsPerDay }, (_, i) => i + 1)

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">排課選填 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度・{classLabel}</span></h2>
          <p className="text-xs text-zinc-400">
            灰色＝科任課與鎖課（不可動）；點選下方科目後，點空白格填入自己的課，再點一次移除。全部填完才能確認送出。
          </p>
        </div>
        <span className="text-xs flex-shrink-0">
          {saveStatus === 'saving' && <span className="text-zinc-500">儲存中…</span>}
          {saveStatus === 'saved' && <span className="text-green-600">✓ 已自動儲存</span>}
          {saveStatus === 'error' && <span className="text-red-600">⚠ 儲存失敗，請勿離開</span>}
        </span>
      </div>

      {confirmed && (
        <div className="card bg-green-50 border-green-200 text-sm text-green-700 py-3">
          ✓ 已確認送出{confirmedAt ? `（${new Date(confirmedAt).toLocaleString('zh-TW')}）` : ''}。如需修改請洽教務處。
        </div>
      )}

      {/* 科目籤 */}
      {!readOnly && (
        <div className="flex gap-2 flex-wrap">
          {subjects.map(s => {
            const r = remaining(s)
            const on = selected === s
            return (
              <button key={s} onClick={() => setSelected(on ? null : s)} disabled={r <= 0}
                className={`text-sm px-2.5 py-1 rounded-sm border ${on
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : r <= 0
                    ? 'bg-zinc-100 text-zinc-400 border-zinc-200'
                    : 'bg-white text-zinc-700 border-zinc-300 hover:border-emerald-400'}`}>
                {s} <span className="text-xs opacity-75">{placedCount(s)}/{breakdown[s]}</span>{r <= 0 && ' ✓'}
              </button>
            )
          })}
        </div>
      )}

      {/* 課表 */}
      <div className="card p-3">
        <table className="w-full table-fixed border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="w-7 text-zinc-400 font-normal"></th>
              {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => (
              <tr key={p}>
                <td className="text-zinc-400 text-center">{p}</td>
                {SCHEDULE_DAYS.map(d => {
                  const k = `${d}-${p}`
                  const f = fixed[k]
                  if (f) {
                    return (
                      <td key={d} className="p-0.5">
                        <div className={`h-11 rounded-sm border px-0.5 flex flex-col items-center justify-center text-center leading-tight overflow-hidden ${f.kind === 'lock' ? 'bg-zinc-200 border-zinc-300 text-zinc-600' : f.biweekly ? 'bg-violet-50 border-violet-200 text-violet-800' : 'bg-zinc-100 border-zinc-200 text-zinc-500'}`}>
                          <span className="truncate w-full font-medium">{f.subject}</span>
                          {f.teacherName && <span className="truncate w-full text-[9px] opacity-70">{f.teacherName}</span>}
                          {f.biweekly && <span className="text-[8px] opacity-70">{f.biweekly === 'odd' ? '單週（雙週歸您）' : '雙週（單週歸您）'}</span>}
                        </div>
                      </td>
                    )
                  }
                  if (!teachSet.has(k)) return <td key={d} className="p-0.5"><div className="h-11 rounded-sm bg-zinc-50" /></td>
                  const mine = cells[k]
                  return (
                    <td key={d} className="p-0.5">
                      <button type="button" onClick={() => clickCell(k)} disabled={readOnly}
                        className={`w-full h-11 rounded-sm border text-[11px] leading-tight ${mine
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-medium'
                          : 'bg-white border-dashed border-zinc-300 text-zinc-300 hover:border-emerald-400'}`}>
                        {mine ?? (readOnly ? '' : '＋')}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-zinc-400">
            {allDone ? '✓ 全部配課已填入' : `尚餘 ${subjects.reduce((s2, s) => s2 + Math.max(0, remaining(s)), 0)} 節未填`}
          </span>
          <button onClick={confirmSubmit} disabled={!allDone || confirming || saveStatus === 'saving'} className="btn-primary text-sm">
            {confirming ? '送出中…' : '確認送出'}
          </button>
        </div>
      )}
    </div>
  )
}
