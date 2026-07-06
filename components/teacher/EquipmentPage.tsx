'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageLoading } from '@/components/ui/PageLoading'
import {
  LOAN_STATUS_LABEL,
  periodLabel,
  periodsText,
  type ChecklistItem,
  type ChecklistResult,
} from '@/lib/equipment'

// ---------- 型別 ----------

interface EquipmentRow {
  id: string
  name: string
  location: string
  peripherals: string[]
  borrow_checklist: ChecklistItem[]
  return_checklist: ChecklistItem[]
}

interface LoanRow {
  id: string
  equipment_id: string
  equipment_name: string
  loan_date: string
  periods: string[]
  status: string
}

interface ShortData {
  config: {
    openPeriods: string[]
    agreements: { borrow: string; return: string }
    maxPhotos: number
    today: string
    maxDate: string
  }
  date: string
  equipment: EquipmentRow[]
  occupied: Record<string, string[]>
  myLoans: LoanRow[]
}

interface LongLoanRow {
  id: string
  equipment_name: string
  equipment_location: string
  peripherals: string[]
  start_date: string
  due_date: string
  status: string
  renewable: boolean
  overdue: boolean
  renewals: { id: string; agreed_at: string; old_due_date: string; new_due_date: string }[]
}

interface LongData {
  config: {
    renewalWeeks: number
    renewalNoticeDays: number
    maxPhotos: number
    agreements: { longterm: string; renewal: string }
  }
  today: string
  loans: LongLoanRow[]
}

interface UploadedPhoto {
  path: string
  url: string
}

/** 進行中的手續 Modal 狀態 */
type Procedure =
  | { kind: 'borrow' | 'return'; loan: LoanRow; checklist: ChecklistItem[]; agreement: string }
  | { kind: 'renewal'; loan: LongLoanRow; agreement: string }

// ---------- 主頁 ----------

export function EquipmentPage() {
  const [tab, setTab] = useState<'short' | 'long'>('short')
  const [shortData, setShortData] = useState<ShortData | null>(null)
  const [longData, setLongData] = useState<LongData | null>(null)
  const [date, setDate] = useState('')
  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [error, setError] = useState('')

  const loadShort = useCallback(async (targetDate?: string) => {
    const query = targetDate ? `?date=${targetDate}` : ''
    const res = await fetch(`/api/teacher/equipment${query}`)
    if (!res.ok) {
      setError('載入失敗，請重新整理。')
      return
    }
    const data: ShortData = await res.json()
    setShortData(data)
    setDate(data.date)
  }, [])

  const loadLong = useCallback(async () => {
    const res = await fetch('/api/teacher/equipment/long-loans')
    if (res.ok) setLongData(await res.json())
  }, [])

  useEffect(() => {
    loadShort()
    loadLong()
  }, [loadShort, loadLong])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!shortData) return <PageLoading />

  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-lg font-semibold text-zinc-900">設備借用</h1>

      {/* Tab 切換 */}
      <div className="flex border-b border-zinc-200">
        {([['short', '短期借用'], ['long', '長期借用']] as const).map(([key, label]) => (
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

      {tab === 'short' ? (
        <ShortTab
          data={shortData}
          date={date}
          onDateChange={d => {
            setDate(d)
            loadShort(d)
          }}
          onReload={() => loadShort(date)}
          onStartProcedure={(kind, loan) => {
            const equip = shortData.equipment.find(e => e.id === loan.equipment_id)
            setProcedure({
              kind,
              loan,
              checklist: (kind === 'borrow' ? equip?.borrow_checklist : equip?.return_checklist) ?? [],
              agreement: kind === 'borrow' ? shortData.config.agreements.borrow : shortData.config.agreements.return,
            })
          }}
        />
      ) : longData ? (
        <LongTab
          data={longData}
          onStartRenewal={loan =>
            setProcedure({ kind: 'renewal', loan, agreement: longData.config.agreements.renewal })
          }
        />
      ) : (
        <PageLoading />
      )}

      {procedure && procedure.kind !== 'renewal' && (
        <ProcedureModal
          kind={procedure.kind}
          loan={procedure.loan}
          checklist={procedure.checklist}
          agreement={procedure.agreement}
          maxPhotos={shortData.config.maxPhotos}
          onDone={() => {
            setProcedure(null)
            loadShort(date)
          }}
          onClose={() => setProcedure(null)}
        />
      )}
      {procedure && procedure.kind === 'renewal' && longData && (
        <RenewalModal
          loan={procedure.loan}
          agreement={procedure.agreement}
          maxPhotos={longData.config.maxPhotos}
          renewalWeeks={longData.config.renewalWeeks}
          onDone={() => {
            setProcedure(null)
            loadLong()
          }}
          onClose={() => setProcedure(null)}
        />
      )}
    </div>
  )
}

// ---------- 短期借用 ----------

function ShortTab({
  data,
  date,
  onDateChange,
  onReload,
  onStartProcedure,
}: {
  data: ShortData
  date: string
  onDateChange: (date: string) => void
  onReload: () => void
  onStartProcedure: (kind: 'borrow' | 'return', loan: LoanRow) => void
}) {
  // 每台設備目前勾選的節次
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [submitting, setSubmitting] = useState('')

  const togglePeriod = (equipmentId: string, period: string) => {
    setSelected(prev => {
      const current = prev[equipmentId] ?? []
      return {
        ...prev,
        [equipmentId]: current.includes(period)
          ? current.filter(p => p !== period)
          : [...current, period],
      }
    })
  }

  const reserve = async (equipmentId: string) => {
    const periods = selected[equipmentId] ?? []
    if (periods.length === 0) return
    setSubmitting(equipmentId)
    try {
      const res = await fetch('/api/teacher/equipment/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipment_id: equipmentId, date, periods }),
      })
      const result = await res.json()
      if (!res.ok) {
        alert(result.error ?? '預約失敗')
      } else {
        setSelected(prev => ({ ...prev, [equipmentId]: [] }))
      }
      onReload()
    } finally {
      setSubmitting('')
    }
  }

  const cancel = async (loan: LoanRow) => {
    if (!confirm(`確定取消 ${loan.loan_date}「${loan.equipment_name}」的預約？`)) return
    const res = await fetch('/api/teacher/equipment/loans', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: loan.id, action: 'cancel' }),
    })
    const result = await res.json()
    if (!res.ok) alert(result.error ?? '取消失敗')
    onReload()
  }

  const activeLoans = data.myLoans.filter(l => l.status === 'reserved' || l.status === 'borrowed')
  const historyLoans = data.myLoans.filter(l => l.status !== 'reserved' && l.status !== 'borrowed')

  return (
    <div className="space-y-4">
      {/* 我的借用（進行中） */}
      {activeLoans.length > 0 && (
        <div className="card space-y-3">
          <h2 className="font-medium text-zinc-900">我的借用</h2>
          {activeLoans.map(loan => (
            <div key={loan.id} className="flex flex-wrap items-center gap-2 border border-zinc-200 rounded p-3">
              <div className="flex-1 min-w-[180px]">
                <div className="text-sm font-medium text-zinc-900">{loan.equipment_name}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {loan.loan_date}｜{periodsText(loan.periods)}
                </div>
              </div>
              <span className={loan.status === 'borrowed' ? 'badge-warn' : 'badge-default'}>
                {LOAN_STATUS_LABEL[loan.status]}
              </span>
              {loan.status === 'reserved' && (
                <>
                  <button className="btn-primary !px-3 !py-1.5" onClick={() => onStartProcedure('borrow', loan)}>
                    開始借用
                  </button>
                  <button className="btn-secondary !px-3 !py-1.5" onClick={() => cancel(loan)}>
                    取消預約
                  </button>
                </>
              )}
              {loan.status === 'borrowed' && (
                <button className="btn-primary !px-3 !py-1.5" onClick={() => onStartProcedure('return', loan)}>
                  辦理歸還
                </button>
              )}
            </div>
          ))}
          <p className="text-xs text-zinc-400">
            預約後請於借用時完成「開始借用」手續；完成手續後不可自行取消，須辦理歸還。
          </p>
        </div>
      )}

      {/* 可借設備 */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium text-zinc-900">預約借用</h2>
          <input
            type="date"
            className="input !w-auto"
            value={date}
            min={data.config.today}
            max={data.config.maxDate}
            onChange={e => onDateChange(e.target.value)}
          />
        </div>

        {data.equipment.length === 0 ? (
          <p className="text-sm text-zinc-500">目前沒有可借用的設備。</p>
        ) : (
          data.equipment.map(equip => {
            const occupied = data.occupied[equip.id] ?? []
            const chosen = selected[equip.id] ?? []
            return (
              <div key={equip.id} className="border border-zinc-200 rounded p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium text-zinc-900">{equip.name}</span>
                    {equip.location && <span className="ml-2 text-xs text-zinc-500">存放：{equip.location}</span>}
                  </div>
                  <button
                    className="btn-primary !px-3 !py-1.5"
                    disabled={chosen.length === 0 || submitting === equip.id}
                    onClick={() => reserve(equip.id)}
                  >
                    {submitting === equip.id ? '預約中…' : chosen.length > 0 ? `預約 ${chosen.length} 個時段` : '預約借用'}
                  </button>
                </div>
                {(equip.peripherals ?? []).length > 0 && (
                  <div className="text-xs text-zinc-500">週邊：{(equip.peripherals ?? []).join('、')}</div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {data.config.openPeriods.map(period => {
                    const taken = occupied.includes(period)
                    const active = chosen.includes(period)
                    return (
                      <button
                        key={period}
                        disabled={taken}
                        className={`px-2.5 py-1 text-xs border rounded transition-colors ${
                          taken
                            ? 'bg-zinc-100 text-zinc-300 border-zinc-200 cursor-not-allowed line-through'
                            : active
                              ? 'bg-zinc-800 text-white border-zinc-800'
                              : 'bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50'
                        }`}
                        onClick={() => togglePeriod(equip.id, period)}
                      >
                        {periodLabel(period)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 歷史紀錄 */}
      {historyLoans.length > 0 && (
        <div className="card">
          <h2 className="font-medium text-zinc-900 mb-3">近期紀錄</h2>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>日期</th><th>設備</th><th>時段</th><th>狀態</th></tr>
              </thead>
              <tbody>
                {historyLoans.map(loan => (
                  <tr key={loan.id}>
                    <td>{loan.loan_date}</td>
                    <td>{loan.equipment_name}</td>
                    <td>{periodsText(loan.periods)}</td>
                    <td>
                      <span className={loan.status === 'returned' ? 'badge-success' : 'badge-default'}>
                        {LOAN_STATUS_LABEL[loan.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- 長期借用 ----------

function LongTab({
  data,
  onStartRenewal,
}: {
  data: LongData
  onStartRenewal: (loan: LongLoanRow) => void
}) {
  const active = data.loans.filter(l => l.status === 'active')
  const ended = data.loans.filter(l => l.status !== 'active')

  if (data.loans.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-zinc-500">目前沒有長期借用的設備。長期借用由管理者設定。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h2 className="font-medium text-zinc-900">長期借用中</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            到期前 {data.config.renewalNoticeDays} 天可辦理續借回傳，回傳後自動展期 {data.config.renewalWeeks} 週。
          </p>
        </div>
        {active.length === 0 && <p className="text-sm text-zinc-500">（無）</p>}
        {active.map(loan => (
          <div key={loan.id} className="border border-zinc-200 rounded p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-900 flex-1 min-w-[160px]">{loan.equipment_name}</span>
              {loan.overdue ? (
                <span className="badge-warn">已到期，請儘速回傳</span>
              ) : loan.renewable ? (
                <span className="badge-warn">即將到期</span>
              ) : (
                <span className="badge-success">借用中</span>
              )}
              {loan.renewable && (
                <button className="btn-primary !px-3 !py-1.5" onClick={() => onStartRenewal(loan)}>
                  續借回傳
                </button>
              )}
            </div>
            <div className="text-xs text-zinc-500">
              {loan.start_date} 起借｜到期日 {loan.due_date}
              {loan.equipment_location && `｜存放：${loan.equipment_location}`}
            </div>
            {(loan.peripherals ?? []).length > 0 && (
              <div className="text-xs text-zinc-500">週邊：{(loan.peripherals ?? []).join('、')}</div>
            )}
            {loan.renewals.length > 0 && (
              <div className="text-xs text-zinc-400">
                已續借 {loan.renewals.length} 次，最近：{loan.renewals[0].agreed_at.slice(0, 10)}
              </div>
            )}
          </div>
        ))}
      </div>

      {ended.length > 0 && (
        <div className="card">
          <h2 className="font-medium text-zinc-900 mb-3">已結束</h2>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>借用期間</th></tr>
              </thead>
              <tbody>
                {ended.map(loan => (
                  <tr key={loan.id}>
                    <td>{loan.equipment_name}</td>
                    <td>{loan.start_date} ～ {loan.due_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- 借用/歸還手續 Modal（同意書 → 檢查拍照） ----------

function ProcedureModal({
  kind,
  loan,
  checklist,
  agreement,
  maxPhotos,
  onDone,
  onClose,
}: {
  kind: 'borrow' | 'return'
  loan: LoanRow
  checklist: ChecklistItem[]
  agreement: string
  maxPhotos: number
  onDone: () => void
  onClose: () => void
}) {
  const title = kind === 'borrow' ? '借用手續' : '歸還手續'
  const [step, setStep] = useState<1 | 2>(1)
  const [agreed, setAgreed] = useState(false)
  const [checks, setChecks] = useState<boolean[]>(checklist.map(() => false))
  const [photos, setPhotos] = useState<UploadedPhoto[][]>(checklist.map(() => []))
  const [submitting, setSubmitting] = useState(false)

  const canSubmit =
    checks.every(Boolean) &&
    checklist.every((item, i) => !item.requiresPhoto || photos[i].length > 0)

  const submit = async () => {
    setSubmitting(true)
    try {
      const result: ChecklistResult[] = checklist.map((item, i) => ({
        ...item,
        checked: checks[i],
        photos: photos[i].map(p => p.path),
      }))
      const res = await fetch('/api/teacher/equipment/loans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loan.id, action: kind, agree: true, checklist: result }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? '送出失敗')
        return
      }
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="font-semibold text-zinc-900">
            {title}（{step}/2）：{loan.equipment_name}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {loan.loan_date}｜{periodsText(loan.periods)}
          </p>
        </div>

        {step === 1 ? (
          <>
            <div className="border border-zinc-200 rounded p-3 text-sm text-zinc-700 whitespace-pre-wrap bg-zinc-50">
              {agreement || '（管理者尚未設定同意書內容）'}
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
              我已閱讀並同意上述內容
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose}>取消</button>
              <button className="btn-primary" disabled={!agreed} onClick={() => setStep(2)}>下一步</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-zinc-600">
              {kind === 'borrow' ? '請確認設備位置與週邊配件並完成檢查：' : '請將設備歸回原位並完成檢查：'}
            </p>
            {checklist.length === 0 && <p className="text-sm text-zinc-400">（無檢查項目，直接送出即可）</p>}
            <div className="space-y-3">
              {checklist.map((item, i) => (
                <div key={i} className="border border-zinc-200 rounded p-3 space-y-2">
                  <label className="flex items-start gap-2 text-sm text-zinc-800 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checks[i]}
                      onChange={e => setChecks(cs => cs.map((c, j) => (j === i ? e.target.checked : c)))}
                    />
                    <span>
                      {item.label}
                      {item.requiresPhoto && <span className="ml-1 text-xs text-amber-600">（需拍照）</span>}
                    </span>
                  </label>
                  {item.requiresPhoto && (
                    <PhotoUploader
                      photos={photos[i]}
                      max={maxPhotos}
                      onChange={list => setPhotos(ps => ps.map((p, j) => (j === i ? list : p)))}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between gap-2">
              <button className="btn-secondary" onClick={() => setStep(1)}>上一步</button>
              <button className="btn-primary" disabled={!canSubmit || submitting} onClick={submit}>
                {submitting ? '送出中…' : kind === 'borrow' ? '完成借用' : '完成歸還'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- 續借回傳 Modal ----------

function RenewalModal({
  loan,
  agreement,
  maxPhotos,
  renewalWeeks,
  onDone,
  onClose,
}: {
  loan: LongLoanRow
  agreement: string
  maxPhotos: number
  renewalWeeks: number
  onDone: () => void
  onClose: () => void
}) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/teacher/equipment/long-loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: loan.id, photos: photos.map(p => p.path), agree: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? '送出失敗')
        return
      }
      alert(`續借完成，新到期日：${data.new_due_date}`)
      onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="font-semibold text-zinc-900">續借回傳：{loan.equipment_name}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            到期日 {loan.due_date}，回傳後自動展期 {renewalWeeks} 週。
          </p>
        </div>

        <div>
          <span className="label">請拍攝設備現況照片（至少 1 張）</span>
          <PhotoUploader photos={photos} max={maxPhotos} onChange={setPhotos} />
        </div>

        <div className="border border-zinc-200 rounded p-3 text-sm text-zinc-700 whitespace-pre-wrap bg-zinc-50">
          {agreement || '（管理者尚未設定同意書內容）'}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          我已閱讀並同意繼續長期借用本設備
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={photos.length === 0 || !agreed || submitting} onClick={submit}>
            {submitting ? '送出中…' : '送出續借'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- 拍照上傳 ----------

function PhotoUploader({
  photos,
  max,
  onChange,
}: {
  photos: UploadedPhoto[]
  max: number
  onChange: (photos: UploadedPhoto[]) => void
}) {
  const [uploading, setUploading] = useState(false)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const uploaded: UploadedPhoto[] = []
      for (const file of Array.from(files).slice(0, max - photos.length)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/teacher/equipment/photo', { method: 'POST', body: form })
        const data = await res.json()
        if (!res.ok) {
          alert(data.error ?? '照片上傳失敗')
          continue
        }
        uploaded.push({ path: data.path, url: data.url })
      }
      onChange([...photos, ...uploaded])
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {photos.map(photo => (
          <div key={photo.path} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="上傳照片" className="w-20 h-20 object-cover rounded border border-zinc-200" />
            <button
              type="button"
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-700 text-white text-xs leading-none"
              onClick={() => onChange(photos.filter(p => p.path !== photo.path))}
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < max && (
          <label className="w-20 h-20 border border-dashed border-zinc-300 rounded flex flex-col items-center justify-center text-zinc-400 text-xs cursor-pointer hover:bg-zinc-50">
            {uploading ? '上傳中…' : <>📷<span className="mt-0.5">拍照/選圖</span></>}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={e => {
                upload(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>
      <p className="text-xs text-zinc-400">最多 {max} 張</p>
    </div>
  )
}
