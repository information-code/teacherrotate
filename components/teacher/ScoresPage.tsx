'use client'

import { useState } from 'react'
import { buildScoreMaps, calculateTeacherScores, calcRecentFourYearTotal } from '@/lib/score-engine'
import type { Scoremap } from '@/types/database'

interface ScoreEntry {
  year: number
  work?: string
  score?: number
  semester?: string
}

interface Preferences {
  preference1: string | null
  preference2: string | null
  preference3: string | null
}

interface Props {
  initialScoreHistory: ScoreEntry[]
  initialRecentTotal: number | null
  initialPreferences: Preferences
  initialScoremapRows: Scoremap[]
  midLowSwitchScore: number
  initialConfirmed: boolean
  initialConfirmedAt: string | null
}

export function ScoresPage({ initialScoreHistory, initialRecentTotal, initialPreferences, initialScoremapRows, midLowSwitchScore, initialConfirmed, initialConfirmedAt }: Props) {
  const [scoreHistory, setScoreHistory] = useState<ScoreEntry[]>(initialScoreHistory)
  const [recentTotal] = useState<number | null>(initialRecentTotal)
  const [confirmed, setConfirmed] = useState(initialConfirmed)
  const [confirmedAt] = useState(initialConfirmedAt)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmSaving, setConfirmSaving] = useState(false)
  const [scoremapRows] = useState<Scoremap[]>(initialScoremapRows)
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setConfirmSaving(true)
    try {
      const res = await fetch('/api/teacher/confirm', { method: 'POST' })
      if (res.ok) {
        setConfirmed(true)
        setShowConfirmDialog(false)
      }
    } finally {
      setConfirmSaving(false)
    }
  }

  // 計算預估分數
  const rotations = scoreHistory.filter(s => s.work).map(s => ({ year: s.year, work: s.work! }))
  const { scoreMap, groupMap } = buildScoreMaps(scoremapRows)

  // 這些職務由學校指派，教師不能自行填志願
  const EXCLUDED_EXACT = ['中低轉換者', '留職停薪', '育嬰留停', '借調', '其他領域科任']
  const EXCLUDED_CONTAINS = ['主任', '組長']
  const allWorks = scoremapRows
    .map(r => r.work)
    .filter(w =>
      !EXCLUDED_EXACT.includes(w) &&
      !EXCLUDED_CONTAINS.some(kw => w.includes(kw))
    )
  const nextYear = Math.max(0, ...scoreHistory.map(s => s.year)) + 1

  // 回傳：選此志願後，下學年的單年積分 + 新的近四年總分
  function getEstimate(work: string | null): { yearScore: number; newTotal: number } | null {
    if (!work) return null
    const tempRotations = [
      ...rotations.filter(r => r.year !== nextYear),
      { year: nextYear, work },
    ]
    const scores = calculateTeacherScores(tempRotations, scoreMap, groupMap, midLowSwitchScore)
    return {
      yearScore: scores[nextYear] ?? 0,
      newTotal: calcRecentFourYearTotal(scores),
    }
  }

  async function savePreferences() {
    if (!preferences.preference1 || !preferences.preference2 || !preferences.preference3) {
      setError('請填寫三個志願')
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/teacher/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      })
      if (!res.ok) throw new Error('儲存失敗')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('儲存失敗，請稍後再試')
    } finally {
      setSaving(false)
    }
  }

  function setPreference(key: keyof Preferences, value: string) {
    setPreferences(prev => ({ ...prev, [key]: value || null }))
  }

  // 三個志願不可重複：各志願的可選範圍
  function getOptions(currentKey: keyof Preferences): string[] {
    const others = Object.entries(preferences)
      .filter(([k, v]) => k !== currentKey && v)
      .map(([, v]) => v as string)
    return allWorks.filter(w => !others.includes(w))
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="page-title">輪動分數與志願</h2>

      {/* 近四年統計 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-3">近四年輪動積分總計</h3>
        <div className="flex items-center gap-2">
          <span className="text-3xl font-semibold text-zinc-900">
            {recentTotal !== null ? recentTotal.toFixed(2) : '—'}
          </span>
          <span className="text-sm text-zinc-500">分</span>
        </div>
        <p className="text-xs text-zinc-400 mt-2">
          統計最近四個學年度（{nextYear - 4} ～ {nextYear - 1} 學年度）的輪動積分
        </p>
      </div>

      {/* 歷年紀錄表格 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">歷年輪動紀錄</h3>
        {scoreHistory.length === 0 ? (
          <p className="text-sm text-zinc-400">尚無輪動紀錄</p>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>學年度</th>
                <th>工作職務</th>
                <th className="text-right">本年積分</th>
              </tr>
            </thead>
            <tbody>
              {scoreHistory.map(row => (
                <tr key={row.year}>
                  <td>{row.year} 學年度</td>
                  <td>{row.work ?? '—'}</td>
                  <td className="text-right">
                    {row.score?.toFixed(2) ?? '—'}
                    {(row.semester === '上學期' || row.semester === '下學期') && (
                      <span className="ml-1.5 text-xs text-zinc-400 border border-zinc-300 px-1 rounded-sm">半學期</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 確認勾選框 */}
        <div className="mt-4 pt-4 border-t border-zinc-100">
          {confirmed ? (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="text-green-500">☑</span>
              <span>我已確認上方歷年工作與分數無誤。</span>
              {confirmedAt && (
                <span className="text-xs text-zinc-400 ml-1">
                  （確認時間：{new Date(confirmedAt).toLocaleString('zh-TW')}）
                </span>
              )}
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={false}
                onChange={() => setShowConfirmDialog(true)}
                className="w-4 h-4 rounded border-zinc-300 cursor-pointer"
              />
              我已確認上方歷年工作與分數無誤。
            </label>
          )}
        </div>
      </div>

      {/* 確認 Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-zinc-900">確認歷年工作與分數</h3>
            <p className="text-sm text-zinc-600">
              確認後將被<strong>鎖定</strong>，是否確定歷年工作與分數無誤？
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="btn-secondary"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmSaving}
                className="btn-primary"
              >
                {confirmSaving ? '處理中...' : '確認'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 下學年度志願 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">下學年度工作志願（{nextYear} 學年度）</h3>
            <p className="text-xs text-zinc-400 mt-1">三個志願不可重複。右側顯示：選擇此職位後 {nextYear} 學年的本年積分，以及 {nextYear - 3}～{nextYear} 學年度的近四年預估總分</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600">已儲存</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button onClick={savePreferences} disabled={saving} className="btn-primary">
              {saving ? '儲存中...' : '儲存志願'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {(
            [
              { key: 'preference1' as const, label: '第一志願' },
              { key: 'preference2' as const, label: '第二志願' },
              { key: 'preference3' as const, label: '第三志願' },
            ]
          ).map(({ key, label }) => {
            const estimate = getEstimate(preferences[key])
            return (
              <div key={key} className="flex items-center gap-4">
                <label className="w-20 text-sm text-zinc-700 font-medium flex-shrink-0">{label}</label>
                <select
                  className="input flex-1"
                  value={preferences[key] ?? ''}
                  onChange={e => setPreference(key, e.target.value)}
                >
                  <option value="">請選擇</option>
                  {getOptions(key).map(w => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
                <div className="text-sm text-zinc-500 w-44 flex-shrink-0 space-y-0.5">
                  {estimate !== null && preferences[key] ? (
                    <>
                      <div>本年積分：<span className="font-medium text-zinc-700">{estimate.yearScore.toFixed(2)}</span></div>
                      <div>預估近四年：<span className="font-medium text-zinc-900">{estimate.newTotal.toFixed(2)}</span></div>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
