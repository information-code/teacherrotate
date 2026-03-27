'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface TeacherEntry {
  id: string
  name: string | null
  email: string
  role: string
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
  const [addError, setAddError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 搜尋
  const [query, setQuery] = useState('')

  // 編輯 email
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
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
      body: JSON.stringify({ name, email }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setAddError(data.error ?? '新增失敗'); return }
    setEntries(prev => [...prev, data].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-TW')))
    setName('')
    setEmail('')
    router.refresh()
  }

  async function handleSaveEmail(id: string) {
    setEditError('')
    setSaving(true)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email: editEmail }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setEditError(data.error ?? '儲存失敗'); return }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, email: data.email } : e))
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
    return (
      <div key={entry.id} className="py-2.5 border-b border-zinc-100 last:border-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-800">{entry.name ?? '（未填）'}</span>
              {entry.role === 'admin' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-white rounded-sm">管理員</span>
              )}
            </div>
            {isEditing ? (
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  className="input text-xs py-1"
                  autoFocus
                />
                <button onClick={() => handleSaveEmail(entry.id)} disabled={saving} className="btn-primary text-xs py-1 px-2 whitespace-nowrap">
                  {saving ? '儲存中...' : '儲存'}
                </button>
                <button onClick={() => setEditingId(null)} className="text-xs text-zinc-400 hover:text-zinc-600">取消</button>
              </div>
            ) : (
              <span className="text-xs text-zinc-400 ml-0">{entry.email}</span>
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
              <button onClick={() => { setEditingId(entry.id); setEditEmail(entry.email); setEditError('') }} className="text-xs text-zinc-400 hover:text-zinc-700">
                改 Email
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
        <h1 className="page-title">帳號管理</h1>
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
        <form onSubmit={handleAdd} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-zinc-500 mb-1">姓名</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="王小明" required className="input" />
          </div>
          <div className="flex-[2]">
            <label className="block text-xs text-zinc-500 mb-1">Google 登入 Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teacher@gmail.com" required className="input" />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
            {submitting ? '新增中...' : '新增'}
          </button>
        </form>
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
