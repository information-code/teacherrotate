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
  pairCells: Record<string, 'odd' | 'even'>   // 單雙週配對格：可填、同科整塊兩節（扣 2 節籤），值＝導師課週型
  breakdown: Record<string, number>       // 科目 → 應排節數
  initialCells: Record<string, string>    // slotKey → 科目
  confirmedAt: string | null
  finalized: boolean
  lockMessage?: string
  /** 填過但那一格已被課務組改成科任課（或改成不可排課）的格子 */
  staleCells: { slot: string; subject: string; tookBy: string }[]
  /** 這些配課節數已由固定課（鎖課）排定，不需要再填 */
  lockedNote: { subject: string; n: number; by: string }[]
}

/** 教師端：導師排課選填。把自己的配課填入班級課表留白格，全部填完後確認送出。 */
export default function ScheduleFillClient({ year, classLabel, periodsPerDay, teachable, fixed, pairCells, breakdown, initialCells, confirmedAt, finalized, lockMessage, staleCells, lockedNote }: Props) {
  // 被蓋掉的格先拿掉：留著會被算進節數，導師會以為填滿了
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const c = { ...initialCells }
    for (const x of staleCells) delete c[x.slot]
    return c
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<boolean>(Boolean(confirmedAt))
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [confirming, setConfirming] = useState(false)
  /** 存不進去而且重試也沒用的狀況（填課被收回、已定案、那一格被課務組佔走）：
   *  伺服器回的原因要原封不動給導師看，並且立刻停手，不要讓他繼續填一堆存不進去的東西。 */
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null)
  const readOnly = confirmed || finalized || blockedMsg !== null

  const subjects = orderSubjectNames(Object.keys(breakdown))
  // 配對格（單雙週區塊）填一格＝整塊兩節，計 2 節
  const weightOf = (k: string) => (pairCells[k] ? 2 : 1)
  const placedCount = (s: string) => Object.entries(cells).filter(([, v]) => v === s).reduce((n, [k]) => n + weightOf(k), 0)
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
        if (res.ok) { setSaveStatus('saved'); return }
        const d = await res.json().catch(() => ({}))
        // 400／403＝狀況變了，重試不會成功：停下來講清楚
        if (res.status === 403 || res.status === 400) { setBlockedMsg(String(d.error ?? '目前無法儲存')); setSaveStatus('idle') }
        else setSaveStatus('error')
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
      if (selected && remaining(selected) >= weightOf(k)) next[k] = selected   // 配對格需剩 2 節
      return next
    })
  }

  /** 取消確認：填課還開著就讓導師自己解鎖，不必請教務處退回。 */
  async function cancelConfirm() {
    if (!confirm('取消確認後即可繼續修改，改完記得再按一次「確認送出」。確定取消確認？')) return
    setConfirming(true)
    try {
      const res = await fetch('/api/teacher/schedule-fill', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, unconfirm: true }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? '取消失敗'); return }
      setConfirmed(false)
    } finally { setConfirming(false) }
  }
  /** 一鍵清空：只清自己填的，科任課與鎖課不動。 */
  function clearAll() {
    const n = Object.keys(cells).length
    if (!n || !confirm(`清空您已填的 ${n} 格？（科任課與鎖課不受影響）`)) return
    setCells({})
    setSelected(null)
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
            灰色＝科任課與鎖課（不可動）；點下方科目後，點空白格填入，再點一次移除。全部填完才能按「確認送出」。
            紫色格是隔週輪流的：那一節單週上視覺藝術、雙週換您上（或相反）。輪到您的那格<b>一次上兩節</b>，
            所以填一格會扣掉 2 節配課，而且兩節要同一科。
          </p>
        </div>
        <span className="text-xs flex-shrink-0">
          {saveStatus === 'saving' && <span className="text-zinc-500">儲存中…</span>}
          {saveStatus === 'saved' && <span className="text-green-600">✓ 已自動儲存</span>}
          {saveStatus === 'error' && <span className="text-red-600">⚠ 儲存失敗，請勿離開</span>}
        </span>
      </div>

      {confirmed && (
        <div className="card bg-green-50 border-green-200 text-sm text-green-700 py-3 flex items-center gap-3 flex-wrap">
          <span>✓ 已確認送出{confirmedAt ? `（${new Date(confirmedAt).toLocaleString('zh-TW')}）` : ''}。</span>
          {finalized
            ? <span className="text-zinc-500">{lockMessage ?? '課表已公告，如需修改請洽教務處。'}</span>
            : <button onClick={cancelConfirm} disabled={confirming} className="btn btn-secondary text-xs py-0.5 ml-auto">
                {confirming ? '處理中…' : '取消確認，繼續修改'}
              </button>}
        </div>
      )}
      {!confirmed && finalized && lockMessage && (
        <div className="card bg-amber-50 border-amber-200 text-sm text-amber-700 py-3">🔒 {lockMessage}</div>
      )}
      {blockedMsg && (
        <div className="card bg-red-50 border-red-200 text-sm text-red-700 py-3 space-y-1">
          <div className="font-medium">⚠ 這一次的修改沒有存進去：{blockedMsg}</div>
          <div className="text-xs">
            課表在您填的期間被更動了。請按
            <button onClick={() => location.reload()} className="btn btn-secondary text-xs py-0.5 mx-1">重新整理</button>
            取得最新的班級課表；您先前已存檔的內容都還在，只有剛剛這幾格要重填。
          </div>
        </div>
      )}
      {lockedNote.length > 0 && (
        <div className="card bg-zinc-50 border-zinc-200 text-xs text-zinc-600 py-2.5 space-y-0.5">
          <div className="font-medium text-zinc-700">以下配課已由固定課排定，不需再填：</div>
          {lockedNote.map(x => (
            <div key={x.subject}>・{x.subject} {x.n} 節　（{x.by}）</div>
          ))}
        </div>
      )}
      {staleCells.length > 0 && (
        <div className="card bg-red-50 border-red-200 text-sm text-red-700 py-3 space-y-1">
          <div className="font-medium">⚠ 您原本填的 {staleCells.length} 格已被課務組改動，需要重新安排</div>
          <ul className="text-xs space-y-0.5">
            {staleCells.map(x => (
              <li key={x.slot}>
                ・{DAY_LABEL[Number(x.slot.split('-')[0])]}第{x.slot.split('-')[1]}節 您填的「{x.subject}」
                → 現在是<b>{x.tookBy}</b>
              </li>
            ))}
          </ul>
          <div className="text-xs opacity-80">這幾節已從您的節數扣回，請重新找空格填入；下方科目籤會顯示還差幾節。</div>
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
      <div className="card p-3 overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-[11px] min-w-[420px]">
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
                        <div className={`h-12 rounded-sm border px-0.5 flex flex-col items-center justify-center text-center leading-tight overflow-hidden ${f.kind === 'lock' ? 'bg-zinc-200 border-zinc-300 text-zinc-600' : f.biweekly ? 'bg-violet-50 border-violet-200 text-violet-800' : 'bg-zinc-100 border-zinc-200 text-zinc-500'}`}>
                          <span className="truncate w-full font-medium">{f.subject}</span>
                          {f.teacherName && <span className="truncate w-full text-[9px] opacity-70">{f.teacherName}</span>}
                          {f.biweekly && <span className="text-[8px] opacity-70">{f.biweekly === 'odd' ? '單週上這堂・雙週輪您' : '雙週上這堂・單週輪您'}</span>}
                        </div>
                      </td>
                    )
                  }
                  if (!teachSet.has(k)) return <td key={d} className="p-0.5"><div className="h-12 rounded-sm bg-zinc-50" /></td>
                  const mine = cells[k]
                  const pair = pairCells[k]
                  const pairTag = pair === 'odd' ? '單週輪您・算 2 節' : pair === 'even' ? '雙週輪您・算 2 節' : null
                  return (
                    <td key={d} className="p-0.5">
                      <button type="button" onClick={() => clickCell(k)} disabled={readOnly}
                        className={`w-full h-12 rounded-sm border text-[11px] leading-tight flex flex-col items-center justify-center ${mine
                          ? pair ? 'bg-violet-50 border-violet-300 text-violet-800 font-medium' : 'bg-emerald-50 border-emerald-300 text-emerald-800 font-medium'
                          : pair ? 'bg-white border-dashed border-violet-300 text-violet-400 hover:border-violet-500'
                          : 'bg-white border-dashed border-zinc-300 text-zinc-300 hover:border-emerald-400'}`}>
                        <span className="truncate w-full">{mine ?? (readOnly ? '' : '＋')}</span>
                        {pairTag && <span className="text-[8px] opacity-70">{pairTag}</span>}
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
          <span className="text-xs text-zinc-400 flex items-center gap-3">
            <span>{allDone ? '✓ 全部配課已填入' : `尚餘 ${subjects.reduce((s2, s) => s2 + Math.max(0, remaining(s)), 0)} 節未填`}</span>
            {Object.keys(cells).length > 0 && (
              <button onClick={clearAll} className="text-zinc-400 hover:text-red-500 underline underline-offset-2">清空重填</button>
            )}
          </span>
          <button onClick={confirmSubmit} disabled={!allDone || confirming || saveStatus === 'saving'} className="btn-primary text-sm">
            {confirming ? '送出中…' : '確認送出'}
          </button>
        </div>
      )}
    </div>
  )
}
