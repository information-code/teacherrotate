'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface TeacherEntry {
  id: string
  name: string | null
  email: string
  created_at: string
  logged_in: boolean
}

interface Props {
  entries: TeacherEntry[]
}

export default function WhitelistClient({ entries: initial }: Props) {
  const router = useRouter()
  const [entries, setEntries] = useState<TeacherEntry[]>(initial)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const res = await fetch('/api/admin/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setError(data.error ?? '新增失敗')
      return
    }
    setEntries(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'zh-TW')))
    setName('')
    setEmail('')
    router.refresh()
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const res = await fetch(`/api/admin/whitelist?id=${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (!res.ok) return
    setEntries(prev => prev.filter(e => e.id !== id))
    router.refresh()
  }

  const loggedIn = entries.filter(e => e.logged_in)
  const pending = entries.filter(e => !e.logged_in)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">教師帳號管理</h1>
        <div className="text-sm text-zinc-400">
          共 {entries.length} 位 ·
          <span className="text-zinc-600 ml-1">已登入 {loggedIn.length}</span> ·
          <span className="text-amber-500 ml-1">待登入 {pending.length}</span>
        </div>
      </div>

      {/* 新增表單 */}
      <div className="card">
        <h2 className="text-sm font-medium text-zinc-700 mb-3">新增教師帳號</h2>
        <form onSubmit={handleAdd} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-zinc-500 mb-1">姓名</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="王小明"
              required
              className="input"
            />
          </div>
          <div className="flex-[2]">
            <label className="block text-xs text-zinc-500 mb-1">Google 登入 Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teacher@gmail.com"
              required
              className="input"
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
            {submitting ? '新增中...' : '新增'}
          </button>
        </form>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {/* 待登入 */}
      {pending.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-3">
            待登入
            <span className="ml-2 text-xs text-amber-500 font-normal">帳號已建立，尚未登入過</span>
          </h2>
          <div className="space-y-1">
            {pending.map(entry => (
              <div key={entry.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{entry.name}</span>
                  <span className="text-xs text-zinc-400 ml-3">{entry.email}</span>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                >
                  刪除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 已登入 */}
      {loggedIn.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-3">
            已登入
            <span className="ml-2 text-xs text-zinc-400 font-normal">已完成 Google 驗證</span>
          </h2>
          <div className="space-y-1">
            {loggedIn.map(entry => (
              <div key={entry.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{entry.name}</span>
                  <span className="text-xs text-zinc-400 ml-3">{entry.email}</span>
                  <span className="text-xs text-zinc-300 ml-3 font-mono">{entry.id}</span>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                >
                  刪除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">尚無任何教師帳號，請新增</p>
      )}
    </div>
  )
}
