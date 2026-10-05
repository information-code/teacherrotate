'use client'

import { Fragment } from 'react'
import { cn } from '@/lib/utils'

const MONTH_RE = /^\d{4}-\d{2}/

/** YYYY-MM 加減 n 個月 */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** [start, end]（YYYY-MM-DD 或 YYYY-MM）涵蓋的所有月份（YYYY-MM），由小到大；最多 24 個 */
export function monthsBetween(start: string, end: string): string[] {
  if (!MONTH_RE.test(start) || !MONTH_RE.test(end)) return []
  const out: string[] = []
  const last = end.slice(0, 7)
  for (let m = start.slice(0, 7); m <= last && out.length < 24; m = shiftMonth(m, 1)) out.push(m)
  return out
}

/**
 * 月份選擇（取代原生 type="month"：彈出的年曆格子難點）。
 * ‹ 2026 年 10 月 › 左右切換；有 months（如計畫期程內的月份）時另列一排按鈕，一點即選。
 */
export function MonthPicker({
  value,
  onChange,
  months = [],
}: {
  value: string                 // YYYY-MM
  onChange: (month: string) => void
  months?: string[]             // 快選月份（YYYY-MM，由小到大）
}) {
  const [y, m] = value.split('-').map(Number)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="inline-flex items-stretch border border-zinc-300 rounded">
        <button
          type="button"
          className="px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          onClick={() => onChange(shiftMonth(value, -1))}
          aria-label="上個月"
        >
          ‹
        </button>
        <span className="min-w-[7.5rem] border-x border-zinc-300 px-3 py-1.5 text-center text-sm font-medium text-zinc-900">
          {y} 年 {m} 月
        </span>
        <button
          type="button"
          className="px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          onClick={() => onChange(shiftMonth(value, 1))}
          aria-label="下個月"
        >
          ›
        </button>
      </div>
      {months.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {months.map((mo, i) => (
            <Fragment key={mo}>
              {/* 跨年時在每年第一個月前標年份 */}
              {(i === 0 || mo.slice(0, 4) !== months[i - 1].slice(0, 4)) && (
                <span className={cn('text-xs text-zinc-400', i > 0 && 'ml-1')}>{mo.slice(0, 4)}</span>
              )}
              <button
                type="button"
                onClick={() => onChange(mo)}
                aria-pressed={mo === value}
                className={cn(
                  'rounded border px-2.5 py-1 text-sm transition-colors',
                  mo === value
                    ? 'border-zinc-800 bg-zinc-800 text-white'
                    : 'border-zinc-300 text-zinc-700 hover:border-zinc-500',
                )}
              >
                {Number(mo.slice(5, 7))}月
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
