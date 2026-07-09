'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { OFFICE_ORDER, PERM_GROUPS, type StaffRosterRow } from '@/lib/staff'

interface TeacherOption { id: string; name: string | null; email: string }

interface RosterData {
  roster: StaffRosterRow[]
  teachers: TeacherOption[]
  currentSchoolYear: number | null
  preferenceYear: number | null
}

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
    <div className="space-y-4">
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
        <div className="max-w-3xl space-y-4">
          <SchoolNameCard initialSchoolName={initialSchoolName} />
          <SchoolYearCard data={data} isSuperAdmin={isSuperAdmin} onChanged={load} />
        </div>
      ) : (
        <RosterCard data={data} onChanged={load} />
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

// ── 行政人員權限矩陣（職務 × 管理頁面） ────────────────────
function RosterCard({
  data,
  onChanged,
}: {
  data: RosterData | null
  onChanged: () => void
}) {
  // 樂觀更新：畫面立即反映，背景送出；同一職務的請求依序排隊避免亂序覆蓋
  const [rows, setRows] = useState<StaffRosterRow[]>([])
  const [pending, setPending] = useState(0)     // 背景儲存中的請求數
  const [savedAt, setSavedAt] = useState('')    // 最近一次全部送達的時間
  const pendingRef = useRef(0)
  const queues = useRef(new Map<string, Promise<void>>())

  useEffect(() => {
    if (data) setRows(data.roster.map(r => ({ ...r, perms: Array.isArray(r.perms) ? r.perms : [] })))
  }, [data])

  function enqueue(duty: string, fields: { teacher_id?: string | null; perms?: string[] }) {
    pendingRef.current += 1
    setPending(pendingRef.current)
    const prev = queues.current.get(duty) ?? Promise.resolve()
    const next = prev.then(async () => {
      const res = await fetch('/api/admin/staff-roster', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duty, ...fields }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        alert(json?.error ?? '儲存失敗，畫面已還原為伺服器狀態。')
        onChanged()  // 失敗時以伺服器狀態重新同步
      }
    }).catch(() => { onChanged() }).finally(() => {
      pendingRef.current -= 1
      setPending(pendingRef.current)
      if (pendingRef.current === 0) {
        const d = new Date()
        setSavedAt(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
      }
    })
    queues.current.set(duty, next)
  }

  /** 更新本地列並回傳新值送出 */
  function patchRow(duty: string, fields: { teacher_id?: string | null; perms?: string[] }) {
    setRows(cur => cur.map(r => r.duty === duty ? { ...r, ...fields } : r))
    enqueue(duty, fields)
  }

  if (!data) return <div className="card"><p className="text-sm text-zinc-400">載入中…</p></div>

  if (rows.length === 0) {
    return (
      <div className="card">
        <h3 className="mb-2 text-sm font-semibold text-zinc-700">行政人員權限</h3>
        <p className="text-sm text-zinc-500">
          名冊是空的——請先在「系統偏好」分頁設定學年度，系統會從該年的工作紀錄帶入各處室職務名單。
        </p>
      </div>
    )
  }

  const roster = rows
  const allKeys = PERM_GROUPS.flatMap(g => g.perms.map(p => p.key))

  function togglePerm(r: StaffRosterRow, key: string) {
    const cur = new Set(r.perms)
    if (cur.has(key)) cur.delete(key)
    else cur.add(key)
    patchRow(r.duty, { perms: Array.from(cur) })
  }

  function setOfficeAll(office: string, grant: boolean) {
    if (!confirm(grant
      ? `將${office}全部職務勾選「全部頁面」權限？`
      : `清除${office}全部職務的所有權限？`)) return
    for (const r of rows.filter(x => x.office === office)) {
      patchRow(r.duty, { perms: grant ? allKeys : [] })
    }
  }

  return (
    <div className="card !p-4">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">行政人員權限</h3>
        <span className="text-xs" aria-live="polite">
          {pending > 0 ? (
            <span className="text-zinc-500">
              <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-zinc-300 border-t-zinc-600 align-[-2px]" />
              儲存中…
            </span>
          ) : savedAt ? (
            <span className="text-green-600">✓ 已儲存（{savedAt}）</span>
          ) : null}
        </span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        勾選＝該職務可使用該管理頁面；有任一勾選即可進入管理端。
        中途換人直接改「人員」欄，<strong>最終權限以此表為準</strong>。
        公告與行事曆的內容編輯範圍另依規則：主任可編本處室全部、組長僅能編自己發布的。
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ minWidth: '56rem' }}>
          <thead>
            <tr>
              <th rowSpan={2} className="sticky left-0 z-10 border-b border-r border-zinc-200 bg-zinc-50 px-2 py-2 text-left font-medium text-zinc-600">
                職務
              </th>
              <th rowSpan={2} className="border-b border-r border-zinc-200 bg-zinc-50 px-2 py-2 text-left font-medium text-zinc-600">
                人員
              </th>
              {PERM_GROUPS.map(g => (
                <th key={g.group} colSpan={g.perms.length}
                  className="border-b border-r border-zinc-200 bg-zinc-50 px-1 py-1.5 text-center text-[11px] font-semibold text-zinc-500">
                  {g.group}
                </th>
              ))}
            </tr>
            <tr>
              {PERM_GROUPS.flatMap(g => g.perms).map(p => (
                <th key={p.key}
                  className="border-b border-r border-zinc-100 bg-zinc-50 px-1 py-1.5 text-center text-[11px] font-medium text-zinc-500">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {OFFICE_ORDER.map(office => {
              const duties = roster.filter(r => r.office === office)
              if (duties.length === 0) return null
              return [
                <tr key={office}>
                  <td colSpan={2 + allKeys.length}
                    className="sticky left-0 border-b border-zinc-200 bg-zinc-100/80 px-2 py-1.5">
                    <span className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-700">{office}</span>
                      <span className="flex gap-3">
                        <button className="text-[11px] text-zinc-500 underline-offset-2 hover:underline"
                          onClick={() => setOfficeAll(office, true)}>整處室全開</button>
                        <button className="text-[11px] text-zinc-500 underline-offset-2 hover:underline"
                          onClick={() => setOfficeAll(office, false)}>整處室清除</button>
                      </span>
                    </span>
                  </td>
                </tr>,
                ...duties.map(r => {
                  const perms = new Set(r.perms)
                  return (
                    <tr key={r.duty}>
                      <td className="sticky left-0 z-10 border-b border-r border-zinc-100 bg-white px-2 py-1.5 whitespace-nowrap">
                        <span className="text-zinc-800">{r.duty}</span>
                        <span className="ml-2 inline-flex gap-2">
                          <button className="text-[11px] text-zinc-400 underline-offset-2 hover:underline"
                            onClick={() => patchRow(r.duty, { perms: allKeys })}>全選</button>
                          <button className="text-[11px] text-zinc-400 underline-offset-2 hover:underline"
                            onClick={() => patchRow(r.duty, { perms: [] })}>清除</button>
                        </span>
                      </td>
                      <td className="border-b border-r border-zinc-100 px-1 py-1">
                        <select
                          className="input !w-32 !py-1 !text-xs"
                          value={r.teacher_id ?? ''}
                          onChange={e => patchRow(r.duty, { teacher_id: e.target.value || null })}
                        >
                          <option value="">（未指定）</option>
                          {data.teachers.map(t => (
                            <option key={t.id} value={t.id}>{t.name ?? t.email}</option>
                          ))}
                        </select>
                      </td>
                      {allKeys.map(key => (
                        <td key={key} className="border-b border-r border-zinc-100 px-1 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-zinc-700"
                            checked={perms.has(key)}
                            onChange={() => togglePerm(r, key)}
                            aria-label={`${r.duty}：${key}`}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                }),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
