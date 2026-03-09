'use client'

import { useState, useEffect } from 'react'

interface StatRow {
  work: string
  pref1: number
  pref2: number
  pref3: number
  total: number
}

interface DetailRow {
  name: string
  email: string
  rank: number
}

interface Props {
  initialStats: StatRow[]
}

async function fetchStats(): Promise<StatRow[]> {
  const res = await fetch('/api/admin/statistics')
  if (!res.ok) return []
  return res.json()
}

async function fetchDetail(work: string): Promise<DetailRow[]> {
  const res = await fetch(`/api/admin/statistics?work=${encodeURIComponent(work)}`)
  if (!res.ok) return []
  return res.json()
}

export default function StatisticsClient({ initialStats }: Props) {
  const [stats, setStats] = useState<StatRow[]>(initialStats)
  const [loading, setLoading] = useState(initialStats.length === 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (initialStats.length === 0) {
      fetchStats().then(data => { setStats(data); setLoading(false) })
    }
  }, [initialStats.length])

  function handleRowClick(work: string) {
    if (selected === work) { setSelected(null); return }
    setSelected(work)
    setDetailLoading(true)
    fetchDetail(work).then(data => { setDetail(data); setDetailLoading(false) })
  }

  const maxTotal = Math.max(1, ...stats.map(s => s.total))

  return (
    <div className="flex gap-6 items-start">
      {/* 主表格 */}
      <div className="flex-1 space-y-6 min-w-0">
        <div className="flex items-center justify-between">
          <h2 className="page-title mb-0">志願統計</h2>
          <button
            onClick={() => fetchStats().then(setStats)}
            className="btn-secondary"
          >
            重新整理
          </button>
        </div>

        {loading ? (
          <div className="card text-sm text-zinc-400">載入中...</div>
        ) : stats.length === 0 ? (
          <div className="card text-sm text-zinc-400">尚無教師填寫志願</div>
        ) : (
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>工作職位</th>
                  <th className="text-center">第一志願</th>
                  <th className="text-center">第二志願</th>
                  <th className="text-center">第三志願</th>
                  <th className="text-center">合計</th>
                  <th className="w-40">熱門程度</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(row => (
                  <tr
                    key={row.work}
                    onClick={() => handleRowClick(row.work)}
                    className={`cursor-pointer transition-colors ${selected === row.work ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                  >
                    <td className="font-medium">{row.work}</td>
                    <td className="text-center">{row.pref1 || '—'}</td>
                    <td className="text-center">{row.pref2 || '—'}</td>
                    <td className="text-center">{row.pref3 || '—'}</td>
                    <td className="text-center font-medium">{row.total}</td>
                    <td>
                      <div className="h-2 bg-zinc-100 rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-zinc-600 transition-all"
                          style={{ width: `${(row.total / maxTotal) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 詳細面板 */}
      {selected && (
        <div className="w-72 flex-shrink-0 card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-800 text-sm">{selected}</h3>
            <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
          </div>

          {detailLoading ? (
            <p className="text-sm text-zinc-400">載入中...</p>
          ) : detail.length === 0 ? (
            <p className="text-sm text-zinc-400">無人選填</p>
          ) : (
            <div className="space-y-1">
              {detail.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-zinc-100 last:border-0">
                  <span className={`text-xs px-1.5 py-0.5 border flex-shrink-0 ${
                    d.rank === 1 ? 'border-zinc-800 text-zinc-800' :
                    d.rank === 2 ? 'border-zinc-400 text-zinc-500' :
                    'border-zinc-300 text-zinc-400'
                  }`}>
                    志願{d.rank}
                  </span>
                  <span className="text-zinc-800 font-medium truncate">{d.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
