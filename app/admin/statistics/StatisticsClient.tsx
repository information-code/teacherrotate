'use client'

import { useState, useEffect, useMemo } from 'react'
import type { TeacherEval } from './page'
import { sortWorks, groupWorks } from '@/lib/work-sort'

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

/** 貪心分配演算法：依分數由高到低，依序嘗試第一、二、三志願
 *  locked: 主任手動鎖定的教師 { teacherId → work }，優先鎖定入槽，不走演算法
 */
function runAssignment(
  teachers: TeacherEval[],
  quotas: Record<string, number>,
  skipIds: Set<string>,
  locked: Record<string, string>,
) {
  const lockedIds = new Set(Object.keys(locked))
  const slots: Record<string, TeacherEval[]> = {}

  // 1. 先放入鎖定教師
  for (const [id, work] of Object.entries(locked)) {
    const t = teachers.find(x => x.id === id)
    if (!t) continue
    if (!slots[work]) slots[work] = []
    slots[work].push(t)
  }

  // 2. 貪心分配其餘教師（排除暫定行政、鎖定者）
  const eligible = teachers.filter(t =>
    !skipIds.has(t.id) && !lockedIds.has(t.id) && (t.pref1 || t.pref2 || t.pref3)
  )
  const sorted = [...eligible].sort((a, b) => b.score - a.score)
  const unassigned: TeacherEval[] = []

  for (const t of sorted) {
    const prefs = [t.pref1, t.pref2, t.pref3].filter(Boolean) as string[]
    let placed = false
    for (const work of prefs) {
      const quota = quotas[work] ?? 0
      if (quota <= 0) continue
      if (!slots[work]) slots[work] = []
      if (slots[work].length < quota) {
        slots[work].push(t)
        placed = true
        break
      }
    }
    if (!placed) unassigned.push(t)
  }

  // 3. 未填志願且非暫定行政、非鎖定者也列入待安排
  const noPrefs = teachers.filter(t =>
    !skipIds.has(t.id) && !lockedIds.has(t.id) && !t.pref1 && !t.pref2 && !t.pref3
  )
  return { slots, unassigned: [...unassigned, ...noPrefs] }
}

export default function StatisticsClient({ initialStats, initialTeachers }: Props) {
  const [stats, setStats] = useState<StatRow[]>(initialStats)
  const [loading, setLoading] = useState(initialStats.length === 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailRow[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [showEval, setShowEval] = useState(false)
  const [quotas, setQuotas] = useState<Record<string, number>>({})
  const [tentativeAdmin, setTentativeAdmin] = useState<Set<string>>(
    () => new Set(initialTeachers.filter(t => t.currentWork && (t.currentWork.includes('主任') || t.currentWork.includes('組長'))).map(t => t.id))
  )
  // locked: { teacherId → work }，鎖定的教師不走演算法
  const [locked, setLocked] = useState<Record<string, string>>({})

  function setLock(id: string, work: string | null) {
    setLocked(prev => {
      if (!work) { const next = { ...prev }; delete next[id]; return next }
      return { ...prev, [id]: work }
    })
  }

  function toggleTentativeAdmin(id: string) {
    setTentativeAdmin(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 所有出現在志願中的職位
  const allWorks = useMemo(() => {
    const fromTeachers = initialTeachers.flatMap(t =>
      [t.pref1, t.pref2, t.pref3].filter(Boolean) as string[]
    )
    return sortWorks(Array.from(new Set(fromTeachers)))
  }, [initialTeachers])

  const workGroups = useMemo(() => groupWorks(allWorks), [allWorks])

  const effectiveQuotas = useMemo(() => {
    const q: Record<string, number> = {}
    for (const w of allWorks) q[w] = quotas[w] ?? 0
    return q
  }, [allWorks, quotas])

  const { slots, unassigned } = useMemo(
    () => runAssignment(initialTeachers, effectiveQuotas, tentativeAdmin, locked),
    [initialTeachers, effectiveQuotas, tentativeAdmin, locked]
  )

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
  const noPrefsCount = initialTeachers.filter(t => !t.pref1 && !t.pref2 && !t.pref3).length

  return (
    <div className="space-y-6">
      {/* ── 志願統計（只含需換工作的教師）── */}
      <div className="flex gap-6 items-start">
        <div className="flex-1 space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="page-title mb-0">志願統計</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                僅統計今年需換工作的在職教師（共 {initialTeachers.length} 位，
                {noPrefsCount > 0 && <span className="text-amber-600">其中 {noPrefsCount} 位尚未填志願</span>}
                {noPrefsCount === 0 && <span className="text-green-600">全員已填志願</span>}）
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowEval(!showEval)} className="btn-secondary">
                {showEval ? '收起評估' : '評估預測'}
              </button>
              <button onClick={() => fetchStats().then(setStats)} className="btn-secondary">
                重新整理
              </button>
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

      {/* ── 評估預測 ── */}
      {showEval && (
        <div className="space-y-4 border-t border-zinc-200 pt-4">
          <div>
            <h2 className="page-title mb-1">評估預測</h2>
            <p className="text-xs text-zinc-400">
              先設定各職位名額，系統依近四年總分由高到低自動分配（高分優先取得第一志願）。
            </p>
          </div>

          {initialTeachers.length === 0 ? (
            <div className="card text-sm text-zinc-400">尚無需換工作的教師</div>
          ) : (
            <div className="space-y-4">
              {/* Step 1: 名額設定 */}
              <div className="card p-4 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-700">Step 1 — 設定各職位名額</h3>
                {allWorks.length === 0 ? (
                  <p className="text-xs text-zinc-400">尚無教師填寫志願，無法設定名額</p>
                ) : (
                  <div className="space-y-4">
                    {workGroups.map(group => (
                      <div key={group.label}>
                        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2 pb-1 border-b border-zinc-200">
                          {group.label}
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {group.works.map(work => (
                            <div key={work} className="flex items-center gap-2">
                              <span className="text-xs text-zinc-700 flex-1 truncate" title={work}>{work}</span>
                              <input
                                type="number"
                                min={0}
                                value={effectiveQuotas[work]}
                                onChange={e => setQuotas(q => ({ ...q, [work]: Math.max(0, Number(e.target.value)) }))}
                                className="input w-12 text-center py-0.5 text-xs flex-shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2: 預測結果 */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* 左：各職位分派 */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-700">Step 2 — 各職位預測分派</h3>
                  {allWorks.filter(w => effectiveQuotas[w] > 0).map(work => {
                    const assigned = slots[work] ?? []
                    const quota = effectiveQuotas[work]
                    const pref1Count = stats.find(s => s.work === work)?.pref1 ?? 0
                    const isConflict = pref1Count > quota

                    return (
                      <div key={work} className={`card p-3 space-y-2 ${isConflict ? 'border-amber-200' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-zinc-800">{work}</span>
                            {isConflict && (
                              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm">
                                第一志願競爭
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-zinc-500">{assigned.length}/{quota} 位</span>
                        </div>
                        {assigned.length === 0 ? (
                          <p className="text-xs text-zinc-400">尚無教師分配至此職位</p>
                        ) : (
                          <div className="space-y-1">
                            {assigned.map((t, idx) => {
                              const isLocked = locked[t.id] === work
                              return (
                                <div key={t.id} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-zinc-400 w-4">{idx + 1}.</span>
                                    <span className="font-medium text-zinc-800">{t.name}</span>
                                    {isLocked ? (
                                      <span className="px-1 py-0.5 border border-zinc-800 bg-zinc-800 text-white rounded-sm">鎖定</span>
                                    ) : (
                                      <span className={`px-1 py-0.5 border rounded-sm ${
                                        t.pref1 === work ? 'border-zinc-800 text-zinc-700' :
                                        t.pref2 === work ? 'border-zinc-400 text-zinc-500' :
                                        'border-zinc-300 text-zinc-400'
                                      }`}>
                                        {t.pref1 === work ? '第一' : t.pref2 === work ? '第二' : '第三'}志願
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-zinc-500">{t.score.toFixed(2)} 分</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {allWorks.filter(w => effectiveQuotas[w] > 0).length === 0 && (
                    <div className="card p-3 text-xs text-zinc-400">請先設定職位名額</div>
                  )}
                </div>

                {/* 右：衝突與待安排 */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-700">衝突與待安排</h3>

                  {/* 同分競爭（只在邊界有同分時才顯示） */}
                  {(() => {
                    // 計算哪些職位有真正的邊界同分衝突
                    const conflictWorks = allWorks.filter(w => {
                      const quota = effectiveQuotas[w]
                      if (quota <= 0) return false
                      const lockedForWork = initialTeachers.filter(t => locked[t.id] === w).length
                      const remaining = quota - lockedForWork
                      if (remaining <= 0) return false // 名額已被鎖定填滿
                      const pool = initialTeachers
                        .filter(t => t.pref1 === w && !tentativeAdmin.has(t.id) && locked[t.id] !== w)
                        .sort((a, b) => b.score - a.score)
                      if (pool.length <= remaining) return false // 人數不超過名額，無衝突
                      // 邊界同分判斷
                      return pool[remaining - 1]?.score === pool[remaining]?.score
                    })
                    if (conflictWorks.length === 0) return null
                    return (
                      <div className="card p-3 space-y-3 border-amber-200">
                        <h4 className="text-xs font-semibold text-amber-700">同分競爭 — 需主任手動鎖定</h4>
                        <p className="text-xs text-zinc-400">高分者已自動確定，以下為分數相同、需手動決定的名單。</p>
                        {conflictWorks.map(w => {
                          const quota = effectiveQuotas[w]
                          const lockedForWork = initialTeachers.filter(t => locked[t.id] === w).length
                          const remaining = quota - lockedForWork
                          const pool = initialTeachers
                            .filter(t => t.pref1 === w && !tentativeAdmin.has(t.id) && locked[t.id] !== w)
                            .sort((a, b) => b.score - a.score)
                          const boundaryScore = pool[remaining - 1]?.score
                          const tiedTeachers = pool.filter(t => t.score === boundaryScore)
                          const tiedSlotsLeft = remaining - pool.filter((t, i) => i < remaining && t.score > boundaryScore).length
                          return (
                            <div key={w} className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-zinc-800">{w}</span>
                                <span className="text-xs text-amber-600">
                                  同分搶 {tiedSlotsLeft} 個名額（共 {tiedTeachers.length} 人 / {boundaryScore.toFixed(2)} 分）
                                </span>
                              </div>
                              <div className="space-y-1 pl-1">
                                {tiedTeachers.map(t => {
                                  const isPicked = locked[t.id] === w
                                  return (
                                    <div key={t.id} className={`flex items-center justify-between text-xs py-1 px-2 border rounded-sm ${isPicked ? 'border-zinc-800 bg-zinc-50' : 'border-zinc-200'}`}>
                                      <div className="flex items-center gap-1.5">
                                        <span className={`font-medium ${isPicked ? 'text-zinc-900' : 'text-zinc-600'}`}>{t.name}</span>
                                        <span className="text-zinc-400">{t.score.toFixed(2)} 分</span>
                                      </div>
                                      <button
                                        onClick={() => setLock(t.id, isPicked ? null : w)}
                                        className={`px-2 py-0.5 border rounded-sm text-xs ${
                                          isPicked
                                            ? 'border-zinc-800 bg-zinc-800 text-white'
                                            : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'
                                        }`}
                                      >
                                        {isPicked ? '已鎖定 ✓' : '鎖定'}
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* 暫定行政人員 */}
                  {tentativeAdmin.size > 0 && (
                    <div className="card p-3 space-y-2 border-zinc-400">
                      <h4 className="text-xs font-semibold text-zinc-700">
                        暫定行政人員
                        <span className="ml-1 text-zinc-500">（{tentativeAdmin.size} 位，不納入分派）</span>
                      </h4>
                      {initialTeachers.filter(t => tentativeAdmin.has(t.id)).map(t => (
                        <div key={t.id} className="flex items-center justify-between text-xs py-1 border-b border-zinc-100 last:border-0">
                          <div>
                            <span className="font-medium text-zinc-800">{t.name}</span>
                            <span className="ml-1.5 text-zinc-400">{t.score.toFixed(2)} 分</span>
                          </div>
                          <button
                            onClick={() => toggleTentativeAdmin(t.id)}
                            className="text-zinc-400 hover:text-zinc-600 border border-zinc-200 px-1.5 py-0.5 rounded-sm text-xs"
                          >取消</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 待安排 */}
                  <div className="card p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-zinc-700">
                      待安排教師
                      {unassigned.length > 0
                        ? <span className="ml-1 text-red-600">（{unassigned.length} 位）</span>
                        : <span className="ml-1 text-green-600">（0 位）</span>
                      }
                    </h4>
                    {unassigned.length === 0 ? (
                      <p className="text-xs text-green-600">✓ 所有需換工作的教師均已分配</p>
                    ) : (
                      unassigned.map(t => (
                        <div key={t.id} className="flex items-start justify-between text-xs py-1.5 border-b border-zinc-100 last:border-0">
                          <div className="space-y-0.5">
                            <div className="font-medium text-zinc-800">{t.name}</div>
                            <div className="text-zinc-400">目前：{t.currentWork ?? '無紀錄'}</div>
                            {(t.pref1 || t.pref2 || t.pref3) ? (
                              <div className="text-zinc-400">
                                志願：{[t.pref1, t.pref2, t.pref3].filter(Boolean).join(' › ')}
                              </div>
                            ) : (
                              <div className="text-amber-600">尚未填志願</div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
                            <span className="text-zinc-500">{t.score.toFixed(2)} 分</span>
                            <button
                              onClick={() => toggleTentativeAdmin(t.id)}
                              className="text-zinc-600 border border-zinc-300 bg-zinc-50 hover:bg-zinc-100 px-1.5 py-0.5 rounded-sm text-xs whitespace-nowrap"
                            >暫定行政</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* 所有人分配摘要 */}
                  <div className="card p-3 space-y-1">
                    <h4 className="text-xs font-semibold text-zinc-700 mb-2">所有需換工作教師（依分數排序）</h4>
                    {[...initialTeachers].sort((a, b) => b.score - a.score).map(t => {
                      const assignedWork = Object.entries(slots).find(([, teachers]) =>
                        teachers.some(x => x.id === t.id)
                      )?.[0]
                      const isUnassigned = unassigned.some(u => u.id === t.id)
                      const isTentative = tentativeAdmin.has(t.id)
                      const isLocked = !!locked[t.id]
                      const hasNoPrefs = !t.pref1 && !t.pref2 && !t.pref3
                      return (
                        <div key={t.id} className="flex items-center justify-between text-xs py-1 border-b border-zinc-100 last:border-0 gap-2">
                          <div className="min-w-0">
                            <span className="font-medium text-zinc-800">{t.name}</span>
                            <span className="ml-1.5 text-zinc-400">{t.score.toFixed(2)} 分</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* 鎖定至職位下拉 */}
                            <select
                              value={locked[t.id] ?? ''}
                              onChange={e => setLock(t.id, e.target.value || null)}
                              disabled={isTentative}
                              className="input text-xs py-0 h-6 max-w-[96px] disabled:opacity-40"
                            >
                              <option value="">鎖定至...</option>
                              {allWorks.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                            {/* 狀態 badge */}
                            {isTentative ? (
                              <span className="text-zinc-600 border border-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-sm whitespace-nowrap">暫定行政</span>
                            ) : isLocked ? (
                              <span className="text-zinc-800 border border-zinc-800 bg-zinc-50 px-1.5 py-0.5 rounded-sm whitespace-nowrap">鎖定</span>
                            ) : hasNoPrefs ? (
                              <span className="text-amber-500 border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded-sm whitespace-nowrap">未填志願</span>
                            ) : isUnassigned ? (
                              <span className="text-red-500 border border-red-200 bg-red-50 px-1.5 py-0.5 rounded-sm whitespace-nowrap">待安排</span>
                            ) : (
                              <span className={`px-1.5 py-0.5 border rounded-sm whitespace-nowrap ${
                                assignedWork === t.pref1 ? 'border-zinc-800 text-zinc-700' :
                                assignedWork === t.pref2 ? 'border-zinc-400 text-zinc-500' :
                                'border-zinc-300 text-zinc-400'
                              }`}>
                                {assignedWork}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
