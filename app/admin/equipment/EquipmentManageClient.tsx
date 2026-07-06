'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import {
  LOAN_STATUS_LABEL,
  overdueDays,
  periodsText,
  renderOverdueMessage,
  todayStr,
  type ChecklistResult,
} from '@/lib/equipment'

interface EquipmentOption { id: string; name: string; status: string; asset_number: string }
interface TeacherOption { id: string; name: string }

interface AdminLoanRow {
  id: string
  equipment_id: string
  equipment_name: string
  teacher_id: string
  teacher_name: string
  equipment_asset_number: string
  loan_date: string
  periods: string[]
  status: string
  borrow_agreed_at: string | null
  borrow_checklist: ChecklistResult[] | null
  borrowed_at: string | null
  return_agreed_at: string | null
  return_checklist: ChecklistResult[] | null
  returned_at: string | null
}

interface AdminLongLoanRow {
  id: string
  equipment_id: string
  equipment_name: string
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
  teachers,
  overdueTemplate,
  renewalWeeks,
}: {
  equipment: EquipmentOption[]
  teachers: TeacherOption[]
  overdueTemplate: string
  renewalWeeks: number
}) {
  const [tab, setTab] = useState<'short' | 'long' | 'stats'>('short')
  const [message, setMessage] = useState('')

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 3000)
  }

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
        {([['short', '短期借用'], ['long', '長期借用'], ['stats', '逾期統計']] as const).map(([key, label]) => (
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

      {tab === 'short' && <ShortLoansTab equipment={equipment} onCopy={copyOverdueMessage} onFlash={flash} />}
      {tab === 'long' && (
        <LongLoansTab
          equipment={equipment}
          teachers={teachers}
          renewalWeeks={renewalWeeks}
          onCopy={copyOverdueMessage}
          onFlash={flash}
        />
      )}
      {tab === 'stats' && <StatsTab />}
    </div>
  )
}

// ---------- 短期借用 ----------

function ShortLoansTab({
  equipment,
  onCopy,
  onFlash,
}: {
  equipment: EquipmentOption[]
  onCopy: (vars: { teacher: string; equipment: string; date: string; periods: string }) => void
  onFlash: (text: string) => void
}) {
  const [filters, setFilters] = useState({ equipment_name: '', from: '', to: '', status: '' })
  const [loans, setLoans] = useState<AdminLoanRow[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState('')
  const [loading, setLoading] = useState(true)
  const today = todayStr()

  // 同名設備視為同一類：下拉去重，選定後一次查詢所有同名設備
  const equipmentNames = Array.from(new Set(equipment.map(eq => eq.name)))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.equipment_name) {
        const ids = equipment.filter(eq => eq.name === filters.equipment_name).map(eq => eq.id)
        params.set('equipment_ids', ids.join(','))
      }
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.status) params.set('status', filters.status)
      const res = await fetch(`/api/admin/equipment-loans?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setLoans(data.loans)
      setPhotoUrls(data.photoUrls)
    } finally {
      setLoading(false)
    }
  }, [filters, equipment])

  useEffect(() => { load() }, [load])

  const closeLoan = async (loan: AdminLoanRow) => {
    if (!confirm(`確定將 ${loan.teacher_name} 借用的「${loan.equipment_name}」代為結案？`)) return
    const res = await fetch('/api/admin/equipment-loans', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: loan.id }),
    })
    const data = await res.json()
    if (!res.ok) alert(data.error ?? '結案失敗')
    else onFlash('已結案')
    load()
  }

  const isOverdue = (loan: AdminLoanRow) => loan.status === 'borrowed' && loan.loan_date < today

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <span className="label">設備</span>
            <select className="input" value={filters.equipment_name}
              onChange={e => setFilters(f => ({ ...f, equipment_name: e.target.value }))}>
              <option value="">全部</option>
              {equipmentNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
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
            <span className="label">狀態</span>
            <select className="input" value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
              <option value="">全部</option>
              {Object.entries(LOAN_STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : loans.length === 0 ? (
          <p className="text-sm text-zinc-500">沒有符合條件的借用紀錄。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>日期</th><th>設備</th><th>老師</th><th>時段</th><th>狀態</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loans.map(loan => (
                  <Fragment key={loan.id}>
                    <tr>
                      <td className="whitespace-nowrap">{loan.loan_date}</td>
                      <td>
                        {loan.equipment_name}
                        {loan.equipment_asset_number && (
                          <span className="ml-1 text-xs text-zinc-400">#{loan.equipment_asset_number}</span>
                        )}
                      </td>
                      <td>{loan.teacher_name}</td>
                      <td>{periodsText(loan.periods)}</td>
                      <td className="whitespace-nowrap">
                        <span className={
                          loan.status === 'returned' ? 'badge-success'
                          : isOverdue(loan) ? 'badge-warn'
                          : 'badge-default'
                        }>
                          {isOverdue(loan)
                            ? `逾期 ${overdueDays(loan.loan_date, null, today)} 天`
                            : LOAN_STATUS_LABEL[loan.status] ?? loan.status}
                        </span>
                      </td>
                      <td className="text-right whitespace-nowrap space-x-1">
                        {isOverdue(loan) && (
                          <button
                            className="btn-secondary !px-2.5 !py-1 text-xs"
                            onClick={() => onCopy({
                              teacher: loan.teacher_name,
                              equipment: loan.equipment_name,
                              date: loan.loan_date,
                              periods: periodsText(loan.periods),
                            })}
                          >
                            複製通知
                          </button>
                        )}
                        {(loan.status === 'borrowed' || loan.status === 'reserved') && (
                          <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => closeLoan(loan)}>
                            結案
                          </button>
                        )}
                        {(loan.borrow_checklist || loan.return_checklist) && (
                          <button
                            className="btn-secondary !px-2.5 !py-1 text-xs"
                            onClick={() => setExpanded(expanded === loan.id ? '' : loan.id)}
                          >
                            {expanded === loan.id ? '收合' : '明細'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === loan.id && (
                      <tr>
                        <td colSpan={6} className="!bg-zinc-50">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-1">
                            <ChecklistDetail
                              title={`借用檢查${loan.borrowed_at ? `（${loan.borrowed_at.slice(0, 16).replace('T', ' ')}）` : ''}`}
                              checklist={loan.borrow_checklist}
                              photoUrls={photoUrls}
                            />
                            <ChecklistDetail
                              title={`歸還檢查${loan.returned_at ? `（${loan.returned_at.slice(0, 16).replace('T', ' ')}）` : ''}`}
                              checklist={loan.return_checklist}
                              photoUrls={photoUrls}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
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
  teachers,
  renewalWeeks,
  onCopy,
  onFlash,
}: {
  equipment: EquipmentOption[]
  teachers: TeacherOption[]
  renewalWeeks: number
  onCopy: (vars: { teacher: string; equipment: string; date: string; periods: string }) => void
  onFlash: (text: string) => void
}) {
  const [loans, setLoans] = useState<AdminLongLoanRow[]>([])
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const today = todayStr()

  const defaultDue = () => {
    const d = new Date()
    d.setDate(d.getDate() + renewalWeeks * 7)
    return d.toISOString().slice(0, 10)
  }
  const [form, setForm] = useState({
    equipment_id: '', teacher_id: '', external_name: '', start_date: todayStr(), due_date: defaultDue(), notes: '',
  })
  const isExternal = form.teacher_id === '__external__'

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

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/equipment-long-loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          teacher_id: isExternal ? '' : form.teacher_id,
          external_name: isExternal ? form.external_name : '',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? '建立失敗')
        return
      }
      setForm(f => ({ ...f, equipment_id: '', teacher_id: '', external_name: '', notes: '' }))
      onFlash('已建立長期借用')
      load()
    } finally {
      setCreating(false)
    }
  }

  const endLoan = async (loan: AdminLongLoanRow) => {
    if (!confirm(`確定結束 ${loan.teacher_name} 的「${loan.equipment_name}」長期借用？`)) return
    const res = await fetch('/api/admin/equipment-long-loans', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: loan.id, action: 'end' }),
    })
    const data = await res.json()
    if (!res.ok) alert(data.error ?? '操作失敗')
    else onFlash('已結束借用')
    load()
  }

  const active = loans.filter(l => l.status === 'active')
  const ended = loans.filter(l => l.status !== 'active')

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <span className="label">設備</span>
            <select className="input" value={form.equipment_id}
              onChange={e => setForm(f => ({ ...f, equipment_id: e.target.value }))}>
              <option value="">請選擇</option>
              {equipment.filter(eq => eq.status !== 'retired').map(eq => (
                <option key={eq.id} value={eq.id}>
                  {eq.name}{eq.asset_number ? `（#${eq.asset_number}）` : ''}
                </option>
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
          <div className="flex items-end">
            <button
              className="btn-primary w-full"
              disabled={!form.equipment_id || !form.teacher_id || (isExternal && !form.external_name.trim()) || creating}
              onClick={create}
            >
              {creating ? '建立中…' : '建立'}
            </button>
          </div>
        </div>
        <input className="input" placeholder="備註（選填）" value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>

      {/* 列表 */}
      <div className="card">
        <h2 className="font-medium text-zinc-900 mb-3">長期借用中</h2>
        {loading ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-zinc-500">目前沒有長期借用。</p>
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
                        <td>{loan.equipment_name}</td>
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
                    <td>{loan.equipment_name}</td>
                    <td>{loan.teacher_name}</td>
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
            load()
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
