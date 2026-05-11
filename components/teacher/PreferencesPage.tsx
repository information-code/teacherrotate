'use client'

import { useState } from 'react'
import Link from 'next/link'
import { buildScoreMaps, calculateTeacherScores, calcRecentFourYearTotal } from '@/lib/score-engine'
import type { Scoremap } from '@/types/database'
import type { RotationTarget } from '@/lib/rotation-target'

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
  targetYear: number
  targetType: RotationTarget | null
  scoreConfirmed: boolean
  initialScoreHistory: ScoreEntry[]
  initialPreferences: Preferences
  initialLocked: boolean
  initialGiveUp: boolean
  initialScoremapRows: Scoremap[]
  midLowSwitchScore: number
}

export function PreferencesPage({
  targetYear,
  targetType,
  scoreConfirmed,
  initialScoreHistory,
  initialPreferences,
  initialLocked,
  initialGiveUp,
  initialScoremapRows,
  midLowSwitchScore,
}: Props) {
  const [scoreHistory] = useState<ScoreEntry[]>(initialScoreHistory)
  const [scoremapRows] = useState<Scoremap[]>(initialScoremapRows)
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences)
  const [giveUp, setGiveUp] = useState<boolean>(initialGiveUp)
  const [locked, setLocked] = useState<boolean>(initialLocked)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

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

  const disabled = locked || giveUp

  function getEstimate(work: string | null): { yearScore: number; newTotal: number } | null {
    if (!work) return null
    const tempRotations = [
      ...rotations.filter(r => r.year !== targetYear),
      { year: targetYear, work },
    ]
    const scores = calculateTeacherScores(tempRotations, scoreMap, groupMap, midLowSwitchScore)
    return {
      yearScore: scores[targetYear] ?? 0,
      newTotal: calcRecentFourYearTotal(scores),
    }
  }

  function requestSave() {
    setError(null)
    if (!giveUp && (!preferences.preference1 || !preferences.preference2 || !preferences.preference3)) {
      setError('請填寫三個志願，或勾選「放棄選填志願」')
      return
    }
    setShowConfirm(true)
  }

  async function confirmSave() {
    setShowConfirm(false)
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/teacher/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...preferences, give_up: giveUp }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? '儲存失敗')
      }
      setLocked(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  function setPreference(key: keyof Preferences, value: string) {
    setPreferences(prev => ({ ...prev, [key]: value || null }))
  }

  const needsScoreConfirm = targetType !== null && !scoreConfirmed

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="page-title">選填志願</h2>

      {targetType === null && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">您 {targetYear} 學年度不需填寫志願</span>
            ——依您歷年輪動紀錄判定，您今年才剛接手新職務（首屆），下一年才會輪換。如有疑問請洽人事或教務處。
          </p>
          <p className="text-xs text-amber-700/80 mt-1">
            您仍可瀏覽以下表單與預估分數，但不會被列入 {targetYear} 學年度的志願統計。
          </p>
        </div>
      )}

      {needsScoreConfirm && (
        <div className="card border-amber-300 bg-amber-50 space-y-3">
          <div>
            <p className="text-sm font-semibold text-amber-900">⚠ 請先完成積分確認</p>
            <p className="text-sm text-amber-800 mt-1">
              選填志願前，須先到「輪動分數」頁面核對歷年積分並確認無誤。確認後即可回此頁填寫志願。
            </p>
          </div>
          <Link href="/teacher/scores" className="btn-primary inline-flex w-fit">
            前往確認積分 →
          </Link>
        </div>
      )}

      {!needsScoreConfirm && locked && (
        <div className="card border-zinc-300 bg-zinc-50">
          <p className="text-sm text-zinc-700">
            <span className="font-semibold">🔒 您的志願已鎖定</span>
            ——已成功儲存。如需修改請洽管理員協助解鎖。
          </p>
        </div>
      )}

      {!needsScoreConfirm && (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">下學年度工作志願（{targetYear} 學年度）</h3>
            <p className="text-xs text-zinc-400 mt-1">右側顯示：選擇此職位後 {targetYear} 學年的本年積分，以及 {targetYear - 3}～{targetYear} 學年度的近四年預估總分</p>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600">已儲存</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
            <button onClick={requestSave} disabled={saving || locked} className="btn-primary">
              {saving ? '儲存中...' : locked ? '已鎖定' : '儲存志願'}
            </button>
          </div>
        </div>

        {/* 放棄選填志願 */}
        <label className={`flex items-start gap-2 mb-5 p-3 border rounded-sm select-none transition ${
          giveUp ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 bg-zinc-50'
        } ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={giveUp}
            disabled={locked}
            onChange={e => setGiveUp(e.target.checked)}
            className="w-4 h-4 mt-0.5 flex-shrink-0"
          />
          <span className="text-sm text-zinc-700 leading-relaxed">
            預計 {targetYear} 學年度<strong>育嬰留停 / 留職停薪 / 延長病假 / 其他事由</strong>，
            放棄選填志願，中途返校由校內安排。
          </span>
        </label>

        <div className={`space-y-4 ${giveUp && !locked ? 'opacity-50' : ''}`}>
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
                  disabled={disabled}
                  onChange={e => setPreference(key, e.target.value)}
                >
                  <option value="">請選擇</option>
                  {allWorks.map(w => (
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
      )}

      {/* 儲存確認 Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-zinc-900">確認儲存志願</h3>
            <div className="text-sm text-zinc-600 space-y-2">
              <p>儲存後將立即<strong className="text-red-600">鎖定您的志願</strong>，無法自行修改。</p>
              <p>如有需要修改，請洽管理員協助解鎖後再行修改。</p>
              {giveUp ? (
                <p className="pt-2 border-t border-zinc-100 text-amber-700">
                  ⚠ 您已勾選「放棄選填志願」，三個志願將存為空白。
                </p>
              ) : (
                <div className="pt-2 border-t border-zinc-100 text-xs space-y-0.5 text-zinc-500">
                  <div>第一志願：<span className="font-medium text-zinc-800">{preferences.preference1}</span></div>
                  <div>第二志願：<span className="font-medium text-zinc-800">{preferences.preference2}</span></div>
                  <div>第三志願：<span className="font-medium text-zinc-800">{preferences.preference3}</span></div>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)} className="btn-secondary">取消</button>
              <button onClick={confirmSave} disabled={saving} className="btn-primary">
                {saving ? '儲存中...' : '確認儲存並鎖定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
