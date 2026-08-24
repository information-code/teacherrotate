'use client'

// 借用情況儀表板：一張 squarified treemap 熱力圖，一個方塊一種設備（同名彙總）。
// 方塊大小＝全校總台數（含長借與維修，固定的規模）、底色＝選定節次的可借比例（變動的狀態），
// 比照股票熱力圖「大小＝市值、顏色＝漲跌」——大又紅的方塊一眼就是「熱門設備快沒了」。
// 方塊內列出 總數/長借/短借，讓老師知道「沒得借」是被長借走了還是這節被短借滿了。
// 資料打短期借用同一支 API：typeTotals＝同名彙總（總數/長借/維修）、
// equipment＝可短借清單、occupied＝日期→設備→已占用節次。

import { useCallback, useEffect, useRef, useState } from 'react'
import { PageLoading } from '@/components/ui/PageLoading'
import { EQUIPMENT_PERIODS, periodLabel } from '@/lib/equipment'

interface BoardData {
  config: { openPeriods: string[]; today: string; maxDate: string }
  from: string
  equipment: { id: string; name: string }[]
  occupied: Record<string, Record<string, string[]>>
  /** 同名彙總：全校總數（不含停用）與長借/維修台數 */
  typeTotals: { name: string; total: number; longLoaned: number; maintenance: number }[]
}

/** 各節次開始時間（本校作息，與 lib/schedule-export PERIOD_TIMES 同源；儀表板預設節次用） */
const PERIOD_START: Record<string, string> = {
  morning: '07:30', p1: '08:40', p2: '09:30', p3: '10:30', p4: '11:20',
  noon: '12:00', p5: '13:30', p6: '14:20', p7: '15:15', p8: '16:00', after: '16:45',
}

/** 現在時間落在（或最接近）哪一節：取已開始的最後一節，都還沒開始就取第一節 */
function currentPeriodKey(openPeriods: string[]): string {
  const now = new Date()
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const order = EQUIPMENT_PERIODS.map(p => p.key as string).filter(k => openPeriods.includes(k))
  let pick = order[0] ?? ''
  for (const key of order) {
    if ((PERIOD_START[key] ?? '99:99') <= hm) pick = key
  }
  return pick
}

// ---------- treemap 排版（squarified） ----------

interface TypeStat {
  name: string
  /** 全校總台數（不含停用） */
  total: number
  /** 選定節次可借台數 */
  free: number
  longLoaned: number
  shortLoaned: number
  maintenance: number
}

interface Rect {
  item: TypeStat
  x: number
  y: number
  w: number
  h: number
}

/** squarified treemap：把 items（需先照 size 由大到小排）塞進 (x,y,w,h)，讓方塊盡量接近正方形 */
function squarify(items: { item: TypeStat; size: number }[], x: number, y: number, w: number, h: number, out: Rect[]): void {
  if (items.length === 0 || w <= 0 || h <= 0) return
  if (items.length === 1) {
    out.push({ item: items[0].item, x, y, w, h })
    return
  }
  const total = items.reduce((sum, it) => sum + it.size, 0)
  const vertical = w >= h
  const side = vertical ? h : w
  // 逐一試著把下一個塞進當前列，最差長寬比變糟就收列
  let row: typeof items = []
  let rowSum = 0
  let best = Infinity
  let i = 0
  while (i < items.length) {
    const trySum = rowSum + items[i].size
    const thickness = ((trySum / total) * w * h) / side
    let worst = 0
    for (const it of [...row, items[i]]) {
      const length = (it.size / trySum) * side
      worst = Math.max(worst, thickness / length, length / thickness)
    }
    if (worst > best && row.length > 0) break
    row.push(items[i])
    rowSum = trySum
    best = worst
    i++
  }
  const thickness = ((rowSum / total) * w * h) / side
  let offset = 0
  for (const it of row) {
    const length = (it.size / rowSum) * side
    if (vertical) out.push({ item: it.item, x, y: y + offset, w: thickness, h: length })
    else out.push({ item: it.item, x: x + offset, y, w: length, h: thickness })
    offset += length
  }
  if (vertical) squarify(items.slice(i), x + thickness, y, w - thickness, h, out)
  else squarify(items.slice(i), x, y + thickness, w, h - thickness, out)
}

// 可借比例四段語意色（低彩度，配專案灰階風格）
const RATIO_COLORS = {
  ok: '#5f9472', // 充足 ≥60%
  mid: '#b99a4e', // 尚可 30–60%
  low: '#bf6a52', // 緊張 <30%
  none: '#a94f4a', // 借完
} as const

function fillColor(ratio: number): string {
  if (ratio <= 0) return RATIO_COLORS.none
  if (ratio < 0.3) return RATIO_COLORS.low
  if (ratio < 0.6) return RATIO_COLORS.mid
  return RATIO_COLORS.ok
}

function Treemap({ stats }: { stats: TypeStat[] }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rects: Rect[] = []
  if (size.w > 0 && size.h > 0) {
    const items = stats
      .map(item => ({ item, size: item.total }))
      .sort((a, b) => b.size - a.size)
    squarify(items, 0, 0, size.w, size.h, rects)
  }

  return (
    <div ref={boxRef} className="relative w-full h-80 sm:h-[420px] rounded border border-zinc-200 bg-zinc-50 overflow-hidden">
      {rects.map(r => {
        const s = r.item
        const ratio = s.free / s.total
        const tiny = r.w < 48 || r.h < 36
        const small = r.w < 92 || r.h < 76
        const tip =
          `${s.name}：共 ${s.total} 台｜長期借出 ${s.longLoaned}｜此節次短借 ${s.shortLoaned}` +
          (s.maintenance > 0 ? `｜維修中 ${s.maintenance}` : '') +
          `｜剩 ${s.free} 台可借`
        return (
          <div
            key={s.name}
            className="absolute flex flex-col items-center justify-center text-center overflow-hidden rounded-sm border-2 border-zinc-50 p-0.5 transition-all duration-300"
            style={{ left: r.x, top: r.y, width: r.w, height: r.h, backgroundColor: fillColor(ratio) }}
            title={tip}
          >
            {!tiny && (
              <>
                <div className={`font-medium text-white leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,.3)] ${small ? 'text-xs' : 'text-sm'}`}>
                  {s.name}
                </div>
                <div className={`text-white/90 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,.3)] ${small ? 'text-[10px]' : 'text-xs'}`}>
                  剩 {s.free}／{s.total}
                </div>
                {!small && (
                  <div className="text-[10px] text-white/80 tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,.3)]">
                    長借 {s.longLoaned}・短借 {s.shortLoaned}
                    {s.maintenance > 0 && `・修 ${s.maintenance}`}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------- 借用情況 Tab ----------

export function AvailabilityTab() {
  const [data, setData] = useState<BoardData | null>(null)
  const [date, setDate] = useState('')
  const [period, setPeriod] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (day?: string) => {
    setLoading(true)
    try {
      const query = day ? `?from=${day}&to=${day}` : ''
      const res = await fetch(`/api/teacher/equipment${query}`)
      if (!res.ok) {
        setError('載入失敗，請重新整理。')
        return
      }
      const result: BoardData = await res.json()
      setData(result)
      setDate(result.from)
      // 首次載入：預設「現在（或即將開始）的節次」
      setPeriod(prev => (prev && result.config.openPeriods.includes(prev)
        ? prev
        : currentPeriodKey(result.config.openPeriods)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!data) return <PageLoading />

  const openPeriods = EQUIPMENT_PERIODS.filter(p => data.config.openPeriods.includes(p.key))
  const occupiedToday = data.occupied[date] ?? {}

  // 全校總數/長借/維修來自 typeTotals；短借占用與可借按選定節次從可短借清單計
  const statMap = new Map<string, TypeStat>(
    (data.typeTotals ?? []).map(t => [t.name, { ...t, free: 0, shortLoaned: 0 }])
  )
  for (const equip of data.equipment) {
    const stat = statMap.get(equip.name)
    if (!stat) continue
    if ((occupiedToday[equip.id] ?? []).includes(period)) stat.shortLoaned++
    else stat.free++
  }
  const stats = Array.from(statMap.values())
  const sum = (pick: (s: TypeStat) => number) => stats.reduce((acc, s) => acc + pick(s), 0)
  const totalUnits = sum(s => s.total)
  const freeUnits = sum(s => s.free)
  const longUnits = sum(s => s.longLoaned)
  const shortUnits = sum(s => s.shortLoaned)
  const maintUnits = sum(s => s.maintenance)

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-medium text-zinc-900">全校設備借用情況</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          方塊大小＝設備總台數，顏色＝所選節次的可借比例；大又偏紅的方塊代表熱門設備快被借完了。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="label">日期</span>
          <input
            type="date"
            className="input"
            value={date}
            min={data.config.today}
            max={data.config.maxDate}
            onChange={e => {
              setDate(e.target.value)
              load(e.target.value)
            }}
          />
        </div>
        <div className="flex-1 min-w-[240px]">
          <span className="label">節次</span>
          <div className="flex flex-wrap gap-1.5">
            {openPeriods.map(p => (
              <button
                key={p.key}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  period === p.key
                    ? 'bg-zinc-800 text-white border-zinc-800'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500'
                }`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {stats.length === 0 ? (
        <p className="text-sm text-zinc-500">目前沒有開放借用的設備。</p>
      ) : (
        <div className={loading ? 'opacity-50 pointer-events-none' : ''}>
          <p className="text-sm text-zinc-600 mb-2">
            {date}｜{periodLabel(period)}：全校 {stats.length} 種共 {totalUnits} 台，剩{' '}
            <span className="font-medium tabular-nums">{freeUnits}</span> 台可借
            （長借 {longUnits}、短借 {shortUnits}{maintUnits > 0 && `、維修 ${maintUnits}`}）
          </p>
          <Treemap stats={stats} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: RATIO_COLORS.ok }} />充足（6 成以上）
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: RATIO_COLORS.mid }} />尚可（3～6 成）
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: RATIO_COLORS.low }} />緊張（3 成以下）
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: RATIO_COLORS.none }} />已借完
            </span>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400">
        總台數含長期借出與維修中的設備（停用不計）；長期借出的要等管理者釋出才能短期借用。
        要借用請到「短期借用」分頁預約。
      </p>
    </div>
  )
}
