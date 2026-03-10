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

/** 貪心分配演算法 */
function runAssignment(
  teachers: TeacherEval[],
  quotas: Record<string, number>,
  skipIds: Set<string>,
  locked: Record<string, string>,
) {
  const lockedIds = new Set(Object.keys(locked))
  const slots: Record<string, TeacherEval[]> = {}

  for (const [id, work] of Object.entries(locked)) {
    const t = teachers.find(x => x.id === id)
    if (!t) continue
    if (!slots[work]) slots[work] = []
    slots[work].push(t)
  }

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
  const [locked, setLocked] = useState<Record<string, string>>({})
  // blocked: teachers manually kept in 待安排 (overrides algorithm placement)
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [dragTeacherId, setDragTeacherId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [detailTeacher, setDetailTeacher] = useState<TeacherEval | null>(null)

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

  function handleDrop(sectionId: string) {
    const id = dragTeacherId
    if (!id) return
    setDragOver(null)
    setDragTeacherId(null)
    if (sectionId === 'admin') {
      setTentativeAdmin(prev => new Set([...prev, id]))
      setLock(id, null)
      setBlocked(prev => { const n = new Set(prev); n.delete(id); return n })
    } else if (sectionId === 'pool') {
      setTentativeAdmin(prev => { const n = new Set(prev); n.delete(id); return n })
      setLock(id, null)
      setBlocked(prev => new Set([...prev, id]))
    } else {
      setTentativeAdmin(prev => { const n = new Set(prev); n.delete(id); return n })
      setLock(id, sectionId)
      setBlocked(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  function getCardColor(t: TeacherEval, work: string, isAdmin: boolean): string {
    if (isAdmin) return 'bg-white border-zinc-200'
    if (work === 'pool') return 'bg-white border-zinc-200'
    if (locked[t.id] === work) return 'bg-zinc-800 border-zinc-800 text-white'
    if (t.pref1 === work) return 'bg-green-50 border-green-400'
    if (t.pref2 === work) return 'bg-sky-50 border-sky-400'
    if (t.pref3 === work) return 'bg-amber-50 border-amber-400'
    return 'bg-red-50 border-red-300'
  }

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
    () => runAssignment(initialTeachers, effectiveQuotas, new Set([...tentativeAdmin, ...blocked]), locked),
    [initialTeachers, effectiveQuotas, tentativeAdmin, blocked, locked]
  )

  const poolTeachers = useMemo(() => {
    const blockedList = [...blocked]
      .map(id => initialTeachers.find(t => t.id === id))
      .filter(Boolean) as TeacherEval[]
    return [...unassigned, ...blockedList]
  }, [unassigned, blocked, initialTeachers])

  const adminTeachers = useMemo(
    () => initialTeachers.filter(t => tentativeAdmin.has(t.id)),
    [initialTeachers, tentativeAdmin]
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

  // ── section renderer (closure, not a React component) ──
  function renderSection(
    sectionId: string,
    title: string,
    teachers: TeacherEval[],
    quota: number | null,
    isAdmin: boolean,
  ) {
    const isOver = dragOver === sectionId
    const isOverQuota = quota !== null && teachers.length > quota

    // Tie-at-boundary detection for work sections
    let hasTieWarning = false
    if (!isAdmin && quota !== null && sectionId !== 'pool') {
      const lockedCnt = teachers.filter(t => locked[t.id] === sectionId).length
      const remaining = quota - lockedCnt
      if (remaining > 0) {
        const tiePool = [...initialTeachers
          .filter(t => t.pref1 === sectionId && !tentativeAdmin.has(t.id) && !blocked.has(t.id) && locked[t.id] !== sectionId)]
          .sort((a, b) => b.score - a.score)
        if (tiePool.length > remaining && tiePool[remaining - 1]?.score === tiePool[remaining]?.score) {
          hasTieWarning = true
        }
      }
    }

    return (
      <div
        key={sectionId}
        className={`flex flex-col flex-shrink-0 w-[148px] rounded border-2 transition-colors ${
          isOver ? 'border-zinc-400 bg-zinc-50' : isOverQuota ? 'border-red-300 bg-white' : 'border-zinc-200 bg-white'
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(sectionId) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
        onDrop={e => { e.preventDefault(); handleDrop(sectionId) }}
      >
        {/* Section header */}
        <div className={`px-2 py-1.5 border-b text-xs rounded-t ${
          isOverQuota ? 'border-red-200 bg-red-50' : hasTieWarning ? 'border-amber-200 bg-amber-50' : 'border-zinc-100 bg-zinc-50'
        }`}>
          <div className="flex items-center justify-between gap-1">
            <span className={`font-semibold truncate leading-tight ${
              isOverQuota ? 'text-red-700' : hasTieWarning ? 'text-amber-700' : 'text-zinc-700'
            }`} title={title}>{title}</span>
            {quota !== null && (
              <span className={`flex-shrink-0 font-medium ${isOverQuota ? 'text-red-600' : 'text-zinc-500'}`}>
                {teachers.length}/{quota}
              </span>
            )}
            {quota === null && (
              <span className="flex-shrink-0 text-zinc-400">{teachers.length}</span>
            )}
          </div>
          {isOverQuota && (
            <p className="text-red-600 mt-0.5 font-medium">超額 +{teachers.length - quota!}</p>
          )}
          {!isOverQuota && hasTieWarning && (
            <p className="text-amber-600 mt-0.5">同分競爭</p>
          )}
        </div>

        {/* Cards */}
        <div className="flex flex-col gap-1.5 p-1.5 flex-1 min-h-[64px]">
          {teachers.map(t => {
            const color = getCardColor(t, sectionId, isAdmin)
            const isBeingDragged = dragTeacherId === t.id
            const isDetailOpen = detailTeacher?.id === t.id
            return (
              <div
                key={t.id}
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragTeacherId(t.id) }}
                onDragEnd={() => setDragTeacherId(null)}
                className={`relative flex items-center justify-between px-1.5 py-1 border rounded-sm cursor-grab active:cursor-grabbing text-xs select-none transition-opacity ${color} ${
                  isBeingDragged ? 'opacity-40' : ''
                }`}
              >
                <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
                  <span className="font-medium truncate leading-tight">{t.name}</span>
                  <span className="text-[10px] opacity-70 flex-shrink-0">{t.score.toFixed(2)}</span>
                </div>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setDetailTeacher(isDetailOpen ? null : t) }}
                  className={`ml-0.5 flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full border text-[10px] leading-none transition-colors ${
                    isDetailOpen
                      ? 'border-zinc-600 bg-zinc-600 text-white'
                      : locked[t.id] === sectionId
                        ? 'border-white text-white opacity-70 hover:opacity-100'
                        : 'border-zinc-400 text-zinc-500 hover:border-zinc-700 hover:text-zinc-700'
                  }`}
                >i</button>
              </div>
            )
          })}
          {teachers.length === 0 && (
            <div className={`text-[11px] text-zinc-400 text-center py-4 border border-dashed rounded-sm ${
              isOver ? 'border-zinc-500 text-zinc-500 bg-zinc-50' : 'border-zinc-200'
            }`}>
              拖拉至此
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── 志願統計 ── */}
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
              先設定各職位名額，系統依近四年總分由高到低自動分配。拖拉卡片可手動調整分配結果。
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

              {/* Step 2: 拖拉安排 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-semibold text-zinc-700">Step 2 — 拖拉安排</h3>
                  {/* Legend */}
                  <div className="flex gap-3 text-[11px] text-zinc-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border rounded-sm bg-green-50 border-green-400" />第一志願
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border rounded-sm bg-sky-50 border-sky-400" />第二志願
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border rounded-sm bg-amber-50 border-amber-400" />第三志願
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border rounded-sm bg-red-50 border-red-300" />無志願配對
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 border rounded-sm bg-zinc-800 border-zinc-800" />手動鎖定
                    </span>
                  </div>
                </div>

                {/* Teacher detail popup */}
                {detailTeacher && (
                  <div className="card p-3 border-zinc-300 space-y-2 text-xs bg-zinc-50">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-zinc-800">{detailTeacher.name}</span>
                      <button onClick={() => setDetailTeacher(null)} className="text-zinc-400 hover:text-zinc-600 text-base leading-none">×</button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-600">
                      <div><span className="text-zinc-400">近四年總分</span><br /><span className="font-medium text-zinc-800">{detailTeacher.score.toFixed(2)} 分</span></div>
                      <div><span className="text-zinc-400">現任職位</span><br /><span className="font-medium text-zinc-800">{detailTeacher.currentWork ?? '—'}</span></div>
                      <div><span className="text-zinc-400">第一志願</span><br /><span className="font-medium">{detailTeacher.pref1 ?? '—'}</span></div>
                      <div><span className="text-zinc-400">第二志願</span><br /><span className="font-medium">{detailTeacher.pref2 ?? '—'}</span></div>
                      <div><span className="text-zinc-400">第三志願</span><br /><span className="font-medium">{detailTeacher.pref3 ?? '—'}</span></div>
                    </div>
                  </div>
                )}

                {/* Kanban board */}
                <div
                  className="flex gap-3 overflow-x-auto pb-3 items-start"
                  style={{ minHeight: '200px' }}
                >
                  {/* 待安排 pool */}
                  {renderSection('pool', '待安排', poolTeachers, null, false)}

                  {/* 行政人員 */}
                  {renderSection('admin', '行政人員', adminTeachers, null, true)}

                  {/* Work sections, grouped with dividers */}
                  {workGroups.map(group => {
                    const groupWorks = group.works.filter(w => effectiveQuotas[w] > 0)
                    if (groupWorks.length === 0) return null
                    return (
                      <div key={group.label} className="flex gap-3 items-start flex-shrink-0">
                        {/* Group divider */}
                        <div className="flex flex-col items-center self-stretch">
                          <div className="w-px bg-zinc-200 flex-1" />
                        </div>
                        {groupWorks.map(work =>
                          renderSection(work, work, slots[work] ?? [], effectiveQuotas[work], false)
                        )}
                      </div>
                    )
                  })}

                  {allWorks.filter(w => effectiveQuotas[w] > 0).length === 0 && (
                    <div className="card p-4 text-xs text-zinc-400 self-center">請先在 Step 1 設定職位名額</div>
                  )}
                </div>

                <p className="text-[11px] text-zinc-400">
                  拖拉到「行政人員」= 排除分派。拖拉到「待安排」= 強制留在待安排池（不走演算法）。拖拉到職位欄 = 直接鎖定至該職位。
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
