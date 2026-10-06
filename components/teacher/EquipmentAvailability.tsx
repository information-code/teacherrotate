'use client'

// 教師端「借用情況」：當天（可切換日期）每台車、每種設備被誰預約、借用、歸還，以及此刻設備分布。
// 與管理端今日總覽同一份資料（/api/teacher/equipment-board），只是不含需處理清單。

import { useEffect, useState } from 'react'
import { PageLoading } from '@/components/ui/PageLoading'
import { BoardCard, DistCard, type BoardView, type DistRow } from '@/components/equipment/LendingBoard'
import { HoverTip } from '@/components/equipment/lend-ui'

type BoardData = BoardView & { dist: DistRow[] }

export function AvailabilityTab() {
  const [date, setDate] = useState('')
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/teacher/equipment-board${date ? `?date=${date}` : ''}`)
      .then(async res => {
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) setError(json.error ?? '載入失敗，請重新整理。')
        else {
          setError('')
          setData(json)
        }
      })
      .catch(() => { if (!cancelled) setError('載入失敗，請重新整理。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : <PageLoading />

  return (
    <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <BoardCard data={data} onDate={setDate} />
      <DistCard dist={data.dist} nowPeriod={data.nowPeriod} />
      <p className="text-xs text-zinc-400">
        色塊用滑鼠移上去（手機點一下）可看借用人與時間。要借用請到「短期借用」分頁預約。
      </p>
      <HoverTip />
    </div>
  )
}
