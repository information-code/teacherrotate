'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface AdminUser {
  id: string
  name: string | null
  email: string
}

interface Props {
  initialAdmins: AdminUser[]
}

export default function AdminsClient({ initialAdmins }: Props) {
  const router = useRouter()
  const [admins, setAdmins] = useState<AdminUser[]>(initialAdmins)

  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAdmins(initialAdmins) }, [initialAdmins])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function loadAdmins() {
    const res = await fetch('/api/admin/add-admin')
    if (res.ok) setAdmins(await res.json())
  }

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
    <div className="max-w-2xl space-y-6">
      <h2 className="page-title">Admin 管理</h2>

      {/* 新增 Admin */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">新增管理員</h3>
        <p className="text-xs text-zinc-500 mb-3">輸入教師的學校 Google 信箱，即可授予管理員權限。該教師必須已登入過本系統。</p>
        {message && (
          <div className={`mb-4 px-4 py-2 text-sm rounded-sm border ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            {message.text}
          </div>
        )}
        <div className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="teacher@school.edu.tw"
            className="input flex-1"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button onClick={handleAdd} disabled={loading || !email.trim()} className="btn-primary">
            {loading ? '處理中...' : '授予權限'}
          </button>
        </div>
      </div>

      {/* 目前 Admin 清單 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">目前管理員清單</h3>
        {admins.length === 0 ? (
          <p className="text-sm text-zinc-400">無資料</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>姓名</th>
                <th>電子信箱</th>
              </tr>
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
        )}
      </div>
    </div>
  )
}
