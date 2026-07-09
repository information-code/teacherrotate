'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  loanDueDate,
  loanTimeText,
  overdueDays,
  periodsText,
  renderOverdueMessage,
  todayStr,
  type ChecklistResult,
} from '@/lib/equipment'

interface EquipmentOption { id: string; name: string; status: string; asset_number: string; group_id: string | null }
interface GroupOption { id: string; name: string; status: string; member_count: number }
interface TeacherOption { id: string; name: string }

interface AdminLongLoanRow {
  id: string
  equipment_id: string | null
  group_id: string | null
  equipment_name: string
  equipment_asset_number: string
  teacher_id: string | null
  teacher_name: string
  is_external: boolean
  start_date: string
  due_date: string
  status: string
  notes: string
  renewals: { id: string; photos: string[]; old_due_date: string; new_due_date: string; agreed_at: string }[]
}

interface StatsData {
  teacherStats: { teacher_id: string; name: string; total: number; overdue: number; totalDays: number; avgDays: number; maxDays: number }[]
  equipmentStats: { equipment_id: string; name: string; total: number; overdue: number; rate: number; maxDays: number }[]
  monthly: { month: string; loans: number; overdue: number }[]
  longOverdue: { id: string; equipment_name: string; teacher_name: string; due_date: string; overdueDays: number }[]
}

export default function EquipmentManageClient({
  equipment,
  groups,
  teachers,
  overdueTemplate,
  renewalWeeks,
}: {
  equipment: EquipmentOption[]
  groups: GroupOption[]
  teachers: TeacherOption[]
  overdueTemplate: string
  renewalWeeks: number
}) {
  const [tab, setTab] = useState<'overview' | 'short' | 'long' | 'stats'>('overview')
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

  const copyOverdueMessage = async (vars: { teacher: string; equipment: string; date: string; periods: string }) => {
    const text = renderOverdueMessage(overdueTemplate, vars)
    await navigator.clipboard.writeText(text)
    flash('通知訊息已複製，可貼到 LINE。')
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">設備借用管理</h1>
        {message && <span className="text-sm text-zinc-600">{message}</span>}
      </div>

      <div className="flex border-b border-zinc-200">
        {([['overview', '設備總覽'], ['short', '短期借用'], ['long', '長期借用'], ['stats', '逾期統計']] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-zinc-800 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {busy && <BusyOverlay text={busy} />}

      {tab === 'overview' && <OverviewTab onCopy={copyOverdueMessage} onFlash={flash} runBusy={runBusy} />}
      {tab === 'short' && <LogTab />}
      {tab === 'long' && (
        <LongLoansTab
          equipment={equipment}
          groups={groups}
          teachers={teachers}
          renewalWeeks={renewalWeeks}
          onCopy={copyOverdueMessage}
          onFlash={flash}
          runBusy={runBusy}
        />
      )}
      {tab === 'stats' && <StatsTab />}
    </div>
  )
}

// ---------- 設備總覽 ----------

interface OverviewShortLoan {
  id: string
  status: string // reserved | borrowed
  teacher_name: string
  loan_date: string
  end_date: string | null
  start_period: string | null
  end_period: string | null
  periods: string[]
  overdue: boolean
  is_group: boolean
  group_name: string
}

interface OverviewRow {
  id: string
  name: string
  asset_number: string
  location: string
  status: string
  shortLoans: OverviewShortLoan[]
  longLoan: {
    borrower_name: string
    is_external: boolean
    start_date: string
    due_date: string
    overdue: boolean
    is_group: boolean
    group_name: string
  } | null
}

function OverviewTab({
  onCopy,
  onFlash,
  runBusy,
}: {
  onCopy: (vars: { teacher: string; equipment: string; date: string; periods: string }) => void
  onFlash: (text: string) => void
  runBusy: (msg: string, fn: () => Promise<void>) => Promise<void>
}) {
  const [rows, setRows] = useState<OverviewRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('') // '' | free | reserved | short | long | maintenance | retired | overdue

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/equipment-overview')
    if (res.ok) setRows((await res.json()).rows)
  }, [])

  useEffect(() => { load() }, [load])

  if (!rows) return <div className="card"><p className="text-sm text-zinc-500">載入中…</p></div>

  const act = async (loan: OverviewShortLoan, action: 'release' | 'close', confirmText: string, doneText: string) => {
    if (!confirm(confirmText)) return
    await runBusy(action === 'release' ? '釋出預約中…' : '結案中…', async () => {
      const res = await fetch('/api/admin/equipment-loans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loan.id, action }),
      })
      const data = await res.json()
      if (!res.ok) alert(data.error ?? '操作失敗')
      else onFlash(doneText)
      await load()
    })
  }

  const borrowed = (r: OverviewRow) => r.shortLoans.filter(l => l.status === 'borrowed')
  const reserved = (r: OverviewRow) => r.shortLoans.filter(l => l.status === 'reserved')

  const keyword = search.trim().toLowerCase()
  const matches = (r: OverviewRow) => {
    if (filter === 'free' && (r.status !== 'available' || r.shortLoans.length > 0 || r.longLoan)) return false
    if (filter === 'reserved' && reserved(r).length === 0) return false
    if (filter === 'short' && borrowed(r).length === 0) return false
    if (filter === 'long' && !r.longLoan) return false
    if (filter === 'maintenance' && r.status !== 'maintenance') return false
    if (filter === 'retired' && r.status !== 'retired') return false
    if (filter === 'overdue' && !(r.shortLoans.some(l => l.overdue) || r.longLoan?.overdue)) return false
    if (!keyword) return true
    return [r.name, r.asset_number, r.location, r.longLoan?.borrower_name, ...r.shortLoans.map(l => l.teacher_name)]
      .some(text => (text ?? '').toLowerCase().includes(keyword))
  }
  const filtered = rows.filter(matches)

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          className="input !w-60"
          placeholder="搜尋設備、編號、位置、使用人…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input !w-36" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">全部狀態</option>
          <option value="free">未出借</option>
          <option value="reserved">已預約</option>
          <option value="short">短期出借</option>
          <option value="long">長期出借</option>
          <option value="overdue">逾期中</option>
          <option value="maintenance">維修中</option>
          <option value="retired">停用</option>
        </select>
        {(keyword || filter) && (
          <span className="self-center text-xs text-zinc-500">符合 {filtered.length}／{rows.length} 台</span>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {rows.length === 0 ? '尚未建立任何設備。' : '沒有符合搜尋條件的設備。'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>設備</th><th>位置</th><th>狀態</th><th>使用人／時間</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="font-medium">
                    {r.name}
                    {r.asset_number && <span className="ml-1 text-xs text-zinc-400 font-normal">#{r.asset_number}</span>}
                  </td>
                  <td>{r.location || '—'}</td>
                  <td className="whitespace-nowrap space-x-1">
                    {r.status === 'maintenance' && <span className="badge-warn">維修中</span>}
                    {r.status === 'retired' && <span className="badge-default">停用</span>}
                    {borrowed(r).length > 0 && (
                      <span className={borrowed(r).some(l => l.overdue) ? 'badge-warn' : 'badge-default'}>
                        {borrowed(r).some(l => l.overdue) ? '短期逾期' : '短期出借'}
                      </span>
                    )}
                    {reserved(r).length > 0 && <span className="badge-default">已預約</span>}
                    {r.longLoan && (
                      <span className={r.longLoan.overdue ? 'badge-warn' : 'badge-default'}>
                        {r.longLoan.overdue ? '長期逾期' : '長期出借'}
                      </span>
                    )}
                    {r.status === 'available' && r.shortLoans.length === 0 && !r.longLoan && (
                      <span className="badge-success">未出借</span>
                    )}
                  </td>
                  <td className="text-sm">
                    {r.shortLoans.map(l => (
                      <div key={l.id} className="py-0.5">
                        {l.teacher_name}
                        {l.is_group && <span className="badge-default ml-1">整組</span>}
                        <span className="text-zinc-500">｜{loanTimeText(l)}</span>
                        {l.status === 'reserved' && <span className="ml-1 text-xs text-zinc-400">（預約，未取用）</span>}
                        {l.overdue && <span className="badge-warn ml-1">逾期 {overdueDays(loanDueDate(l), null, todayStr())} 天</span>}
                      </div>
                    ))}
                    {r.longLoan && (
                      <div className="py-0.5">
                        {r.longLoan.borrower_name}
                        {r.longLoan.is_external && <span className="badge-warn ml-1.5">系統外</span>}
                        {r.longLoan.is_group && <span className="badge-default ml-1.5">整組</span>}
                        <span className="text-zinc-500">｜{r.longLoan.start_date} ～ {r.longLoan.due_date}</span>
                      </div>
                    )}
                    {r.shortLoans.length === 0 && !r.longLoan && '—'}
                  </td>
                  <td className="text-right whitespace-nowrap space-y-1">
                    {r.shortLoans.map(l => (
                      <div key={l.id} className="space-x-1">
                        {l.status === 'reserved' && (
                          <button
                            className="btn-secondary !px-2.5 !py-1 text-xs"
                            onClick={() => act(l, 'release',
                              `確定釋出 ${l.teacher_name} 對「${r.name}」的預約？時段將開放其他老師借用。`,
                              '已釋出預約')}
                          >
                            釋出
                          </button>
                        )}
                        {l.status === 'borrowed' && (
                          <>
                            {l.overdue && (
                              <button
                                className="btn-secondary !px-2.5 !py-1 text-xs"
                                onClick={() => onCopy({
                                  teacher: l.teacher_name,
                                  equipment: r.name,
                                  date: loanDueDate(l) === l.loan_date ? l.loan_date : `${l.loan_date}～${loanDueDate(l)}`,
                                  periods: loanDueDate(l) === l.loan_date ? periodsText(l.periods) : '',
                                })}
                              >
                                複製通知
                              </button>
                            )}
                            <button
                              className="btn-secondary !px-2.5 !py-1 text-xs"
                              onClick={() => act(l, 'close',
                                `確定將 ${l.teacher_name} 借用的「${r.name}」代為結案？`,
                                '已結案')}
                            >
                              結案
                            </button>
                          </>
                        )}
                      </div>
                    ))}
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

// ---------- 短期借用（操作日誌，唯讀） ----------

const EVENT_LABEL: Record<string, string> = {
  reserved: '預約',
  borrowed: '開始借用',
  returned: '歸還',
  cancelled: '取消預約',
  released: '管理者釋出',
  closed: '管理者結案',
}

interface LoanEvent {
  id: string
  loan_id: string | null
  equipment_name: string
  asset_number: string
  teacher_name: string
  action: string
  detail: string
  actor_name: string
  created_at: string
}

/** 短期借用操作日誌：一個操作一條、唯讀。管理動作（釋出/結案）在「設備總覽」。 */
function LogTab() {
  const [filters, setFilters] = useState({ from: '', to: '', action: '' })
  const [equipName, setEquipName] = useState('')
  const [events, setEvents] = useState<LoanEvent[]>([])
  const [loanDetails, setLoanDetails] = useState<Record<string, {
    borrow_checklist: ChecklistResult[] | null
    return_checklist: ChecklistResult[] | null
  }>>({})
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.action) params.set('action', filters.action)
      const res = await fetch(`/api/admin/equipment-loan-events?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setEvents(data.events)
      setLoanDetails(data.loanDetails)
      setPhotoUrls(data.photoUrls)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  const equipmentNames = Array.from(new Set(events.map(ev => ev.equipment_name))).sort()
  const keyword = search.trim().toLowerCase()
  const filtered = events.filter(ev => {
    if (equipName && ev.equipment_name !== equipName) return false
    if (!keyword) return true
    return [ev.equipment_name, ev.asset_number, ev.teacher_name, ev.actor_name, ev.detail]
      .some(text => (text ?? '').toLowerCase().includes(keyword))
  })

  const badgeClass = (action: string) =>
    action === 'returned' ? 'badge-success'
      : action === 'released' || action === 'closed' ? 'badge-warn'
      : 'badge-default'

  /** 明細可展開的事件（有檢查照片可看） */
  const detailChecklist = (ev: LoanEvent): ChecklistResult[] | null => {
    if (!ev.loan_id) return null
    const detail = loanDetails[ev.loan_id]
    if (!detail) return null
    if (ev.action === 'borrowed') return detail.borrow_checklist
    if (ev.action === 'returned' || ev.action === 'closed') return detail.return_checklist
    return null
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        所有短期借用操作的歷史日誌（一個操作一條，唯讀）。預約釋出與借用結案請到「設備總覽」操作。
      </p>

      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <span className="label">起始日期</span>
            <input type="date" className="input" value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <span className="label">結束日期</span>
            <input type="date" className="input" value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
          <div>
            <span className="label">設備</span>
            <select className="input" value={equipName} onChange={e => setEquipName(e.target.value)}>
              <option value="">全部</option>
              {equipmentNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div>
            <span className="label">動作</span>
            <select className="input" value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}>
              <option value="">全部</option>
              {Object.entries(EVENT_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">關鍵字</span>
            <input className="input" placeholder="編號、老師…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-zinc-500">沒有符合條件的紀錄。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>時間</th><th>動作</th><th>設備</th><th>老師</th><th>借用期間</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(ev => {
                  const checklist = detailChecklist(ev)
                  return (
                    <Fragment key={ev.id}>
                      <tr>
                        <td className="whitespace-nowrap">{ev.created_at.slice(0, 16).replace('T', ' ')}</td>
                        <td className="whitespace-nowrap">
                          <span className={badgeClass(ev.action)}>{EVENT_LABEL[ev.action] ?? ev.action}</span>
                          {ev.actor_name && ev.actor_name !== ev.teacher_name && (
                            <span className="ml-1 text-xs text-zinc-400">by {ev.actor_name}</span>
                          )}
                        </td>
                        <td>
                          {ev.equipment_name}
                          {ev.asset_number && <span className="ml-1 text-xs text-zinc-400">#{ev.asset_number}</span>}
                        </td>
                        <td>{ev.teacher_name}</td>
                        <td className="whitespace-nowrap">{ev.detail || '—'}</td>
                        <td className="text-right whitespace-nowrap">
                          {checklist && checklist.length > 0 && (
                            <button
                              className="btn-secondary !px-2.5 !py-1 text-xs"
                              onClick={() => setExpanded(expanded === ev.id ? '' : ev.id)}
                            >
                              {expanded === ev.id ? '收合' : '明細'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded === ev.id && checklist && (
                        <tr>
                          <td colSpan={6} className="!bg-zinc-50">
                            <ChecklistDetail
                              title={ev.action === 'borrowed' ? '借用檢查' : '歸還檢查'}
                              checklist={checklist}
                              photoUrls={photoUrls}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ChecklistDetail({
  title,
  checklist,
  photoUrls,
}: {
  title: string
  checklist: ChecklistResult[] | null
  photoUrls: Record<string, string>
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-zinc-600">{title}</div>
      {!checklist || checklist.length === 0 ? (
        <p className="text-xs text-zinc-400">（尚未辦理）</p>
      ) : (
        checklist.map((item, i) => (
          <div key={i} className="text-xs text-zinc-700">
            <span className="mr-1">{item.checked ? '✅' : '⬜'}</span>
            {item.label}
            {item.photos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {item.photos.map(path => (
                  <a key={path} href={photoUrls[path]} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrls[path]} alt={item.label} className="w-16 h-16 object-cover rounded border border-zinc-200" />
                  </a>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ---------- 長期借用 ----------

function LongLoansTab({
  equipment,
  groups,
  teachers,
  renewalWeeks,
  onCopy,
  onFlash,
  runBusy,
}: {
  equipment: EquipmentOption[]
  groups: GroupOption[]
  teachers: TeacherOption[]
  renewalWeeks: number
  onCopy: (vars: { teacher: string; equipment: string; date: string; periods: string }) => void
  onFlash: (text: string) => void
  runBusy: (msg: string, fn: () => Promise<void>) => Promise<void>
}) {
  const [loans, setLoans] = useState<AdminLongLoanRow[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch] = useState('')
  const [filterName, setFilterName] = useState('')
  const [filterType, setFilterType] = useState('') // '' | 'internal' | 'external' | 'overdue'
  const today = todayStr()

  const defaultDue = () => {
    const d = new Date()
    d.setDate(d.getDate() + renewalWeeks * 7)
    return d.toISOString().slice(0, 10)
  }
  const [form, setForm] = useState({
    equipment_name: '', teacher_id: '', external_name: '', start_date: todayStr(), due_date: defaultDue(), notes: '',
  })
  const isExternal = form.teacher_id === '__external__'
  const borrowerReady = Boolean(form.teacher_id) && (!isExternal || Boolean(form.external_name.trim()))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/equipment-long-loans')
      if (!res.ok) return
      const data = await res.json()
      setLoans(data.loans)
      setPhotoUrls(data.photoUrls)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async (target: { equipment_id?: string; group_id?: string }) => {
    setCreating(target.equipment_id ?? target.group_id ?? '')
    try {
      await runBusy('建立長期借用中…', async () => {
        const res = await fetch('/api/admin/equipment-long-loans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...target,
            start_date: form.start_date,
            due_date: form.due_date,
            notes: form.notes,
            teacher_id: isExternal ? '' : form.teacher_id,
            external_name: isExternal ? form.external_name : '',
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          alert(data.error ?? '建立失敗')
          return
        }
        onFlash('已建立長期借用')
        await load()
      })
    } finally {
      setCreating('')
    }
  }

  const endLoan = async (loan: AdminLongLoanRow) => {
    if (!confirm(`確定結束 ${loan.teacher_name} 的「${loan.equipment_name}」長期借用？`)) return
    await runBusy('結束借用中…', async () => {
      const res = await fetch('/api/admin/equipment-long-loans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loan.id, action: 'end' }),
      })
      const data = await res.json()
      if (!res.ok) alert(data.error ?? '操作失敗')
      else onFlash('已結束借用')
      await load()
    })
  }

  // 搜尋（設備/編號/借用人/備註）＋設備名稱＋類型篩選
  const keyword = search.trim().toLowerCase()
  const equipmentNames = Array.from(new Set(equipment.map(eq => eq.name)))
  const matches = (l: AdminLongLoanRow) => {
    if (filterName && l.equipment_name !== filterName) return false
    if (filterType === 'internal' && l.is_external) return false
    if (filterType === 'external' && !l.is_external) return false
    if (filterType === 'overdue' && !(l.status === 'active' && l.due_date < today)) return false
    if (!keyword) return true
    return [l.equipment_name, l.equipment_asset_number, l.teacher_name, l.notes]
      .some(text => (text ?? '').toLowerCase().includes(keyword))
  }
  const active = loans.filter(l => l.status === 'active' && matches(l))
  const ended = loans.filter(l => l.status !== 'active' && matches(l))
  const totalActive = loans.filter(l => l.status === 'active').length
  const hasFilter = Boolean(keyword || filterName || filterType)

  return (
    <div className="space-y-4">
      {/* 建立 */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-zinc-900">建立長期借用</h2>
          <div className="flex gap-2">
            <a className="btn-secondary !px-3 !py-1.5" href="/api/admin/equipment-long-loans-template">下載清單</a>
            <button className="btn-secondary !px-3 !py-1.5" onClick={() => setShowImport(true)}>Excel 匯入</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <span className="label">設備名稱</span>
            <select className="input" value={form.equipment_name}
              onChange={e => setForm(f => ({ ...f, equipment_name: e.target.value }))}>
              <option value="">請選擇</option>
              {Array.from(new Set(equipment.filter(eq => eq.status !== 'retired').map(eq => eq.name))).map(name => (
                <option key={name} value={`name:${name}`}>{name}</option>
              ))}
              {groups.map(g => (
                <option key={g.id} value={`group:${g.id}`}>{g.name}〔整組 {g.member_count} 台〕</option>
              ))}
            </select>
          </div>
          <div>
            <span className="label">借用人</span>
            <select className="input" value={form.teacher_id}
              onChange={e => setForm(f => ({ ...f, teacher_id: e.target.value }))}>
              <option value="">請選擇</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="__external__">系統外人員（手動輸入姓名）</option>
            </select>
            {isExternal && (
              <input
                className="input mt-2"
                placeholder="輸入系統外人員姓名"
                value={form.external_name}
                onChange={e => setForm(f => ({ ...f, external_name: e.target.value }))}
              />
            )}
          </div>
          <div>
            <span className="label">起始日</span>
            <input type="date" className="input" value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </div>
          <div>
            <span className="label">到期日</span>
            <input type="date" className="input" value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
        </div>
        <input className="input" placeholder="備註（選填）" value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

        {/* 選定名稱後羅列該設備所有編號與長借狀態，逐台指派；選整組則單列指派 */}
        {form.equipment_name.startsWith('group:') && (() => {
          const g = groups.find(x => x.id === form.equipment_name.slice(6))
          if (!g) return null
          const current = loans.find(l => l.status === 'active' && l.group_id === g.id)
          return (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 border border-zinc-200 rounded p-3">
                <div className="flex-1 min-w-[180px] text-sm">
                  <span className="font-medium text-zinc-900">{g.name}</span>
                  <span className="ml-1 text-xs text-zinc-400">整組 {g.member_count} 台</span>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {current
                      ? <>整組長期借用中：{current.teacher_name}{current.is_external && '（系統外）'}｜{current.start_date} ～ {current.due_date}</>
                      : '可指派（借用期間群組內所有設備一併保留）'}
                  </div>
                </div>
                <button
                  className="btn-primary !px-3 !py-1.5"
                  disabled={Boolean(current) || !borrowerReady || creating === g.id}
                  onClick={() => create({ group_id: g.id })}
                >
                  {creating === g.id ? '建立中…' : current ? '已借出' : '整組指派'}
                </button>
              </div>
              {!borrowerReady && (
                <p className="text-xs text-zinc-400">請先選擇借用人（與起訖日期），再按「整組指派」。</p>
              )}
            </div>
          )
        })()}
        {form.equipment_name.startsWith('name:') && (
          <div className="space-y-2">
            {equipment
              .filter(eq => eq.status !== 'retired' && eq.name === form.equipment_name.slice(5))
              .map(eq => {
                const current = loans.find(l => l.status === 'active' && l.equipment_id === eq.id)
                const groupCurrent = eq.group_id
                  ? loans.find(l => l.status === 'active' && l.group_id === eq.group_id)
                  : undefined
                const occupied = current ?? groupCurrent
                return (
                  <div key={eq.id} className="flex flex-wrap items-center gap-2 border border-zinc-200 rounded p-3">
                    <div className="flex-1 min-w-[180px] text-sm">
                      <span className="font-medium text-zinc-900">{eq.name}</span>
                      {eq.asset_number && <span className="ml-1 text-xs text-zinc-400">#{eq.asset_number}</span>}
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {occupied
                          ? <>{groupCurrent && !current ? '所屬群組整組長借中：' : '長期借用中：'}{occupied.teacher_name}{occupied.is_external && '（系統外）'}｜{occupied.start_date} ～ {occupied.due_date}</>
                          : '可指派'}
                      </div>
                    </div>
                    <button
                      className="btn-primary !px-3 !py-1.5"
                      disabled={Boolean(occupied) || !borrowerReady || creating === eq.id}
                      onClick={() => create({ equipment_id: eq.id })}
                    >
                      {creating === eq.id ? '建立中…' : occupied ? '已借出' : '指派'}
                    </button>
                  </div>
                )
              })}
            {!borrowerReady && (
              <p className="text-xs text-zinc-400">請先選擇借用人（與起訖日期），再按「指派」。</p>
            )}
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className="card">
        <h2 className="font-medium text-zinc-900 mb-3">長期借用中</h2>

        {/* 搜尋與篩選 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            className="input !w-60"
            placeholder="搜尋設備、編號、借用人、備註…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="input !w-40" value={filterName} onChange={e => setFilterName(e.target.value)}>
            <option value="">全部設備</option>
            {equipmentNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="input !w-36" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">全部借用人</option>
            <option value="internal">系統帳號</option>
            <option value="external">系統外人員</option>
            <option value="overdue">已逾期</option>
          </select>
          {hasFilter && (
            <span className="self-center text-xs text-zinc-500">
              符合 {active.length}／{totalActive} 筆使用中
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {hasFilter ? '沒有符合搜尋條件的長期借用。' : '目前沒有長期借用。'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>老師</th><th>起始日</th><th>到期日</th><th>續借</th><th></th></tr>
              </thead>
              <tbody>
                {active.map(loan => {
                  const isOverdue = loan.due_date < today
                  return (
                    <Fragment key={loan.id}>
                      <tr>
                        <td>
                          {loan.equipment_name}
                          {loan.equipment_asset_number && (
                            <span className="ml-1 text-xs text-zinc-400">#{loan.equipment_asset_number}</span>
                          )}
                        </td>
                        <td>
                          {loan.teacher_name}
                          {loan.is_external && <span className="badge-warn ml-1.5">系統外</span>}
                        </td>
                        <td>{loan.start_date}</td>
                        <td className="whitespace-nowrap">
                          {loan.due_date}
                          {isOverdue && (
                            <span className="badge-warn ml-2">逾期 {overdueDays(loan.due_date, null, today)} 天</span>
                          )}
                        </td>
                        <td>{loan.renewals.length} 次</td>
                        <td className="text-right whitespace-nowrap space-x-1">
                          {isOverdue && (
                            <button
                              className="btn-secondary !px-2.5 !py-1 text-xs"
                              onClick={() => onCopy({
                                teacher: loan.teacher_name,
                                equipment: loan.equipment_name,
                                date: loan.due_date,
                                periods: '長期借用（續借回傳）',
                              })}
                            >
                              複製通知
                            </button>
                          )}
                          {loan.renewals.length > 0 && (
                            <button
                              className="btn-secondary !px-2.5 !py-1 text-xs"
                              onClick={() => setExpanded(expanded === loan.id ? '' : loan.id)}
                            >
                              {expanded === loan.id ? '收合' : '續借紀錄'}
                            </button>
                          )}
                          <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => endLoan(loan)}>
                            結束借用
                          </button>
                        </td>
                      </tr>
                      {expanded === loan.id && (
                        <tr>
                          <td colSpan={6} className="!bg-zinc-50">
                            <div className="space-y-3 py-1">
                              {loan.renewals.map(r => (
                                <div key={r.id} className="text-xs text-zinc-700">
                                  {r.agreed_at.slice(0, 16).replace('T', ' ')}：{r.old_due_date} → {r.new_due_date}
                                  {(r.photos ?? []).length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                      {r.photos.map(path => (
                                        <a key={path} href={photoUrls[path]} target="_blank" rel="noreferrer">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={photoUrls[path]} alt="續借照片" className="w-16 h-16 object-cover rounded border border-zinc-200" />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {ended.length > 0 && (
        <div className="card">
          <h2 className="font-medium text-zinc-900 mb-3">已結束</h2>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>老師</th><th>借用期間</th></tr>
              </thead>
              <tbody>
                {ended.map(loan => (
                  <tr key={loan.id}>
                    <td>
                      {loan.equipment_name}
                      {loan.equipment_asset_number && (
                        <span className="ml-1 text-xs text-zinc-400">#{loan.equipment_asset_number}</span>
                      )}
                    </td>
                    <td>
                      {loan.teacher_name}
                      {loan.is_external && <span className="badge-warn ml-1.5">系統外</span>}
                    </td>
                    <td>{loan.start_date} ～ {loan.due_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showImport && (
        <LongLoanImportModal
          onDone={summary => {
            setShowImport(false)
            onFlash(`匯入完成：新增 ${summary.createdCount} 筆、更新 ${summary.updatedCount} 筆`)
            runBusy('更新清單中…', () => load())
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}

/** 長期借用批次匯入 Modal：拖放 Excel → 預覽列數 → 送出 */
function LongLoanImportModal({
  onDone,
  onClose,
}: {
  onDone: (summary: { createdCount: number; updatedCount: number }) => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    setParseError('')
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
        if (parsed.length === 0) {
          setParseError('檔案中沒有資料列，請確認第一個工作表已填寫。')
          setRows([])
          return
        }
        if (parsed.every(r => !String(r['設備名稱'] ?? '').trim())) {
          setParseError('找不到「設備名稱」欄位資料，請使用系統提供的清單檔填寫。')
          setRows([])
          return
        }
        setRows(parsed)
        setFileName(file.name)
      } catch {
        setParseError('無法讀取檔案，請確認為 Excel（.xlsx）格式。')
        setRows([])
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
  })

  const submit = async () => {
    setImporting(true)
    try {
      const res = await fetch('/api/admin/equipment-long-loans-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? '匯入失敗')
        return
      }
      const notices: string[] = []
      if ((data.errors ?? []).length > 0) {
        notices.push(`以下列有問題被略過：\n${data.errors.join('\n')}`)
      }
      if ((data.warnings ?? []).length > 0) {
        notices.push(`請留意：\n${data.warnings.join('\n')}`)
      }
      if (notices.length > 0) {
        alert(`已套用 ${data.createdCount + data.updatedCount} 列。\n\n${notices.join('\n\n')}`)
      }
      onDone(data)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 className="font-semibold text-zinc-900">Excel 匯入長期借用</h3>
        <p className="text-sm text-zinc-500">
          請先「下載清單」（每台設備一列），下拉選<b>老師姓名</b>＋填<b>起訖日</b>後上傳；
          老師欄留空的列自動略過。已借出的設備改老師＝換人借用（原借用自動結束）、
          改日期＝調整期限；內容沒變的列不會重複寫入。
        </p>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded p-6 text-center text-sm cursor-pointer transition-colors ${
            isDragActive ? 'border-zinc-500 bg-zinc-50 text-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-50'
          }`}
        >
          <input {...getInputProps()} />
          {fileName
            ? <>已選擇：<span className="font-medium text-zinc-800">{fileName}</span>（{rows.length} 列）<br />點擊或拖放可更換檔案</>
            : '點擊選擇或拖放 Excel 檔案（.xlsx）'}
        </div>

        {parseError && <p className="text-sm text-red-600">{parseError}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={importing}>取消</button>
          <button className="btn-primary" onClick={submit} disabled={rows.length === 0 || importing}>
            {importing ? '匯入中…' : `匯入 ${rows.length} 列`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- 逾期統計 ----------

function StatsTab() {
  const [stats, setStats] = useState<StatsData | null>(null)

  useEffect(() => {
    fetch('/api/admin/equipment-stats').then(async res => {
      if (res.ok) setStats(await res.json())
    })
  }, [])

  if (!stats) return <div className="card"><p className="text-sm text-zinc-500">統計計算中…</p></div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        逾期定義：借用日當天結束仍未歸還，時長以天計。統計母體為實際完成借用手續的紀錄，可作為借用政策調整的參考。
      </p>

      <div className="card">
        <h2 className="font-medium text-zinc-900 mb-3">老師逾期排行</h2>
        {stats.teacherStats.length === 0 ? (
          <p className="text-sm text-zinc-500">目前沒有逾期紀錄，太棒了！</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>老師</th><th>借用次數</th><th>逾期次數</th><th>累計逾期</th><th>平均逾期</th><th>最長一次</th></tr>
              </thead>
              <tbody>
                {stats.teacherStats.map(t => (
                  <tr key={t.teacher_id}>
                    <td className="font-medium">{t.name}</td>
                    <td>{t.total}</td>
                    <td>{t.overdue}</td>
                    <td>{t.totalDays} 天</td>
                    <td>{t.avgDays} 天</td>
                    <td>{t.maxDays} 天</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-medium text-zinc-900 mb-3">設備逾期排行（哪個設備最容易被忘記還）</h2>
        {stats.equipmentStats.length === 0 ? (
          <p className="text-sm text-zinc-500">尚無借用資料。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>借用次數</th><th>逾期次數</th><th>逾期率</th><th>最長一次</th></tr>
              </thead>
              <tbody>
                {stats.equipmentStats.map(e => (
                  <tr key={e.equipment_id}>
                    <td className="font-medium">{e.name}</td>
                    <td>{e.total}</td>
                    <td>{e.overdue}</td>
                    <td>{e.rate}%</td>
                    <td>{e.maxDays} 天</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-medium text-zinc-900 mb-3">每月趨勢</h2>
        {stats.monthly.length === 0 ? (
          <p className="text-sm text-zinc-500">尚無借用資料。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>月份</th><th>借用件數</th><th>逾期件數</th><th>逾期率</th></tr>
              </thead>
              <tbody>
                {stats.monthly.map(m => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{m.loans}</td>
                    <td>{m.overdue}</td>
                    <td>{m.loans > 0 ? Math.round((m.overdue / m.loans) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-medium text-zinc-900 mb-3">長期借用續借逾期</h2>
        {stats.longOverdue.length === 0 ? (
          <p className="text-sm text-zinc-500">沒有續借逾期的長期借用。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>老師</th><th>到期日</th><th>已逾期</th></tr>
              </thead>
              <tbody>
                {stats.longOverdue.map(l => (
                  <tr key={l.id}>
                    <td>{l.equipment_name}</td>
                    <td>{l.teacher_name}</td>
                    <td>{l.due_date}</td>
                    <td><span className="badge-warn">{l.overdueDays} 天</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
