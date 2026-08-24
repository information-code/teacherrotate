'use client'

import { useEffect, useState } from 'react'
import { PageLoading } from '@/components/ui/PageLoading'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  REPAIR_STATUSES,
  elapsedText,
  repairStatusLabel,
  resolvedKindLabel,
  slaLevel,
  type RepairConfig,
} from '@/lib/repair'

// ---------- 型別 ----------

interface ItemRow { id: string; name: string; active: boolean }
interface IssueRow { id: string; item_id: string; name: string; active: boolean }

interface ReportRow {
  id: string
  teacher_id: string
  teacher_name: string
  item_id: string | null
  item_name: string
  issue_id: string | null
  issue_name: string
  custom_issue: string
  location: string
  photoUrls: string[]
  status: string
  resolved_kind: string | null
  admin_note: string
  created_at: string
  accepted_at: string | null
  dispatched_at: string | null
  closed_at: string | null
}

interface PageData {
  reports: ReportRow[]
  items: ItemRow[]
  issues: IssueRow[]
  config: RepairConfig
}

function issueText(r: ReportRow): string {
  return r.issue_name || r.custom_issue || '（未填問題）'
}

function timeText(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

const SLA_BADGE: Record<'ok' | 'warn' | 'alert', string> = {
  ok: 'bg-amber-100 text-amber-800',
  warn: 'bg-orange-200 text-orange-900',
  alert: 'bg-red-200 text-red-900',
}

export default function RepairCasesClient() {
  const [data, setData] = useState<PageData | null>(null)
  const [loadError, setLoadError] = useState('')

  const [statusFilter, setStatusFilter] = useState('open')  // open | all | pending | accepted | processing | closed
  const [itemFilter, setItemFilter] = useState('')
  const [search, setSearch] = useState('')

  const [expandedId, setExpandedId] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  // 歸類草稿（未歸類案件用）
  const [classifyItemId, setClassifyItemId] = useState('')
  const [classifyIssueId, setClassifyIssueId] = useState('')
  const [newIssueName, setNewIssueName] = useState('')

  const [message, setMessage] = useState('')
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const [busy, setBusy] = useState('')
  const runBusy = async (msg: string, fn: () => Promise<void>) => {
    setBusy(msg)
    try {
      await fn()
    } catch (e) {
      flash(e instanceof Error ? e.message : '操作失敗')
    } finally {
      setBusy('')
    }
  }

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = async () => {
    const res = await fetch('/api/admin/repair-cases')
    const json = await res.json()
    if (!res.ok) {
      setLoadError(json.error || '載入失敗')
      return
    }
    setData(json)
  }

  useEffect(() => { void load() }, [])

  if (loadError) return <div className="card"><p className="text-sm text-red-600">{loadError}</p></div>
  if (!data) return <PageLoading />

  const keyword = search.trim().toLowerCase()
  const filtered = data.reports.filter(r => {
    if (statusFilter === 'open' && r.status === 'closed') return false
    if (statusFilter !== 'open' && statusFilter !== 'all' && r.status !== statusFilter) return false
    if (itemFilter && r.item_id !== itemFilter) return false
    if (keyword) {
      const hay = [r.teacher_name, r.item_name, r.issue_name, r.custom_issue, r.location, r.admin_note]
        .join(' ').toLowerCase()
      if (!hay.includes(keyword)) return false
    }
    return true
  })

  const expand = (r: ReportRow) => {
    if (expandedId === r.id) {
      setExpandedId('')
      return
    }
    setExpandedId(r.id)
    setNoteDraft(r.admin_note)
    setClassifyItemId(r.item_id ?? '')
    setClassifyIssueId('')
    setNewIssueName(r.custom_issue)
  }

  const act = async (id: string, payload: Record<string, unknown>, doneMsg: string) => {
    await runBusy('處理中…', async () => {
      const res = await fetch('/api/admin/repair-cases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '操作失敗')
      await load()
      flash(doneMsg)
    })
  }

  const classifyIssues = data.issues.filter(s => s.item_id === classifyItemId && s.active)

  return (
    <div className="space-y-4">
      {busy && <BusyOverlay text={busy} />}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">案件報表</h1>
        {message && <span className="text-sm text-zinc-600" aria-live="polite">{message}</span>}
      </div>

      {/* 篩選 */}
      <div className="flex flex-wrap gap-2">
        <select className="input !w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="open">未結案</option>
          <option value="all">全部</option>
          {REPAIR_STATUSES.map(s => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <select className="input !w-44" value={itemFilter} onChange={e => setItemFilter(e.target.value)}>
          <option value="">全部設備</option>
          {data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input
          className="input !w-56"
          placeholder="搜尋報修人、問題、地點…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="self-center text-xs text-zinc-500">{filtered.length} 件</span>
      </div>

      {filtered.length === 0 && (
        <div className="card"><p className="text-sm text-zinc-500">沒有符合條件的案件。</p></div>
      )}

      {/* 案件列表 */}
      <div className="space-y-2">
        {filtered.map(r => {
          const level = slaLevel(r.created_at, r.status, data.config, now)
          const expanded = expandedId === r.id
          return (
            <div key={r.id} className="card !p-0 overflow-hidden">
              <button className="w-full px-4 py-3 text-left transition-colors hover:bg-zinc-50" onClick={() => expand(r)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium text-zinc-800">{r.item_name}</span>
                    <span className="text-zinc-600">｜{issueText(r)}</span>
                    {!r.issue_id && (
                      <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-700">未歸類</span>
                    )}
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                    r.status === 'closed' ? 'bg-zinc-100 text-zinc-500' : SLA_BADGE[level]
                  }`}>
                    {r.status === 'closed' && (r.resolved_kind === 'self' || r.resolved_kind === 'vanished')
                      ? `已解決（${resolvedKindLabel(r.resolved_kind)}）`
                      : repairStatusLabel(r.status)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {r.teacher_name}
                  {r.location && `｜${r.location}`}
                  ｜{timeText(r.created_at)} 報修
                  {r.status !== 'closed' && (
                    <span className={level === 'alert' ? 'font-semibold text-red-600' : level === 'warn' ? 'font-semibold text-orange-600' : ''}>
                      ｜已經過 {elapsedText(r.created_at, now)}
                    </span>
                  )}
                </div>
              </button>

              {expanded && (
                <div className="space-y-3 border-t border-zinc-200 px-4 py-3">
                  {/* 自由描述原文與照片 */}
                  {r.custom_issue && (
                    <p className="whitespace-pre-wrap text-sm text-zinc-700">
                      <span className="text-xs text-zinc-500">報修描述：</span>{r.custom_issue}
                    </p>
                  )}
                  {r.photoUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {r.photoUrls.map((url, i) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`照片 ${i + 1}`} className="h-20 w-20 rounded border border-zinc-200 object-cover" />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* 歸類（未歸類案件） */}
                  {!r.issue_id && (
                    <div className="space-y-2 rounded border border-violet-200 bg-violet-50/50 p-3">
                      <p className="text-sm font-medium text-zinc-700">歸類到標準問題（統計才算得進去）</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select className="input !w-44" value={classifyItemId}
                          onChange={e => { setClassifyItemId(e.target.value); setClassifyIssueId('') }}>
                          <option value="">選擇設備項目…</option>
                          {data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <select className="input !w-52" value={classifyIssueId}
                          onChange={e => setClassifyIssueId(e.target.value)} disabled={!classifyItemId}>
                          <option value="">歸入既有問題…</option>
                          {classifyIssues.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <button className="btn-secondary" disabled={!classifyItemId || !classifyIssueId}
                          onClick={() => act(r.id, { action: 'classify', item_id: classifyItemId, issue_id: classifyIssueId }, '已歸類')}>
                          歸類
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="input !w-96 max-w-full" value={newIssueName} placeholder="或以此描述新增標準問題"
                          onChange={e => setNewIssueName(e.target.value)} />
                        <button className="btn-secondary" disabled={!classifyItemId || !newIssueName.trim()}
                          onClick={() => act(r.id, { action: 'new-issue', item_id: classifyItemId, name: newIssueName }, '已升級為標準問題並歸類')}>
                          升級為標準問題
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 向報修者說明 */}
                  <div>
                    <p className="mb-1 text-sm text-zinc-600">向報修者說明（顯示在教師端案件頁）</p>
                    <textarea className="input min-h-20" value={noteDraft}
                      placeholder="例：已叫料，零件到貨後到班上更換"
                      onChange={e => setNoteDraft(e.target.value)} />
                    <div className="mt-1.5 flex justify-end">
                      <button className="btn-secondary" disabled={noteDraft === r.admin_note}
                        onClick={() => act(r.id, { action: 'note', admin_note: noteDraft }, '說明已儲存')}>
                        儲存說明
                      </button>
                    </div>
                  </div>

                  {/* 狀態推進 */}
                  {r.status !== 'closed' && (
                    <div className="flex justify-end gap-2 border-t border-zinc-100 pt-3">
                      {r.status === 'pending' && (
                        <button className="btn-secondary" onClick={() => act(r.id, { action: 'accept' }, '已接案')}>
                          接案
                        </button>
                      )}
                      {(r.status === 'pending' || r.status === 'accepted') && (
                        <button className="btn-secondary" onClick={() => act(r.id, { action: 'process' }, '已轉為處理中')}>
                          開始處理
                        </button>
                      )}
                      <button className="btn-primary"
                        onClick={() => { if (confirm('確定結案？教師端會顯示已結案。')) void act(r.id, { action: 'close' }, '已結案') }}>
                        結案
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
