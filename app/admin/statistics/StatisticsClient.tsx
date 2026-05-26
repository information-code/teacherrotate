'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { TeacherEval } from './page'
import { TARGET_BADGE_STYLE } from '@/lib/rotation-target'

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
  initialTeachers: TeacherEval[]
  midLowWorks: string[]
  currentYear: number
  viewYear: number
  availableYears: number[]
  isCurrent: boolean
}

async function fetchStats(year: number): Promise<StatRow[]> {
  const res = await fetch(`/api/admin/statistics?year=${year}`)
  if (!res.ok) return []
  return res.json()
}

async function fetchDetail(work: string, year: number): Promise<DetailRow[]> {
  const res = await fetch(`/api/admin/statistics?work=${encodeURIComponent(work)}&year=${year}`)
  if (!res.ok) return []
  return res.json()
}

export default function StatisticsClient({ initialStats, initialTeachers, currentYear, viewYear, availableYears, isCurrent }: Props) {
  const router = useRouter()
  const [stats, setStats] = useState<StatRow[]>(initialStats)
  const [loading, setLoading] = useState(initialStats.length === 0)
  const [bumping, setBumping] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setStats(initialStats)
    setLoading(false)
  }, [initialStats])

  function handleRowClick(work: string) {
    if (selected === work) { setSelected(null); return }
    setSelected(work)
    setDetailLoading(true)
    fetchDetail(work, viewYear).then(data => { setDetail(data); setDetailLoading(false) })
  }

  function switchYear(year: number) {
    const params = new URLSearchParams()
    if (year !== currentYear) params.set('year', String(year))
    const qs = params.toString()
    router.push(qs ? `/admin/statistics?${qs}` : '/admin/statistics')
  }

  async function bumpPreferenceYear() {
    const nextYear = currentYear + 1
    if (!confirm(`啟動 ${nextYear} 學年度的志願填寫？\n\n● 目前 ${currentYear} 學年度的志願將保留為歷史紀錄，可隨時切換年度查看。\n● 老師端會看到全新的 ${nextYear} 學年度填寫表單。\n\n此操作可在「目前開放填寫年度」設定中調整。`)) return
    setBumping(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preference_year: nextYear }),
      })
      if (!res.ok) {
        alert('啟動失敗，請稍後再試')
        return
      }
      router.push('/admin/statistics')
      router.refresh()
    } finally {
      setBumping(false)
    }
  }

  const maxTotal = Math.max(1, ...stats.map(s => s.total))
  const noPrefsCount = initialTeachers.filter(t => !t.pref1 && !t.pref2 && !t.pref3).length

  const targetBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of initialTeachers) counts[t.targetType] = (counts[t.targetType] ?? 0) + 1
    const order = ['二年級導師', '四年級導師', '六年級導師', '接棒班導師', '科任', '行政', '返回安排']
    return order.filter(k => counts[k] > 0).map(k => ({ type: k, count: counts[k] }))
  }, [initialTeachers])

  return (
    <div className="space-y-6">
      <div className="flex gap-6 items-start">
        <div className="flex-1 space-y-4 min-w-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="page-title mb-0">
                志願統計
                <span className="ml-2 text-sm font-normal text-zinc-500">{viewYear} 學年度</span>
                {!isCurrent && <span className="ml-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm">歷史紀錄</span>}
                {isCurrent && <span className="ml-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-sm">填寫中</span>}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {isCurrent ? (
                  <>
                    僅統計今年需填志願的在職教師（共 {initialTeachers.length} 位，
                    {noPrefsCount > 0 && <span className="text-amber-600">其中 {noPrefsCount} 位尚未填志願</span>}
                    {noPrefsCount === 0 && <span className="text-green-600">全員已填志願</span>}）
                  </>
                ) : (
                  <>顯示 {viewYear} 學年度當時所有教師填寫的志願統計（歷史檢視）</>
                )}
              </p>
              {isCurrent && targetBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {targetBreakdown.map(({ type, count }) => (
                    <span
                      key={type}
                      className={`inline-flex items-center text-[11px] px-1.5 py-0.5 border rounded-sm ${TARGET_BADGE_STYLE[type as keyof typeof TARGET_BADGE_STYLE]}`}
                    >
                      {type} <span className="ml-1 font-semibold">{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <label className="text-xs text-zinc-500">年度</label>
              <select
                value={viewYear}
                onChange={e => switchYear(Number(e.target.value))}
                className="input py-1 text-sm w-24"
              >
                {availableYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button onClick={() => fetchStats(viewYear).then(setStats)} className="btn-secondary">
                重新整理
              </button>
              {isCurrent && (
                <button
                  onClick={bumpPreferenceYear}
                  disabled={bumping}
                  className="btn-primary"
                  title={`鎖定 ${currentYear} 學年度志願為歷史紀錄，開啟 ${currentYear + 1} 學年度新一輪填寫`}
                >
                  {bumping ? '處理中...' : `啟動 ${currentYear + 1} 學年度`}
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="card text-sm text-zinc-400">載入中...</div>
          ) : stats.length === 0 ? (
            <div className="card text-sm text-zinc-400">尚無需換工作的教師填寫志願</div>
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
    </div>
  )
}
