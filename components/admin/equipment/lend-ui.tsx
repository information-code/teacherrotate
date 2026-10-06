'use client'

// 設備借用管理頁共用的小元件：狀態標籤、hover 提示、色塊文字、節次選擇、設備卡片。

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react'

const WEEKDAY = '日一二三四五六'

/** 2026-10-06 → 10/6（二） */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d}（${WEEKDAY[new Date(y, m - 1, d).getDay()]}）`
}

/** 起訖日期文字：同一天只寫一次 */
export function dateRangeLabel(start: string, end: string): string {
  return start === end ? dateLabel(start) : `${dateLabel(start)} ～ ${dateLabel(end)}`
}

export const ICONS = {
  alert: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <rect x="7.1" y="3.7" width="1.8" height="5.5" rx=".9" fill="#fff" />
      <circle cx="8" cy="11.7" r="1.05" fill="#fff" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.2" rx="1.6" fill="currentColor" />
      <path d="M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  renew: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11.9 1.6v3H8.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}
export type IconName = keyof typeof ICONS
export type Severity = 'critical' | 'serious' | 'warning' | 'good' | 'neutral'

/** 狀態標籤：圖示＋文字，不只靠顏色 */
export function StatusChip({ sev, icon, children }: { sev: Severity; icon: IconName; children: ReactNode }) {
  return <span className={`st st-${sev}`}>{ICONS[icon]}{children}</span>
}

/** 圖例色塊 */
export function Swatch({ color, outlined }: { color: string; outlined?: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 flex-none rounded-sm ${outlined ? 'ring-1 ring-inset ring-zinc-300' : ''}`}
      style={{ background: color }}
    />
  )
}

// ---------- hover 提示（值在前、名稱在後；鍵盤 focus 也顯示） ----------

interface TipState { x: number; y: number; lines: string[] }
const tipListeners = new Set<(tip: TipState | null) => void>()
const emitTip = (tip: TipState | null) => tipListeners.forEach(fn => fn(tip))

/** 掛到圖表色塊上；提示框本身由 <HoverTip /> 畫，滑鼠移動只重繪提示框 */
export function tipHandlers(lines: string[]) {
  return {
    onMouseMove: (e: MouseEvent) => emitTip({ x: e.clientX, y: e.clientY, lines }),
    onMouseLeave: () => emitTip(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      emitTip({ x: r.left + r.width / 2, y: r.top, lines })
    },
    onBlur: () => emitTip(null),
  }
}

export function HoverTip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tipListeners.add(setTip)
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    return () => {
      tipListeners.delete(setTip)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tip || !ref.current) { setPos(null); return }
    const w = ref.current.offsetWidth
    const h = ref.current.offsetHeight
    let left = tip.x + 14
    let top = tip.y - h - 12
    if (left + w > window.innerWidth - 8) left = Math.max(8, tip.x - w - 14)
    if (top < 8) top = tip.y + 18
    setPos({ left, top })
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[60] max-w-[280px] rounded bg-zinc-900 px-2.5 py-2 text-xs leading-relaxed text-zinc-300 shadow-lg"
      style={pos ?? { left: -9999, top: -9999 }}
    >
      <div className="text-[13px] font-semibold text-white">{tip.lines[0]}</div>
      {tip.lines.slice(1).map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

/** 色塊內的文字：放不下換短標籤，再放不下就只留提示（不裁切文字） */
export function FitLabel({ full, short }: { full: string; short: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [level, setLevel] = useState(0)

  useLayoutEffect(() => { setLevel(0) }, [full, short])
  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (box && level < 2 && box.scrollWidth > box.clientWidth + 1) setLevel(level + 1)
  }, [level, full, short])
  useEffect(() => {
    const reset = () => setLevel(0)
    window.addEventListener('resize', reset)
    return () => window.removeEventListener('resize', reset)
  }, [])

  return <span ref={ref}>{level === 0 ? full : level === 1 ? short : ''}</span>
}

// ---------- 節次選擇 ----------

/** 點一下選開始、再點一下選結束；只借一節點一下即可 */
export function PeriodPicker({
  periods,
  start,
  end,
  minIndex = 0,
  onChange,
}: {
  periods: { key: string; label: string }[]
  start: number | null
  end: number | null
  minIndex?: number
  onChange: (start: number, end: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {periods.map((p, i) => {
        const on = start !== null && (i === start || i === end)
        const mid = start !== null && end !== null && i > start && i < end
        return (
          <button
            key={p.key}
            type="button"
            disabled={i < minIndex}
            className={`chip ${on ? 'on' : mid ? 'mid' : ''}`}
            onClick={() => {
              if (start === null || end !== start || i <= start) onChange(i, i)
              else onChange(start, i)
            }}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- 設備卡片 ----------

/** 與 lib/equipment-server 的 ResourceAvailability 相同 */
export interface Resource {
  key: string
  kind: 'group' | 'type'
  groupId: string | null
  name: string
  place: string
  total: number
  free: { id: string; asset: string }[]
  overdue: number
  long: number
  maint: number
}

/** 一張卡片一台車或一種設備：顯示這段時間可借幾台；借滿的仍可看但不能選 */
export function ResourceCard({
  r,
  selected,
  hint,
  onClick,
}: {
  r: Resource
  selected: boolean
  hint: string
  onClick: () => void
}) {
  const free = r.free.length
  const full = free === 0
  const others = [r.long > 0 && `${r.long} 台長期借出`, r.maint > 0 && `${r.maint} 台維修中`].filter(Boolean)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-disabled={full || undefined}
      className={`flex flex-col gap-2 rounded border p-3 text-left transition-colors ${
        selected
          ? 'border-zinc-800 bg-white ring-1 ring-zinc-800'
          : full
            ? 'cursor-not-allowed border-zinc-200 bg-zinc-50'
            : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
    >
      <div className={`flex items-start justify-between gap-2 ${full ? 'opacity-50' : ''}`}>
        <span className="text-sm font-medium leading-snug text-zinc-900">{r.name}</span>
        {r.kind === 'group' && r.place && <span className="whitespace-nowrap text-xs text-zinc-500">{r.place}</span>}
      </div>
      <div className={`h-1.5 overflow-hidden rounded-full bg-[var(--lend-track)] ${full ? 'opacity-50' : ''}`}>
        <div
          className="h-full bg-[var(--lend-short)]"
          style={{ width: `${r.total > 0 ? (100 * (r.total - free)) / r.total : 0}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-zinc-600">
        <span>
          {full ? '這段時間已借滿' : <>可借 <b className="font-semibold text-zinc-900">{free}</b> / {r.total}</>}
        </span>
        <span className="text-zinc-400">{hint}</span>
      </div>
      {r.overdue > 0 && <StatusChip sev="critical" icon="alert">{r.overdue} 台逾期未還，追回前不開放</StatusChip>}
      {others.length > 0 && <div className="text-xs text-zinc-500">{others.join('、')}</div>}
    </button>
  )
}

/** 群組借 N 台的配號預覽：#C-17 ～ #C-36 */
export function unitRangeText(units: { asset: string }[]): string {
  if (units.length === 0) return ''
  const first = units[0].asset ? `#${units[0].asset}` : '第 1 台'
  if (units.length === 1) return first
  const last = units[units.length - 1].asset ? `#${units[units.length - 1].asset}` : `第 ${units.length} 台`
  return `${first} ～ ${last}`
}
