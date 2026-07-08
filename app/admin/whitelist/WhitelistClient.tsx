'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isVirtualEmail } from '@/lib/utils'

const GRADE_LABELS = ['一年級', '二年級', '三年級', '四年級', '五年級', '六年級']

// 聘任別：正式（全功能）、代理（配課選填＋設備借用）、鐘點（僅設備借用）
type EmploymentType = 'formal' | 'substitute' | 'hourly'
const EMPLOYMENT_LABELS: Record<string, string> = {
  formal: '正式',
  substitute: '代理',
  hourly: '鐘點',
}

interface TeacherEntry {
  id: string
  name: string | null
  email: string
  role: string
  employment_type: string
  created_at: string
  logged_in: boolean
}

interface Props {
  entries: TeacherEntry[]
  isSuperAdmin: boolean
}

export default function WhitelistClient({ entries: initial, isSuperAdmin }: Props) {
  const router = useRouter()
  const [entries, setEntries] = useState<TeacherEntry[]>(initial)

  // 新增
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType>('formal')
  const [virtualMode, setVirtualMode] = useState(false)          // 待聘（虛擬）帳號
  const [virtualRole, setVirtualRole] = useState<'subject' | 'homeroom'>('subject')
  const [virtualGrade, setVirtualGrade] = useState(1)
  const [addError, setAddError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [empTogglingId, setEmpTogglingId] = useState<string | null>(null)

  // 搜尋
  const [query, setQuery] = useState('')

  // 編輯 email（虛擬帳號轉正時同時可改姓名）
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  // 刪除
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 角色切換
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filtered = entries.filter(e => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (e.name ?? '').toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
  })
  const admins = filtered.filter(e => e.role === 'admin')
  const loggedIn = filtered.filter(e => e.role === 'teacher' && e.logged_in)
  const pending = filtered.filter(e => e.role === 'teacher' && !e.logged_in)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    setSubmitting(true)
    const res = await fetch('/api/admin/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(virtualMode
        ? { name, virtual: true, virtualRole, virtualGrade: virtualRole === 'homeroom' ? virtualGrade : undefined }
        : { name, email, employmentType }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setAddError(data.error ?? '新增失敗'); return }
    setEntries(prev => [...prev, data].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-TW')))
    setName('')
    setEmail('')
    setEmploymentType('formal')
    router.refresh()
  }

  async function handleChangeEmployment(entry: TeacherEntry, next: string) {
    if (next === entry.employment_type) return
    if (!confirm(`將「${entry.name ?? entry.email}」改為${EMPLOYMENT_LABELS[next] ?? next}教師？`)) return
    setEmpTogglingId(entry.id)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, employment_type: next }),
    })
    setEmpTogglingId(null)
    if (!res.ok) return
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, employment_type: next } : e))
    router.refresh()
  }

  async function handleSaveEmail(id: string, withName: boolean) {
    setEditError('')
    setSaving(true)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withName ? { id, email: editEmail, name: editName } : { id, email: editEmail }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      // 待聘帳號撞到既有老師 → 詢問是否合併（配課帶過去、引用改指、刪除待聘帳號）
      if (data.canMerge) {
        const ok = confirm(
          `此 Email 屬於既有老師「${data.conflictName ?? '（未知）'}」。\n\n` +
          `要將此待聘帳號合併過去嗎？\n` +
          `・配課資料轉移給既有老師（同年度以待聘帳號的配課為準）\n` +
          `・配班、排課、撕榜引用全部改指既有老師\n` +
          `・待聘帳號隨後刪除（無法復原）`,
        )
        if (!ok) return
        setSaving(true)
        const res2 = await fetch('/api/admin/whitelist', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, email: editEmail, merge: true }),
        })
        const data2 = await res2.json()
        setSaving(false)
        if (!res2.ok) { setEditError(data2.error ?? '合併失敗'); return }
        setEntries(prev => prev.filter(e => e.id !== id))
        setEditingId(null)
        alert(`已合併到「${data2.target?.name ?? ''}」，待聘帳號已刪除。`)
        router.refresh()
        return
      }
      setEditError(data.error ?? '儲存失敗')
      return
    }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, email: data.email, name: data.name ?? e.name } : e))
    setEditingId(null)
    router.refresh()
  }

  async function handleDelete(id: string, name: string | null) {
    if (!confirm(`確定刪除「${name ?? email}」的帳號？`)) return
    setDeletingId(id)
    const res = await fetch(`/api/admin/whitelist?id=${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (!res.ok) return
    setEntries(prev => prev.filter(e => e.id !== id))
    router.refresh()
  }

  async function handleToggleRole(entry: TeacherEntry) {
    const newRole = entry.role === 'admin' ? 'teacher' : 'admin'
    const label = newRole === 'admin' ? `設「${entry.name ?? entry.email}」為管理員？` : `移除「${entry.name ?? entry.email}」的管理員權限？`
    if (!confirm(label)) return
    setTogglingId(entry.id)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, role: newRole }),
    })
    setTogglingId(null)
    if (!res.ok) return
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, role: newRole } : e))
    router.refresh()
  }

  function renderRow(entry: TeacherEntry) {
    const isEditing = editingId === entry.id
    const virtual = isVirtualEmail(entry.email)
    return (
      <div key={entry.id} className="py-2.5 border-b border-zinc-100 last:border-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-800">{entry.name ?? '（未填）'}</span>
              {entry.role === 'admin' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-white rounded-sm">管理員</span>
              )}
              {virtual && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-sm">待聘</span>
              )}
              {entry.employment_type === 'substitute' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-700 border border-sky-200 rounded-sm">代理</span>
              )}
              {entry.employment_type === 'hourly' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 border border-violet-200 rounded-sm">鐘點</span>
              )}
            </div>
            {isEditing ? (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                {virtual && (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="真實姓名"
                    className="input text-xs py-1 w-28"
                    autoFocus
                  />
                )}
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder={virtual ? '真實 Google Email' : ''}
                  className="input text-xs py-1"
                  autoFocus={!virtual}
                />
                <button onClick={() => handleSaveEmail(entry.id, virtual)} disabled={saving} className="btn-primary text-xs py-1 px-2 whitespace-nowrap">
                  {saving ? '儲存中...' : virtual ? '轉正' : '儲存'}
                </button>
                <button onClick={() => setEditingId(null)} className="text-xs text-zinc-400 hover:text-zinc-600">取消</button>
              </div>
            ) : (
              <span className="text-xs text-zinc-400 ml-0">
                {virtual ? '尚未綁定 Email——考上後點「轉正」填入真實姓名與信箱' : entry.email}
              </span>
            )}
            {isEditing && editError && <p className="text-xs text-red-500 mt-1">{editError}</p>}
          </div>
          {!isEditing && (
            <div className="flex items-center gap-3 flex-shrink-0">
              {isSuperAdmin && (
                <button
                  onClick={() => handleToggleRole(entry)}
                  disabled={togglingId === entry.id}
                  className="text-xs text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
                >
                  {entry.role === 'admin' ? '移除管理員' : '設為管理員'}
                </button>
              )}
              {entry.role !== 'admin' && (
                // 值綁 entries state：confirm 取消時 state 未變，select 自動回到原值
                <select
                  value={entry.employment_type}
                  onChange={e => handleChangeEmployment(entry, e.target.value)}
                  disabled={empTogglingId === entry.id}
                  className="text-xs text-zinc-500 border border-zinc-200 rounded-sm px-1 py-0.5 bg-white disabled:opacity-40"
                >
                  <option value="formal">正式</option>
                  <option value="substitute">代理</option>
                  <option value="hourly">鐘點</option>
                </select>
              )}
              <button onClick={() => { setEditingId(entry.id); setEditEmail(virtual ? '' : entry.email); setEditName(virtual ? '' : (entry.name ?? '')); setEditError('') }}
                className={`text-xs whitespace-nowrap ${virtual ? 'text-amber-600 hover:text-amber-700 font-medium' : 'text-zinc-400 hover:text-zinc-700'}`}>
                {virtual ? '轉正' : '改 Email'}
              </button>
              <button
                onClick={() => handleDelete(entry.id, entry.name)}
                disabled={deletingId === entry.id}
                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
              >
                刪除
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">帳號資料</h1>
        <div className="text-sm text-zinc-400">
          共 {entries.length} 位 ·
          <span className="text-zinc-600 ml-1">管理員 {entries.filter(e => e.role === 'admin').length}</span> ·
          <span className="text-zinc-600 ml-1">已登入 {entries.filter(e => e.role === 'teacher' && e.logged_in).length}</span> ·
          <span className="text-amber-500 ml-1">待登入 {entries.filter(e => e.role === 'teacher' && !e.logged_in).length}</span>
        </div>
      </div>

      {/* 新增表單 */}
      <div className="card">
        <h2 className="text-sm font-medium text-zinc-700 mb-3">新增教師帳號</h2>
        <form onSubmit={handleAdd} className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-32">
            <label className="block text-xs text-zinc-500 mb-1">姓名</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={virtualMode ? '待聘代理A' : '王小明'} required className="input" />
          </div>
          {!virtualMode && (
            <>
              <div className="flex-[2] min-w-48">
                <label className="block text-xs text-zinc-500 mb-1">Google 登入 Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teacher@gmail.com" required className="input" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">聘任別</label>
                <select value={employmentType} onChange={e => setEmploymentType(e.target.value as EmploymentType)} className="input">
                  <option value="formal">正式</option>
                  <option value="substitute">代理</option>
                  <option value="hourly">鐘點</option>
                </select>
              </div>
            </>
          )}
          {virtualMode && (
            <>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">預定職務</label>
                <select value={virtualRole} onChange={e => setVirtualRole(e.target.value as 'subject' | 'homeroom')} className="input">
                  <option value="subject">代理科任</option>
                  <option value="homeroom">代理導師</option>
                </select>
              </div>
              {virtualRole === 'homeroom' && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">年級</label>
                  <select value={virtualGrade} onChange={e => setVirtualGrade(Number(e.target.value))} className="input">
                    {GRADE_LABELS.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
            {submitting ? '新增中...' : virtualMode ? '新增待聘帳號' : '新增'}
          </button>
        </form>
        <label className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
          <input type="checkbox" checked={virtualMode} onChange={e => setVirtualMode(e.target.checked)} />
          待聘（虛擬）帳號——甄選未放榜先建帳號假性配課排課，考上後點「轉正」填入真實姓名與 Email，
          所有配課、配班、排課自動保留
        </label>
        {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
      </div>

      {/* 搜尋 */}
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋姓名或 Email..." className="input" />

      {/* 管理員 */}
      {admins.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-1">
            管理員
            {!isSuperAdmin && <span className="ml-2 text-xs text-zinc-400 font-normal">需超級管理員才能新增或移除</span>}
          </h2>
          <div>{admins.map(renderRow)}</div>
        </div>
      )}

      {/* 待登入教師 */}
      {pending.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-1">
            待登入
            <span className="ml-2 text-xs text-amber-500 font-normal">帳號已建立，尚未登入過</span>
          </h2>
          <div>{pending.map(renderRow)}</div>
        </div>
      )}

      {/* 已登入教師 */}
      {loggedIn.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-1">
            已登入
            <span className="ml-2 text-xs text-zinc-400 font-normal">已完成 Google 驗證</span>
          </h2>
          <div>{loggedIn.map(renderRow)}</div>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">
          {query ? '無符合結果' : '尚無任何帳號'}
        </p>
      )}
    </div>
  )
}
