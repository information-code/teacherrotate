'use client'

import { useState } from 'react'

export default function SystemClient({ initialSchoolName }: { initialSchoolName: string }) {
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
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">系統偏好</h1>
        {message && <span className="text-sm text-zinc-600">{message}</span>}
      </div>

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
        <div className="flex justify-end">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
