'use client'

import { cn } from '@/lib/utils'
import { monthGridDates, dashboardTodayStr, isWeekend } from '@/lib/dashboard'

export interface CalendarCellItem {
  key: string
  label: string
  kind: 'event' | 'holiday' | 'workday' | 'personal'
}

const KIND_CHIP: Record<CalendarCellItem['kind'], string> = {
  event:    'bg-sky-100 text-sky-800',
  holiday:  'bg-red-50 text-red-600',
  workday:  'bg-zinc-200 text-zinc-700',
  personal: 'bg-amber-100 text-amber-800',
}

const KIND_DOT: Record<CalendarCellItem['kind'], string> = {
  event:    'bg-sky-400',
  holiday:  'bg-red-400',
  workday:  'bg-zinc-400',
  personal: 'bg-amber-400',
}

const WEEKDAY_HEADERS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 月視圖行事曆（純顯示＋點選日期）。month 為 1–12。
 * 假日判定：有 holiday 項目、或週六日且無 workday（補行上班）項目 → 日期數字標紅。
 */
export function MonthCalendar({
  year,
  month,
  itemsByDate,
  selectedDate,
  onSelectDate,
  onItemClick,
}: {
  year: number
  month: number
  itemsByDate: Record<string, CalendarCellItem[]>
  selectedDate: string | null
  onSelectDate: (date: string) => void
  /** 點擊格內事件小籤（未提供則小籤僅隨格子選日期） */
  onItemClick?: (item: CalendarCellItem) => void
}) {
  const today = dashboardTodayStr()
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const dates = monthGridDates(year, month)

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-zinc-200">
        {WEEKDAY_HEADERS.map((w, i) => (
          <div
            key={w}
            className={cn(
              'py-1.5 text-center text-xs font-medium',
              i === 0 || i === 6 ? 'text-red-400' : 'text-zinc-500'
            )}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dates.map(date => {
          const items = itemsByDate[date] ?? []
          const inMonth = date.startsWith(monthPrefix)
          const isOff = items.some(i => i.kind === 'holiday')
            || (isWeekend(date) && !items.some(i => i.kind === 'workday'))
          const dayNum = Number(date.slice(8, 10))
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              className={cn(
                'min-h-[3.25rem] sm:min-h-[4.5rem] border-b border-r border-zinc-100 p-1 text-left align-top',
                'flex flex-col gap-0.5 transition-colors hover:bg-zinc-50',
                !inMonth && 'bg-zinc-50/60',
                selectedDate === date && 'bg-zinc-100 hover:bg-zinc-100'
              )}
            >
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center text-xs',
                  isOff ? 'text-red-500' : 'text-zinc-700',
                  !inMonth && 'opacity-40',
                  date === today && 'rounded-full bg-zinc-800 font-semibold text-white'
                )}
              >
                {dayNum}
              </span>
              {/* 桌機：事件小籤（全部顯示，格子自動長高）；手機：彩色圓點 */}
              <span className="hidden flex-col gap-0.5 sm:flex">
                {items.map(item => (
                  <span
                    key={item.key}
                    onClick={onItemClick ? e => { e.stopPropagation(); onSelectDate(date); onItemClick(item) } : undefined}
                    className={cn(
                      'truncate px-1 py-px text-[11px] leading-4',
                      KIND_CHIP[item.kind],
                      !inMonth && 'opacity-50',
                      onItemClick && 'cursor-pointer hover:opacity-80'
                    )}
                  >
                    {item.label}
                  </span>
                ))}
              </span>
              <span className="flex flex-wrap gap-0.5 sm:hidden">
                {items.slice(0, 4).map(item => (
                  <span key={item.key} className={cn('h-1.5 w-1.5 rounded-full', KIND_DOT[item.kind])} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
