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
import { casesToWorkOrderPdf, saveBlob } from '@/lib/repair-export'

// ---------- 型別 ----------

interface ItemRow { id: string; name: string; active: boolean }
interface IssueRow { id: string; item_id: string; name: string; active: boolean }

interface MessageRow {
  id: string
  author_name: string
  is_admin: boolean
  body: string
  created_at: string
}

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
  messages: MessageRow[]
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

  // 看板模式：全螢幕未結案清單（給公用電腦），只開放更新狀態與填寫說明，
  // 離開需輸入啟動時設定的密碼。密碼存 localStorage，重新整理仍維持鎖定。
  const [kiosk, setKiosk] = useState(false)
  const [kioskModal, setKioskModal] = useState<'' | 'enter' | 'exit'>('')
  const [kioskPwDraft, setKioskPwDraft] = useState('')
  const [kioskError, setKioskError] = useState('')
  const [kioskMsgDrafts, setKioskMsgDrafts] = useState<Record<string, string>>({})

  const [expandedId, setExpandedId] = useState('')
  const [msgDraft, setMsgDraft] = useState('')  // 展開案件的留言輸入
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

  // 網址帶 ?filter=unclassified（統計頁的未歸類提醒連過來）→ 直接切到未歸類篩選
  useEffect(() => {
    try {
      const f = new URLSearchParams(window.location.search).get('filter')
      if (f === 'unclassified') setStatusFilter('unclassified')
    } catch {}
  }, [])

  // 重新整理後若看板密碼還在，直接回到鎖定狀態
  useEffect(() => {
    try { if (localStorage.getItem('repairKioskPw')) setKiosk(true) } catch {}
  }, [])

  // 看板模式每分鐘自動抓最新案件
  useEffect(() => {
    if (!kiosk) return
    const t = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(t)
  }, [kiosk])

  if (loadError) return <div className="card"><p className="text-sm text-red-600">{loadError}</p></div>
  if (!data) return <PageLoading />

  const keyword = search.trim().toLowerCase()
  const filtered = data.reports.filter(r => {
    if (statusFilter === 'open' && r.status === 'closed') return false
    // 未歸類：不分狀態（已結案的也要能歸類，統計才算得進去）
    if (statusFilter === 'unclassified' && r.issue_id) return false
    if (!['open', 'all', 'unclassified'].includes(statusFilter) && r.status !== statusFilter) return false
    if (itemFilter && r.item_id !== itemFilter) return false
    if (keyword) {
      const hay = [r.teacher_name, r.item_name, r.issue_name, r.custom_issue, r.location,
        ...r.messages.map(m => m.body)].join(' ').toLowerCase()
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
    setMsgDraft('')
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

  /** 維護方在案件留言（展開區與看板共用）；成功才清空輸入框 */
  const sendCaseMessage = async (id: string, text: string, clear: () => void) => {
    const body = text.trim()
    if (!body) return
    await runBusy('送出留言中…', async () => {
      const res = await fetch('/api/admin/repair-cases', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'message', body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '留言失敗')
      clear()
      await load()
    })
  }

  const enterKiosk = () => {
    const pw = kioskPwDraft.trim()
    if (pw.length < 4) {
      setKioskError('離開密碼至少 4 碼')
      return
    }
    try { localStorage.setItem('repairKioskPw', pw) } catch {}
    setKioskModal('')
    setKioskPwDraft('')
    setKioskError('')
    setKiosk(true)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const exitKiosk = () => {
    let saved = ''
    try { saved = localStorage.getItem('repairKioskPw') ?? '' } catch {}
    if (kioskPwDraft !== saved) {
      setKioskError('密碼錯誤')
      return
    }
    try { localStorage.removeItem('repairKioskPw') } catch {}
    setKioskModal('')
    setKioskPwDraft('')
    setKioskError('')
    setKiosk(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }

  // 看板內容：未結案，最久未處理的排最上面
  const kioskCases = data.reports
    .filter(r => r.status !== 'closed')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  /** 結案：報修結案(fixed) / 老師自行解決(self)——老師沒自己按時由管理端代記，統計才準 */
  const closeCase = (r: ReportRow, kind: string) => {
    if (kind !== 'fixed' && kind !== 'self') return
    const label = kind === 'self' ? '老師自行解決' : '報修結案'
    if (confirm(`確定以「${label}」結案？教師端會顯示已結案。`)) {
      void act(r.id, { action: 'close', resolved_kind: kind }, '已結案')
    }
  }

  /** 看板的狀態下拉：選了就推進（單向；結案需確認） */
  const kioskChangeStatus = (r: ReportRow, next: string) => {
    if (next === r.status) return
    if (next === 'accepted') void act(r.id, { action: 'accept' }, '已接案')
    else if (next === 'processing') void act(r.id, { action: 'process' }, '已轉為處理中')
    else if (next === 'closed:fixed') closeCase(r, 'fixed')
    else if (next === 'closed:self') closeCase(r, 'self')
  }

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
          <option value="unclassified">未歸類（含已結案）</option>
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
        <button
          className="btn-secondary ml-auto"
          disabled={filtered.length === 0}
          onClick={() => runBusy('產生工作單…', async () => {
            const blob = await casesToWorkOrderPdf(
              filtered.map(r => ({
                item_name: r.item_name,
                issue_text: issueText(r),
                location: r.location,
                teacher_name: r.teacher_name,
                created_at: r.created_at,
                // 工作單的說明欄放維護方最後一則留言
                admin_note: [...r.messages].reverse().find(m => m.is_admin)?.body ?? '',
              })),
              setBusy,
            )
            const d = new Date()
            saveBlob(blob, `設備報修工作單-${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}.pdf`)
          })}
        >
          ⬇ 下載工作單
        </button>
        <button
          className="btn-secondary"
          onClick={() => { setKioskPwDraft(''); setKioskError(''); setKioskModal('enter') }}
        >
          🖥 看板模式
        </button>
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

                  {/* 留言板（與報修老師雙向；已結案唯讀） */}
                  <div className="space-y-1.5">
                    <p className="text-sm text-zinc-600">留言板（報修老師看得到，也可回覆）</p>
                    {r.messages.length === 0 && (
                      <p className="text-sm text-zinc-400">還沒有留言。</p>
                    )}
                    {r.messages.map(m => (
                      <div key={m.id} className={`rounded border border-zinc-200 p-2 ${m.is_admin ? 'bg-zinc-50' : ''}`}>
                        <p className="text-xs text-zinc-500">
                          {m.is_admin ? '🛠 ' : ''}{m.author_name}
                          <span className="ml-2">{timeText(m.created_at)}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-800">{m.body}</p>
                      </div>
                    ))}
                    {r.status !== 'closed' && (
                      <div>
                        <textarea className="input min-h-16" value={msgDraft}
                          placeholder="例：已叫料，零件到貨後到班上更換"
                          onChange={e => setMsgDraft(e.target.value)} />
                        <div className="mt-1.5 flex justify-end">
                          <button className="btn-secondary" disabled={!msgDraft.trim()}
                            onClick={() => sendCaseMessage(r.id, msgDraft, () => setMsgDraft(''))}>
                            送出留言
                          </button>
                        </div>
                      </div>
                    )}
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
                      <select
                        className="input !w-44"
                        value=""
                        onChange={e => closeCase(r, e.target.value)}
                      >
                        <option value="">結案…</option>
                        <option value="fixed">報修結案（已修復）</option>
                        <option value="self">老師自行解決</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ============ 唯讀看板（全螢幕，密碼才能離開） ============ */}
      {kiosk && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-zinc-100">
          <div className="mx-auto max-w-4xl space-y-3 p-6">
            <div className="flex items-end justify-between">
              <div>
                <h1 className="text-2xl font-bold text-zinc-900">設備報修處理看板</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  未結案 {kioskCases.length} 件｜每分鐘自動更新
                  {message && <span className="ml-2 text-zinc-700" aria-live="polite">｜{message}</span>}
                </p>
              </div>
              <button
                className="text-xs text-zinc-400 underline hover:text-zinc-600"
                onClick={() => { setKioskPwDraft(''); setKioskError(''); setKioskModal('exit') }}
              >
                離開看板
              </button>
            </div>

            {kioskCases.length === 0 && (
              <div className="rounded-md bg-white p-8 text-center shadow-sm">
                <p className="text-lg text-zinc-500">目前沒有待處理的報修案件 🎉</p>
              </div>
            )}

            {kioskCases.map(r => {
              const level = slaLevel(r.created_at, r.status, data.config, now)
              const kioskDraft = kioskMsgDrafts[r.id] ?? ''
              return (
                <div key={r.id} className="rounded-md bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-lg font-semibold text-zinc-900">
                      {r.item_name}｜{issueText(r)}
                    </span>
                    <span className={`shrink-0 rounded px-2.5 py-1 text-sm ${SLA_BADGE[level]}`}>
                      已經過 {elapsedText(r.created_at, now)}
                    </span>
                  </div>
                  <div className="mt-1 text-base text-zinc-700">
                    {r.location && <span className="font-medium">📍 {r.location}　</span>}
                    <span className="text-zinc-500">
                      {r.teacher_name}｜{timeText(r.created_at)} 報修
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    <select
                      className="input !w-32"
                      value={r.status}
                      onChange={e => kioskChangeStatus(r, e.target.value)}
                    >
                      <option value="pending" disabled={r.status !== 'pending'}>通報中</option>
                      <option value="accepted" disabled={r.status !== 'pending' && r.status !== 'accepted'}>已接案</option>
                      <option value="processing">處理中</option>
                      <option value="closed:fixed">已結案（已修復）</option>
                      <option value="closed:self">已結案（老師自行解決）</option>
                    </select>
                    <div className="min-w-56 flex-1 space-y-1.5">
                      {r.messages.map(m => (
                        <div key={m.id} className={`rounded border border-zinc-200 p-2 ${m.is_admin ? 'bg-zinc-50' : ''}`}>
                          <p className="text-xs text-zinc-500">
                            {m.is_admin ? '🛠 ' : ''}{m.author_name}
                            <span className="ml-2">{timeText(m.created_at)}</span>
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-800">{m.body}</p>
                        </div>
                      ))}
                      <textarea
                        className="input min-h-14 w-full"
                        placeholder="留言給報修老師（例：已到現場檢查，需要更換零件）"
                        value={kioskDraft}
                        onChange={e => setKioskMsgDrafts(d => ({ ...d, [r.id]: e.target.value }))}
                      />
                      <div className="flex justify-end">
                        <button
                          className="btn-secondary !px-3 !py-1"
                          disabled={!kioskDraft.trim()}
                          onClick={() => sendCaseMessage(r.id, kioskDraft,
                            () => setKioskMsgDrafts(d => { const { [r.id]: _drop, ...rest } = d; return rest }))}
                        >
                          送出留言
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 看板內的處理中遮罩（看板 z 較高，蓋不到全域 BusyOverlay） */}
          {busy && (
            <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30">
              <div className="flex items-center gap-3 rounded-md bg-white px-6 py-4 shadow-xl">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-700" />
                <span className="text-sm text-zinc-700">{busy}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 看板啟動／離開密碼視窗 */}
      {kioskModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div className="w-80 space-y-3 rounded-md bg-white p-4 shadow-xl">
            <h3 className="font-medium text-zinc-900">
              {kioskModal === 'enter' ? '啟動唯讀看板' : '離開唯讀看板'}
            </h3>
            <p className="text-sm text-zinc-500">
              {kioskModal === 'enter'
                ? '看板為全螢幕畫面，只顯示未結案件，僅能更新狀態與填寫說明。請設定離開密碼（離開看板時需輸入）。'
                : '請輸入啟動看板時設定的密碼。'}
            </p>
            <input
              type="password"
              className="input"
              autoFocus
              placeholder={kioskModal === 'enter' ? '設定離開密碼（至少 4 碼）' : '離開密碼'}
              value={kioskPwDraft}
              onChange={e => { setKioskPwDraft(e.target.value); setKioskError('') }}
              onKeyDown={e => { if (e.key === 'Enter') (kioskModal === 'enter' ? enterKiosk : exitKiosk)() }}
            />
            {kioskError && <p className="text-sm text-red-600">{kioskError}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setKioskModal(''); setKioskPwDraft(''); setKioskError('') }}>
                取消
              </button>
              <button className="btn-primary" onClick={kioskModal === 'enter' ? enterKiosk : exitKiosk}>
                {kioskModal === 'enter' ? '啟動' : '離開'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
