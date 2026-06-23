'use client'

import { useState } from 'react'
import type { RotationTarget } from '@/lib/rotation-target'

interface ScoreEntry {
  year: number
  work?: string
  score?: number
  semester?: string
}

interface Props {
  targetType: RotationTarget | null
  initialScoreHistory: ScoreEntry[]
  initialRecentTotal: number | null
  initialConfirmed: boolean
  initialConfirmedAt: string | null
  closed: boolean
}

export function ScoresPage({ targetType, initialScoreHistory, initialRecentTotal, initialConfirmed, initialConfirmedAt, closed }: Props) {
  const [scoreHistory] = useState<ScoreEntry[]>(initialScoreHistory)
  const [recentTotal] = useState<number | null>(initialRecentTotal)
  const [confirmed, setConfirmed] = useState(initialConfirmed)
  const [confirmedAt] = useState(initialConfirmedAt)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmSaving, setConfirmSaving] = useState(false)

  const nextYear = Math.max(0, ...scoreHistory.map(s => s.year)) + 1

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

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="page-title">輪動分數</h2>

      {targetType === null && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">您今年不在「分數確認」對象內</span>
            ——依您歷年輪動紀錄判定為首屆（剛接手新職務），下一年才會輪換。如有疑問請洽人事或教務處。
          </p>
          <p className="text-xs text-amber-700/80 mt-1">
            您仍可瀏覽歷年積分；待明年輪換時系統會自動列入確認名單。
          </p>
        </div>
      )}

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

        {/* 確認勾選框（非目標教師不顯示，避免誤勾）*/}
        {targetType !== null && (
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
          ) : closed ? (
            <p className="text-sm text-amber-700">
              目前非開放期間，暫停分數確認。下一年度開放時即可確認。如有疑問請洽管理員。
            </p>
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
        )}
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
    </div>
  )
}
