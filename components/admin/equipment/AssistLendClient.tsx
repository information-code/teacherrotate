'use client'

// 協助借用（做）：管理者代為安排的借用——短期借用（代老師預約）、固定活動（活動保留）、長期借用。
// 看狀況與處理異常在另一頁「借用總覽」。

import { useCallback, useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import { renderOverdueMessage } from '@/lib/equipment'
import { ActivityTab } from './ActivityTab'
import { AssistShortTab } from './AssistShortTab'
import { LongLoansTab, type EquipmentOption, type GroupOption, type TeacherOption } from './LendingTabs'

export type AssistTab = 'short' | 'activity' | 'long'

const TABS: [AssistTab, string][] = [
  ['short', '短期借用'],
  ['activity', '固定活動'],
  ['long', '長期借用'],
]

export default function AssistLendClient({
  equipment,
  groups,
  teachers,
  openPeriods,
  renewalWeeks,
  overdueTemplate,
  initialTab,
}: {
  equipment: EquipmentOption[]
  groups: GroupOption[]
  teachers: TeacherOption[]
  openPeriods: string[]
  renewalWeeks: number
  overdueTemplate: string
  initialTab: AssistTab
}) {
  const [tab, setTab] = useState<AssistTab>(initialTab)
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

  const copyOverdue = async (vars: { teacher: string; equipment: string; date: string; periods: string }) => {
    await navigator.clipboard.writeText(renderOverdueMessage(overdueTemplate, vars))
    flash('通知訊息已複製，可貼到 LINE。')
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">協助借用</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            由管理者代為安排借用。短期借用建立後，老師照常在自己的借用頁辦理借用、歸還手續；固定活動不需借用人。
          </p>
        </div>
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

      {tab === 'short' && (
        <AssistShortTab teachers={teachers} openPeriods={openPeriods} runBusy={runBusy} onFlash={flash} />
      )}
      {tab === 'activity' && <ActivityTab runBusy={runBusy} onFlash={flash} />}
      {tab === 'long' && (
        <LongLoansTab
          equipment={equipment}
          groups={groups}
          teachers={teachers}
          renewalWeeks={renewalWeeks}
          onCopy={copyOverdue}
          onFlash={flash}
          runBusy={runBusy}
        />
      )}
    </div>
  )
}
