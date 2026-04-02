'use client'

import { useState } from 'react'

interface TeacherConfirmation {
  id: string
  name: string | null
  email: string
  score_confirmed: boolean
  score_confirmed_at: string | null
}

interface Props {
  initialTeachers: TeacherConfirmation[]
}

export default function ConfirmationsClient({ initialTeachers }: Props) {
  const [teachers, setTeachers] = useState(initialTeachers)
  const [search, setSearch] = useState('')
  const [resetting, setResetting] = useState<string | null>(null) // id or 'all'

  const confirmed = teachers.filter(t => t.score_confirmed)
  const unconfirmed = teachers.filter(t => !t.score_confirmed)
  const total = teachers.length
  const confirmedPct = total > 0 ? Math.round((confirmed.length / total) * 100) : 0

  const filtered = teachers.filter(t => {
    const q = search.toLowerCase()
    return !q || (t.name ?? '').toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
  })

  async function reload() {
    const res = await fetch('/api/admin/confirmations')
    if (res.ok) {
      const data = await res.json()
      setTeachers(data.teachers ?? [])
    }
  }

  async function resetOne(id: string, name: string) {
    if (!confirm(`確定要恢復「${name}」的確認狀態（解除鎖定）？`)) return
    setResetting(id)
    try {
      await fetch('/api/admin/confirmations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      await reload()
    } finally {
      setResetting(null)
    }
  }

  async function resetAll() {
    if (!confirm(`確定要恢復所有教師的確認狀態（共 ${confirmed.length} 位已確認將被解除鎖定）？`)) return
    setResetting('all')
    try {
      await fetch('/api/admin/confirmations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      await reload()
    } finally {
      setResetting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="page-title mb-0">教師積分確認狀態</h2>
        <button
          onClick={resetAll}
          disabled={resetting !== null || confirmed.length === 0}
          className="btn-secondary text-sm"
        >
          {resetting === 'all' ? '重置中...' : '全體恢復鎖定'}
        </button>
      </div>

      {/* 百分比圖 */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-600">確認進度</span>
          <span className="font-semibold text-zinc-900">{confirmed.length} / {total} 位（{confirmedPct}%）</span>
        </div>
        <div className="w-full bg-zinc-100 rounded-full h-3 overflow-hidden">
          <div
            className="bg-zinc-800 h-3 rounded-full transition-all duration-300"
            style={{ width: `${confirmedPct}%` }}
          />
        </div>
        <div className="flex gap-6 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-zinc-800" />
            已確認 {confirmed.length} 位
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-zinc-100 border border-zinc-300" />
            未確認 {unconfirmed.length} 位
          </span>
        </div>
      </div>

      {/* 教師明細 */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋教師姓名或信箱"
            className="input w-60"
          />
          <span className="text-sm text-zinc-500">共 {filtered.length} 筆</span>
        </div>
        <table className="table-base">
          <thead>
            <tr>
              <th>教師姓名</th>
              <th>狀態</th>
              <th>確認時間</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="text-center text-zinc-400">無資料</td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id}>
                <td>
                  <div className="font-medium text-zinc-900">{t.name ?? '—'}</div>
                  <div className="text-xs text-zinc-400">{t.email}</div>
                </td>
                <td>
                  {t.score_confirmed ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-50 border border-green-200 text-green-700 rounded-sm">
                      ✓ 已確認
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-zinc-50 border border-zinc-200 text-zinc-500 rounded-sm">
                      未確認
                    </span>
                  )}
                </td>
                <td className="text-sm text-zinc-500">
                  {t.score_confirmed_at
                    ? new Date(t.score_confirmed_at).toLocaleString('zh-TW')
                    : '—'}
                </td>
                <td>
                  {t.score_confirmed && (
                    <button
                      onClick={() => resetOne(t.id, t.name ?? t.email)}
                      disabled={resetting !== null}
                      className="btn-secondary py-1 px-2 text-xs"
                    >
                      {resetting === t.id ? '...' : '恢復鎖定'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
