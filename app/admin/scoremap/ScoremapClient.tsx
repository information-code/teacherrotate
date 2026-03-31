'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Scoremap } from '@/types/database'

const YEAR_COLS: (keyof Scoremap)[] = ['year1','year2','year3','year4','year5','year6','year7','year8']
const YEAR_LABELS = ['第1年','第2年','第3年','第4年','第5年','第6年','第7年','第8年']

interface Props {
  initialRows: Scoremap[]
  initialMidLowSwitchScore: number
}

export default function ScoremapClient({ initialRows, initialMidLowSwitchScore }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<Scoremap[]>(initialRows)
  const [midLowSwitchScore, setMidLowSwitchScore] = useState<string>(String(initialMidLowSwitchScore))

  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(initialRows) }, [initialRows])
  const [saving, setSaving] = useState(false)
  const [recalcing, setRecalcing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateCell(id: string, key: keyof Scoremap, value: string) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, [key]: value } : r
    ))
  }

  function addRow() {
    const newRow: Partial<Scoremap> = {
      id: `new-${Date.now()}`,
      work: '',
      year1: 0, year2: 0, year3: 0, year4: 0,
      year5: 0, year6: 0, year7: 0, year8: 0,
      group_name: null,
      sort_order: rows.length * 10,
    }
    setRows(prev => [...prev, newRow as Scoremap])
  }

  async function deleteRow(id: string, work: string) {
    if (id.startsWith('new-')) {
      setRows(prev => prev.filter(r => r.id !== id))
      return
    }
    if (!confirm(`確定刪除「${work}」這筆分數對照資料？此操作無法復原。`)) return
    await fetch('/api/admin/scoremap', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setRows(prev => prev.filter(r => r.id !== id))
  }

  async function save() {
    // 前端驗證：不允許空白職位名稱
    const emptyWork = rows.find(r => !r.work.trim())
    if (emptyWork) {
      setError('有職位名稱尚未填寫，請填寫後再儲存')
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload = rows.map(r => ({
        id: r.id.startsWith('new-') ? crypto.randomUUID() : r.id,
        work: r.work.trim(),
        year1: Number(r.year1), year2: Number(r.year2),
        year3: Number(r.year3), year4: Number(r.year4),
        year5: Number(r.year5), year6: Number(r.year6),
        year7: Number(r.year7), year8: Number(r.year8),
        group_name: r.group_name?.trim() || null,
        sort_order: r.sort_order ?? 0,
      }))
      const [res, settingsRes] = await Promise.all([
        fetch('/api/admin/scoremap', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ midlow_switch_score: midLowSwitchScore }),
        }),
      ])
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? '儲存失敗')
      }
      if (!settingsRes.ok) {
        const data = await settingsRes.json().catch(() => ({}))
        throw new Error(data.error ?? '設定儲存失敗')
      }
      const fresh = await fetch('/api/admin/scoremap').then(r => r.json())
      setRows(Array.isArray(fresh) ? fresh : [])
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)

      // 儲存完成後觸發重算（獨立進行，不影響儲存成功狀態）
      setRecalcing(true)
      fetch('/api/admin/recalc', { method: 'POST' }).finally(() => setRecalcing(false))
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗，請稍後再試')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative space-y-4">
      {saving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60">
          <div className="flex items-center gap-3 px-6 py-4 bg-white border border-zinc-200 shadow-sm rounded">
            <svg className="animate-spin h-5 w-5 text-zinc-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm text-zinc-700">儲存中，請稍候...</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="page-title mb-0">分數對照表</h2>
        <div className="flex items-center gap-3">
          {saved && !recalcing && <span className="text-sm text-green-600">已儲存，分數重算完成</span>}
          {saved && recalcing && <span className="text-sm text-zinc-500">已儲存，重算分數中...</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          <button onClick={addRow} className="btn-secondary">+ 新增職位</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? '儲存中...' : '儲存變更'}
          </button>
        </div>
      </div>

      {/* 特殊規則設定 */}
      <div className="card flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-700">
            連續 5 年中低年級導師者，中低年級轉換分數為
            <input
              type="number"
              step="0.25"
              min="0"
              value={midLowSwitchScore}
              onChange={e => setMidLowSwitchScore(e.target.value)}
              className="input text-center py-1 w-20 mx-2 inline-block"
            />
            分
          </p>
          <p className="text-xs text-zinc-400 mt-1">當教師在中低年級導師組連續滿 5 年後，若當年從中年級換低年級（或反之），自動套用此分數</p>
        </div>
      </div>

      <p className="text-xs text-zinc-400">1year ~ 8year 欄位代表連續擔任同一職位幾年所得的積分。中年級導師與低年級導師設定相同 group_name 可合併計算年資。</p>

      <div className="card p-0 overflow-x-auto">
        <table className="table-base w-full min-w-max">
          <thead>
            <tr>
              <th className="w-36 sticky left-0 bg-zinc-50">職位名稱</th>
              {YEAR_LABELS.map(l => <th key={l} className="w-20 text-center">{l}</th>)}
              <th className="w-28">分組名稱</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <td className="sticky left-0 bg-white">
                  <input
                    value={row.work}
                    onChange={e => updateCell(row.id, 'work', e.target.value)}
                    className="input py-1"
                    placeholder="職位名稱"
                  />
                </td>
                {YEAR_COLS.map(col => (
                  <td key={col} className="text-center">
                    <input
                      type="number"
                      step="0.25"
                      value={row[col] as number}
                      onChange={e => updateCell(row.id, col, e.target.value)}
                      className="input text-center py-1 w-16"
                    />
                  </td>
                ))}
                <td>
                  <input
                    value={row.group_name ?? ''}
                    onChange={e => updateCell(row.id, 'group_name', e.target.value)}
                    className="input py-1"
                    placeholder="（選填）"
                  />
                </td>
                <td>
                  <button
                    onClick={() => deleteRow(row.id, row.work)}
                    className="btn-danger py-1 px-2 text-xs"
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
