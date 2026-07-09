'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { OFFICE_ORDER, type StaffRosterRow } from '@/lib/staff'

interface TeacherOption { id: string; name: string | null; email: string }

interface RosterData {
  roster: StaffRosterRow[]
  teachers: TeacherOption[]
  currentSchoolYear: number | null
  preferenceYear: number | null
}

interface AdminUser { id: string; name: string | null; email: string }

export default function SystemClient({
  initialSchoolName,
  isSuperAdmin,
}: {
  initialSchoolName: string
  isSuperAdmin: boolean
}) {
  const [tab, setTab] = useState<'prefs' | 'permissions'>('prefs')
  const [data, setData] = useState<RosterData | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/admin/staff-roster')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '載入失敗')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗，請重新整理頁面。')
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900">系統偏好</h1>

      <div className="flex gap-1 border-b border-zinc-200">
        {([['prefs', '系統偏好'], ['permissions', '權限管理']] as const).map(([key, label]) => (
          <button
            key={key}
            className={cn(
              'px-4 py-2 text-sm border-b-2 -mb-px',
              tab === key
                ? 'border-zinc-800 font-medium text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 !p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button className="btn-secondary mt-2" onClick={load}>重新載入</button>
        </div>
      )}

      {tab === 'prefs' ? (
        <div className="space-y-4">
          <SchoolNameCard initialSchoolName={initialSchoolName} />
          <SchoolYearCard data={data} isSuperAdmin={isSuperAdmin} onChanged={load} />
        </div>
      ) : (
        <div className="space-y-4">
          <RosterCard data={data} onChanged={load} />
          <AdminsCard isSuperAdmin={isSuperAdmin} />
        </div>
      )}
    </div>
  )
}

// ── 學校名稱（原有設定） ──────────────────────────────────
function SchoolNameCard({ initialSchoolName }: { initialSchoolName: string }) {
  const [schoolName, setSchoolName] = useState(initialSchoolName)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_name: schoolName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(`儲存失敗：${data.error}`)
        return
      }
      setMessage('已儲存，重新整理頁面後標題即更新。')
      setTimeout(() => setMessage(''), 5000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <span className="label">學校名稱</span>
        <input
          className="input"
          placeholder="例：快樂國小"
          value={schoolName}
          onChange={e => setSchoolName(e.target.value)}
        />
        <p className="text-xs text-zinc-500 mt-1.5">
          網站標題與側欄名稱會顯示為「{schoolName.trim() || '（學校名稱）'}教師系統」；留空則顯示「教師系統」。
        </p>
      </div>
      <div className="flex items-center justify-end gap-3">
        {message && <span className="text-sm text-zinc-600">{message}</span>}
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
      </div>
    </div>
  )
}

// ── 學年度 ────────────────────────────────────────────────
function SchoolYearCard({
  data,
  isSuperAdmin,
  onChanged,
}: {
  data: RosterData | null
  isSuperAdmin: boolean
  onChanged: () => void
}) {
  const [working, setWorking] = useState(false)
  const [initYear, setInitYear] = useState('')

  const current = data?.currentSchoolYear ?? null
  const pref = data?.preferenceYear ?? null

  async function startYear(year: number) {
    if (working) return
    const isReimport = year === current
    const confirmText = isReimport
      ? `重新從 ${year} 學年度的工作紀錄帶入行政職務名單？權限頁的手動改動會被該年名單覆蓋（開關設定保留）。`
      : `開始 ${year} 學年度？全校運作基準（含行政人員權限）會切換到 ${year} 年的職務名單。`
    if (!confirm(confirmText)) return
    setWorking(true)
    try {
      const res = await fetch('/api/admin/school-year', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '切換失敗，請再試一次。')
        return
      }
      const vacantMsg = json.vacant?.length
        ? `\n以下職務該年沒有人擔任，已留空：${json.vacant.join('、')}`
        : ''
      alert(`已${isReimport ? '重新帶入' : `開始 ${year} 學年度`}，帶入 ${json.imported} 個職務。${vacantMsg}\n請到「權限管理」分頁確認名單並開啟權限。`)
      onChanged()
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="card space-y-1">
      <h3 className="text-sm font-semibold text-zinc-700 mb-3">學年度</h3>

      <div className="flex flex-wrap items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-700">
            進行中的學年度 <span className="badge-default">全校運作基準</span>
          </div>
          <p className="mt-1 max-w-sm text-xs text-zinc-500">
            行政人員權限以這個學年的職務名單為準。切換時會自動從該年工作紀錄帶入權限名冊。
          </p>
        </div>
        <div className="text-right">
          {current ? (
            <>
              <div className="text-2xl font-semibold text-zinc-900">
                {current}<span className="ml-0.5 text-sm font-medium text-zinc-500">學年度</span>
              </div>
              {isSuperAdmin ? (
                <div className="mt-1 flex flex-col items-end gap-1">
                  <button className="btn-primary" disabled={working} onClick={() => startYear(current + 1)}>
                    {working ? '處理中…' : `開始 ${current + 1} 學年度`}
                  </button>
                  <button
                    className="text-xs text-zinc-400 underline-offset-2 hover:underline"
                    disabled={working}
                    onClick={() => startYear(current)}
                  >
                    重新帶入 {current} 年名單
                  </button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">僅最高管理者可切換</p>
              )}
            </>
          ) : isSuperAdmin ? (
            <div className="flex items-center gap-2">
              <input
                className="input !w-24"
                placeholder="例：114"
                value={initYear}
                onChange={e => setInitYear(e.target.value)}
              />
              <button
                className="btn-primary"
                disabled={working || !/^\d{3}$/.test(initYear)}
                onClick={() => startYear(Number(initYear))}
              >
                設定
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">尚未設定（請最高管理者設定）</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-zinc-100 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-zinc-700">規劃中的年度</div>
          <p className="mt-1 text-xs text-zinc-500">
            志願選填、配課、排課正在處理的年度，由既有的「啟動下一年度」推進。
          </p>
        </div>
        <div className="text-2xl font-semibold text-zinc-900">
          {pref ?? '—'}{pref && <span className="ml-0.5 text-sm font-medium text-zinc-500">學年度</span>}
        </div>
      </div>
    </div>
  )
}

// ── 行政人員權限名冊 ──────────────────────────────────────
function RosterCard({
  data,
  onChanged,
}: {
  data: RosterData | null
  onChanged: () => void
}) {
  const [busyDuty, setBusyDuty] = useState('')

  async function update(duty: string, fields: { teacher_id?: string | null; enabled?: boolean }) {
    setBusyDuty(duty)
    try {
      const res = await fetch('/api/admin/staff-roster', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duty, ...fields }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        alert(json?.error ?? '更新失敗，請再試一次。')
        return
      }
      onChanged()
    } finally {
      setBusyDuty('')
    }
  }

  async function toggleOffice(office: string, enabled: boolean) {
    const duties = (data?.roster ?? []).filter(r => r.office === office)
    for (const r of duties) {
      if (r.enabled !== enabled) await update(r.duty, { enabled })
    }
  }

  if (!data) return <div className="card"><p className="text-sm text-zinc-400">載入中…</p></div>

  const roster = data.roster
  if (roster.length === 0) {
    return (
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">行政人員權限</h3>
        <p className="text-sm text-zinc-500">
          名冊是空的——請先在「系統偏好」分頁設定學年度，系統會從該年的工作紀錄帶入各處室職務名單。
        </p>
      </div>
    )
  }

  return (
    <div className="card !p-4">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700">行政人員權限</h3>
      <p className="mb-3 text-xs text-zinc-500">
        開啟的職務可進入管理端使用「公告管理」與「行事曆管理」（假日維護僅註冊組長）。
        中途換人直接在這裡改，<strong>最終權限以此名冊為準</strong>。
      </p>
      <div className="space-y-4">
        {OFFICE_ORDER.map(office => {
          const duties = roster.filter(r => r.office === office)
          if (duties.length === 0) return null
          const allOn = duties.every(d => d.enabled)
          const anyOn = duties.some(d => d.enabled)
          return (
            <div key={office}>
              <div className="mb-1 flex items-center justify-between border-b border-zinc-100 pb-1">
                <span className="text-sm font-medium text-zinc-800">
                  {office}
                  {anyOn && <span className="badge-success ml-2">{duties.filter(d => d.enabled).length} 職務啟用</span>}
                </span>
                <button
                  className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                  onClick={() => toggleOffice(office, !allOn)}
                >
                  {allOn ? '整處室關閉' : '整處室開啟'}
                </button>
              </div>
              <ul>
                {duties.map(r => (
                  <li key={r.duty} className="flex items-center gap-2 py-1.5">
                    <label className="flex w-24 flex-shrink-0 items-center gap-2 text-sm text-zinc-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-zinc-700"
                        checked={r.enabled}
                        disabled={busyDuty === r.duty}
                        onChange={e => update(r.duty, { enabled: e.target.checked })}
                      />
                      {r.duty}
                    </label>
                    <select
                      className="input flex-1 !py-1.5"
                      value={r.teacher_id ?? ''}
                      disabled={busyDuty === r.duty}
                      onChange={e => update(r.duty, { teacher_id: e.target.value || null })}
                    >
                      <option value="">（未指定）</option>
                      {data.teachers.map(t => (
                        <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 管理員設定（自原「Admin 管理」頁搬入） ─────────────────
function AdminsCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [admins, setAdmins] = useState<AdminUser[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadAdmins = useCallback(async () => {
    const res = await fetch('/api/admin/add-admin')
    if (res.ok) setAdmins(await res.json())
  }, [])

  useEffect(() => { loadAdmins() }, [loadAdmins])

  async function handleAdd() {
    if (!email.trim()) return
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/add-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: `已成功授予 ${data.name || email} 管理員權限` })
      setEmail('')
      loadAdmins()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : '操作失敗' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h3 className="mb-1 text-sm font-semibold text-zinc-700">管理員設定</h3>
      <p className="mb-3 text-xs text-zinc-500">
        管理員擁有全部管理功能。輸入教師的學校 Google 信箱即可授予；該教師必須已登入過本系統。
      </p>
      {isSuperAdmin ? (
        <>
          {message && (
            <div className={cn(
              'mb-3 border px-4 py-2 text-sm',
              message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            )}>
              {message.text}
            </div>
          )}
          <div className="mb-4 flex gap-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teacher@school.edu.tw"
              className="input flex-1"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button onClick={handleAdd} disabled={loading || !email.trim()} className="btn-primary">
              {loading ? '處理中…' : '授予權限'}
            </button>
          </div>
        </>
      ) : (
        <p className="mb-3 text-sm text-zinc-400">僅最高管理者可新增或移除管理員。</p>
      )}
      {admins.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>姓名</th><th>電子信箱</th></tr>
            </thead>
            <tbody>
              {admins.map(a => (
                <tr key={a.id}>
                  <td>{a.name ?? '—'}</td>
                  <td className="text-zinc-500">{a.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
