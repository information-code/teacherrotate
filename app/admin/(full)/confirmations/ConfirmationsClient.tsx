'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TARGET_BADGE_STYLE, type RotationTarget } from '@/lib/rotation-target'

interface TeacherConfirmation {
  id: string
  name: string | null
  email: string
  score_confirmed: boolean
  score_confirmed_at: string | null
  targetType: RotationTarget | null
  prefLocked: boolean
  prefGiveUp: boolean
  prefFilled: boolean
}

interface Props {
  initialTeachers: TeacherConfirmation[]
  preferenceYear: number
}

export default function ConfirmationsClient({ initialTeachers, preferenceYear }: Props) {
  const router = useRouter()
  const [teachers, setTeachers] = useState(initialTeachers)
  const [search, setSearch] = useState('')
  const [resetting, setResetting] = useState<string | null>(null)
  const [unlocking, setUnlocking] = useState<string | null>(null)
  const [showNonTargets, setShowNonTargets] = useState(false)

  // 每次 mount 強制 server 重抓，避免 Next.js router cache 顯示舊資料
  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTeachers(initialTeachers) }, [initialTeachers])

  const scoped = showNonTargets ? teachers : teachers.filter(t => t.targetType !== null)
  const confirmed = scoped.filter(t => t.score_confirmed)
  const total = scoped.length
  const confirmedPct = total > 0 ? Math.round((confirmed.length / total) * 100) : 0

  const prefDone = scoped.filter(t => t.prefLocked)
  const prefDonePct = total > 0 ? Math.round((prefDone.length / total) * 100) : 0

  const filtered = scoped.filter(t => {
    const q = search.toLowerCase()
    return !q || (t.name ?? '').toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
  })

  const nonTargetCount = teachers.filter(t => t.targetType === null).length

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

  async function unlockPref(id: string, name: string) {
    if (!confirm(`確定要解鎖「${name}」${preferenceYear} 學年度志願？解鎖後該老師可重新修改志願。`)) return
    setUnlocking(id)
    try {
      await fetch('/api/admin/preferences/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: id, year: preferenceYear }),
      })
      await reload()
    } finally {
      setUnlocking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title mb-0">確認統計</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {showNonTargets
              ? `顯示全部 ${teachers.length} 位在職教師`
              : `僅顯示今年需確認的目標教師（${scoped.length} 位，已排除 ${nonTargetCount} 位首屆／非目標）`}
            {' · '}選填狀態以 {preferenceYear} 學年度為準
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNonTargets(v => !v)}
            className="btn-secondary text-sm"
          >
            {showNonTargets ? '只看目標教師' : '顯示全部教師'}
          </button>
          <button
            onClick={resetAll}
            disabled={resetting !== null || confirmed.length === 0}
            className="btn-secondary text-sm"
          >
            {resetting === 'all' ? '重置中...' : '全體恢復鎖定'}
          </button>
        </div>
      </div>

      {/* 兩張統計卡片：積分確認 + 選填確認 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-zinc-800">積分確認</span>
            <span className="font-semibold text-zinc-900 tabular-nums">{confirmed.length} / {total} 位（{confirmedPct}%）</span>
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
              未確認 {total - confirmed.length} 位
            </span>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-zinc-800">選填確認</span>
            <span className="font-semibold text-zinc-900 tabular-nums">{prefDone.length} / {total} 位（{prefDonePct}%）</span>
          </div>
          <div className="w-full bg-zinc-100 rounded-full h-3 overflow-hidden">
            <div
              className="bg-emerald-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${prefDonePct}%` }}
            />
          </div>
          <div className="flex gap-6 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-emerald-600" />
              已完成 {prefDone.length} 位
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-zinc-100 border border-zinc-300" />
              未完成 {total - prefDone.length} 位
            </span>
          </div>
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
        <div className="overflow-x-auto -mx-6 px-6">
        <table className="table-base">
          <thead>
            <tr>
              <th>教師姓名</th>
              <th>類別</th>
              <th>分數確認</th>
              <th>志願狀態</th>
              <th>確認時間</th>
              <th className="w-40"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-zinc-400">無資料</td></tr>
            )}
            {filtered.map(t => (
              <tr key={t.id}>
                <td>
                  <div className="font-medium text-zinc-900">{t.name ?? '—'}</div>
                  <div className="text-xs text-zinc-400">{t.email}</div>
                </td>
                <td>
                  {t.targetType ? (
                    <span className={`inline-block text-[11px] px-1.5 py-0.5 border rounded-sm ${TARGET_BADGE_STYLE[t.targetType]}`}>
                      {t.targetType}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-400">非目標</span>
                  )}
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
                <td>
                  {t.prefLocked ? (
                    t.prefGiveUp ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-sm">
                        🔒 放棄選填
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-zinc-100 border border-zinc-300 text-zinc-700 rounded-sm">
                        🔒 已鎖定
                      </span>
                    )
                  ) : t.prefFilled ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-sky-50 border border-sky-200 text-sky-700 rounded-sm">
                      可修改
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-zinc-50 border border-zinc-200 text-zinc-500 rounded-sm">
                      未填
                    </span>
                  )}
                </td>
                <td className="text-sm text-zinc-500">
                  {t.score_confirmed_at
                    ? new Date(t.score_confirmed_at).toLocaleString('zh-TW')
                    : '—'}
                </td>
                <td>
                  <div className="flex gap-1 justify-end">
                    {t.score_confirmed && (
                      <button
                        onClick={() => resetOne(t.id, t.name ?? t.email)}
                        disabled={resetting !== null}
                        className="btn-secondary py-1 px-2 text-xs"
                      >
                        {resetting === t.id ? '...' : '分數確認解鎖'}
                      </button>
                    )}
                    {t.prefLocked && (
                      <button
                        onClick={() => unlockPref(t.id, t.name ?? t.email)}
                        disabled={unlocking !== null}
                        className="btn-secondary py-1 px-2 text-xs"
                        title={`解鎖 ${preferenceYear} 學年度志願`}
                      >
                        {unlocking === t.id ? '...' : '志願選填解鎖'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
