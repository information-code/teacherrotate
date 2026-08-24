'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageLoading } from '@/components/ui/PageLoading'

interface Stats {
  total: number
  open: number
  unclassified: number
  resolved: { self: number; vanished: number; fixed: number }
  avgAcceptHours: number | null
  avgCloseHours: number | null
  issueStats: { name: string; item_name: string; total: number; open: number; selfSolved: number }[]
  itemStats: { name: string; total: number; open: number; fixed: number; selfSolved: number }[]
  locationStats: { location: string; count: number }[]
  monthly: { month: string; reported: number; closed: number; selfSolved: number }[]
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'
}

export default function RepairStatsClient() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    fetch('/api/admin/repair-stats').then(async res => {
      const json = await res.json()
      if (!res.ok) setLoadError(json.error || '載入失敗')
      else setStats(json)
    })
  }, [])

  if (loadError) return <div className="card"><p className="text-sm text-red-600">{loadError}</p></div>
  if (!stats) return <PageLoading />

  const closedTotal = stats.resolved.self + stats.resolved.vanished + stats.resolved.fixed
  const selfSolved = stats.resolved.self + stats.resolved.vanished

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900">報修統計</h1>

      {/* 總覽 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['累計報修', `${stats.total} 件`],
          ['未結案', `${stats.open} 件`],
          ['自行解決率', pct(selfSolved, closedTotal)],
          ['平均修復時間', stats.avgCloseHours === null ? '—' : `${stats.avgCloseHours} 小時`],
        ].map(([label, value]) => (
          <div key={label} className="card !p-4">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-zinc-900">{value}</p>
          </div>
        ))}
      </div>

      {stats.unclassified > 0 && (
        <div className="card border-violet-200 bg-violet-50/50">
          <p className="text-sm text-zinc-700">
            有 <span className="font-semibold">{stats.unclassified}</span> 件自由描述的案件尚未歸類，
            未歸類的案件不會計入問題排行——請到
            <Link href="/admin/repair-cases" className="mx-1 underline">案件報表</Link>
            歸類。
          </p>
        </div>
      )}

      {/* 解決方式占比 */}
      <div className="card">
        <h2 className="mb-3 font-medium text-zinc-900">解決方式占比</h2>
        {closedTotal === 0 ? (
          <p className="text-sm text-zinc-500">還沒有結案的案件。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>方式</th><th>件數</th><th>占結案比例</th></tr>
              </thead>
              <tbody>
                <tr><td>老師自行排除</td><td>{stats.resolved.self}</td><td>{pct(stats.resolved.self, closedTotal)}</td></tr>
                <tr><td>問題自行消失</td><td>{stats.resolved.vanished}</td><td>{pct(stats.resolved.vanished, closedTotal)}</td></tr>
                <tr><td>維護處理修復</td><td>{stats.resolved.fixed}</td><td>{pct(stats.resolved.fixed, closedTotal)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {stats.avgAcceptHours !== null && (
          <p className="mt-2 text-xs text-zinc-500">
            平均接案時間 {stats.avgAcceptHours} 小時；平均修復時間僅計入維護處理修復的案件。
          </p>
        )}
      </div>

      {/* 問題排行 */}
      <div className="card">
        <h2 className="mb-3 font-medium text-zinc-900">常見問題排行（重複發生多、又常要維護處理的，就是汰換候選）</h2>
        {stats.issueStats.length === 0 ? (
          <p className="text-sm text-zinc-500">還沒有歸入標準問題的案件。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>問題</th><th>件數</th><th>未結案</th><th>自行解決</th></tr>
              </thead>
              <tbody>
                {stats.issueStats.map((s, i) => (
                  <tr key={i}>
                    <td>{s.item_name}</td>
                    <td className="font-medium">{s.name}</td>
                    <td>{s.total}</td>
                    <td>{s.open}</td>
                    <td>{s.selfSolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 設備排行 */}
      <div className="card">
        <h2 className="mb-3 font-medium text-zinc-900">設備排行</h2>
        {stats.itemStats.length === 0 ? (
          <p className="text-sm text-zinc-500">還沒有報修資料。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>設備</th><th>件數</th><th>未結案</th><th>維護修復</th><th>自行解決</th></tr>
              </thead>
              <tbody>
                {stats.itemStats.map((s, i) => (
                  <tr key={i}>
                    <td className="font-medium">{s.name}</td>
                    <td>{s.total}</td>
                    <td>{s.open}</td>
                    <td>{s.fixed}</td>
                    <td>{s.selfSolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 地點排行 */}
      <div className="card">
        <h2 className="mb-3 font-medium text-zinc-900">地點排行（哪裡最常報修）</h2>
        {stats.locationStats.length === 0 ? (
          <p className="text-sm text-zinc-500">還沒有填地點的報修資料。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>地點</th><th>件數</th></tr>
              </thead>
              <tbody>
                {stats.locationStats.map(l => (
                  <tr key={l.location}>
                    <td className="font-medium">{l.location}</td>
                    <td>{l.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 月趨勢 */}
      <div className="card">
        <h2 className="mb-3 font-medium text-zinc-900">每月趨勢</h2>
        {stats.monthly.length === 0 ? (
          <p className="text-sm text-zinc-500">還沒有報修資料。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>月份</th><th>報修件數</th><th>結案件數</th><th>其中自行解決</th></tr>
              </thead>
              <tbody>
                {stats.monthly.map(m => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{m.reported}</td>
                    <td>{m.closed}</td>
                    <td>{m.selfSolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
