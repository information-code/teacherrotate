'use client'

// 借用總覽（看）：今日總覽／設備明細／統計／操作紀錄。
// 管理者協助借用（做）在另一頁「協助借用」。

import { useCallback, useEffect, useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import { renderOverdueMessage } from '@/lib/equipment'
import { LogTab, OverviewTab, StatsTab } from './LendingTabs'
import { TodayDashboard } from './TodayDashboard'

type MessageVars = { teacher: string; equipment: string; date: string; periods: string }
type Tab = 'today' | 'units' | 'stats' | 'log'

const TABS: [Tab, string][] = [
  ['today', '今日總覽'],
  ['units', '設備明細'],
  ['stats', '統計'],
  ['log', '操作紀錄'],
]

export default function LendingOverviewClient({
  overdueTemplate,
  pickupTemplate,
}: {
  overdueTemplate: string
  pickupTemplate: string
}) {
  const [tab, setTab] = useState<Tab>('today')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 3000)
  }

  /** 呼叫 API 期間顯示全螢幕遮罩 */
  const runBusy = useCallback(async (msg: string, fn: () => Promise<void>) => {
    setBusy(msg)
    try {
      await fn()
    } finally {
      setBusy('')
    }
  }, [])

  const copyWith = (template: string, doneText: string) => async (vars: MessageVars) => {
    await navigator.clipboard.writeText(renderOverdueMessage(template, vars))
    flash(doneText)
  }
  const copyOverdue = copyWith(overdueTemplate, '催還訊息已複製，可貼到 LINE。')
  const copyPickup = copyWith(pickupTemplate, '提醒訊息已複製，可貼到 LINE。')

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-zinc-900">借用總覽</h1>
        {message && <span className="text-sm text-zinc-600">{message}</span>}
      </div>

      <div className="flex overflow-x-auto border-b border-zinc-200" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key ? 'border-zinc-800 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {busy && <BusyOverlay text={busy} />}

      {tab === 'today' && (
        <TodayDashboard onCopyOverdue={copyOverdue} onCopyPickup={copyPickup} runBusy={runBusy} onFlash={flash} />
      )}
      {tab === 'units' && <OverviewTab onCopy={copyOverdue} onFlash={flash} runBusy={runBusy} />}
      {tab === 'stats' && (
        <div className="space-y-4">
          <NoShowCard runBusy={runBusy} onFlash={flash} />
          <StatsTab />
        </div>
      )}
      {tab === 'log' && <LogTab />}
    </div>
  )
}

/** 預約未借次數（全部有紀錄的老師；達上限的也會出現在今日總覽的「需處理」） */
function NoShowCard({ runBusy, onFlash }: {
  runBusy: (msg: string, fn: () => Promise<void>) => Promise<void>
  onFlash: (text: string) => void
}) {
  const [rows, setRows] = useState<{ teacher_id: string; name: string; no_show_count: number }[] | null>(null)
  const load = useCallback(async () => {
    const res = await fetch('/api/admin/equipment-no-show')
    if (res.ok) setRows((await res.json()).rows)
  }, [])
  useEffect(() => { load() }, [load])

  const reset = async (row: { teacher_id: string; name: string }) => {
    if (!confirm(`確定將 ${row.name} 的「預約未借」次數歸零？歸零後老師即可恢復自行預約。`)) return
    await runBusy('歸零中…', async () => {
      const res = await fetch('/api/admin/equipment-no-show', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: row.teacher_id }),
      })
      if (!res.ok) alert((await res.json()).error ?? '操作失敗')
      else onFlash(`已將 ${row.name} 的預約未借次數歸零`)
      await load()
    })
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-medium text-zinc-900">預約未借紀錄</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          預約到期仍未辦借用手續會自動計次；達上限（「設備設定」可調）的老師無法自行預約，須在這裡或今日總覽歸零恢復。
        </p>
      </div>
      {rows === null && <p className="text-sm text-zinc-400">載入中…</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-zinc-400">沒有紀錄。</p>}
      {rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>老師</th><th className="!text-right">次數</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.teacher_id}>
                  <td>{r.name}</td>
                  <td className="text-right tabular-nums">{r.no_show_count}</td>
                  <td className="text-right">
                    <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => reset(r)}>歸零</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
