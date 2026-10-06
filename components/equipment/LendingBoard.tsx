'use client'

// 借用情況的兩張圖：設備課表（指定日期誰預約、誰借用、誰歸還）與此刻設備分布。
// 管理端「今日總覽」與教師端「借用情況」共用。

import { addDays, periodLabel } from '@/lib/equipment'
import { FitLabel, ICONS, StatusChip, Swatch, dateLabel, tipHandlers } from './lend-ui'

export type ItemStatus = 'out' | 'resv' | 'done' | 'noshow' | 'overdue' | 'held'

export interface BoardItem {
  id: string
  row: string
  who: string
  activity: boolean
  qty: number
  unit: string
  s: number
  e: number
  status: ItemStatus
  note: string
  time: string
}
export interface BoardRow { key: string; kind: 'group' | 'type'; name: string; sub: string; total: number }

export interface DistRow {
  name: string
  total: number
  long: number
  short: number
  maint: number
  overdue: number
  held: number
  carts: { id: string; name: string; total: number; long: number; short: number; maint: number; overdue: number }[]
}

/** 設備課表需要的欄位（管理端今日總覽、教師端借用情況共用） */
export interface BoardView {
  date: string
  today: string
  nowPeriod: string | null
  openPeriods: string[]
  board: { rows: BoardRow[]; items: BoardItem[]; idleTypes: string[] }
}

export const pct = (n: number, total: number) => `${total > 0 ? Math.round((100 * n) / total) : 0}%`

// ---------- 設備課表 ----------

const BAR_STYLE: Record<ItemStatus, string> = {
  out: 'bg-[var(--lend-short)] text-white font-medium',
  resv: 'bg-[var(--lend-resv)] text-zinc-900',
  done: 'bg-[var(--lend-done)] text-zinc-600',
  noshow: 'bg-orange-50 text-orange-800 shadow-[inset_0_0_0_1.5px_var(--st-serious)] [&>svg]:text-[var(--st-serious)]',
  overdue: 'bg-red-50 text-red-800 font-medium shadow-[inset_0_0_0_1.5px_var(--st-critical)] [&>svg]:text-[var(--st-critical)]',
  held: 'bg-[var(--lend-held)] text-white',
}
const STATUS_TEXT: Record<ItemStatus, string> = {
  out: '借用中',
  resv: '預約中',
  done: '已歸還',
  noshow: '預約未借（時段已到仍未按借用）',
  overdue: '逾期未還',
  held: '活動保留',
}

/** 同一列的借用排進不重疊的分道 */
function packLanes(items: BoardItem[]): { item: BoardItem; lane: number }[] {
  const ends: number[] = []
  return [...items].sort((a, b) => a.s - b.s || b.e - a.e).map(item => {
    let lane = ends.findIndex(end => end < item.s)
    if (lane < 0) {
      lane = ends.length
      ends.push(-1)
    }
    ends[lane] = item.e
    return { item, lane }
  })
}

export function BoardCard({ data, onDate }: { data: BoardView; onDate: (date: string) => void }) {
  const order = data.openPeriods
  const isToday = data.date === data.today
  const nowIdx = isToday && data.nowPeriod ? order.indexOf(data.nowPeriod) : -1
  const cols = `repeat(${order.length}, minmax(0, 1fr))`
  const rangeText = (s: number, e: number) =>
    s === e ? periodLabel(order[s]) : `${periodLabel(order[s])}–${periodLabel(order[e])}`

  return (
    <div className="card !p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div className="space-y-2">
          <h2 className="font-medium text-zinc-900">
            {isToday ? '今日設備課表' : `${dateLabel(data.date)} 設備課表`}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary !px-3 !py-1" aria-label="前一天" onClick={() => onDate(addDays(data.date, -1))}>‹</button>
            <input
              type="date"
              className="input !w-40 !py-1"
              aria-label="課表日期"
              value={data.date}
              onChange={e => e.target.value && onDate(e.target.value)}
            />
            <button className="btn-secondary !px-3 !py-1" aria-label="後一天" onClick={() => onDate(addDays(data.date, 1))}>›</button>
            {!isToday && (
              <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => onDate(data.today)}>回到今天</button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-600">
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-short)" />借用中</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-resv)" />預約中</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-done)" />已歸還</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-held)" />活動保留</span>
          <StatusChip sev="serious" icon="clock">未取用</StatusChip>
          <StatusChip sev="critical" icon="alert">逾期未還</StatusChip>
        </div>
      </div>

      <div className="overflow-x-auto pb-2 pt-3">
        {/* 名稱欄固定在左邊：手機左右滑看後面節次時仍知道是哪台車 */}
        <div
          className="grid pr-5 [--name-col:138px] sm:[--name-col:192px]"
          style={{ gridTemplateColumns: 'var(--name-col) minmax(0, 1fr)', minWidth: `calc(var(--name-col) + ${order.length * 62 + 20}px)` }}
        >
          <div className="sticky left-0 z-[2] bg-white pl-5" />
          <div className="grid gap-x-0.5" style={{ gridTemplateColumns: cols }}>
            {order.map((key, i) => (
              <div key={key} className={`pb-2 text-center text-xs leading-tight ${i === nowIdx ? 'font-semibold text-zinc-900' : 'text-zinc-500'}`}>
                <span className="mb-0.5 block h-[17px]">
                  {i === nowIdx && <span className="inline-block rounded-sm bg-zinc-800 px-1.5 text-[10.5px] font-medium leading-4 text-white">現在</span>}
                </span>
                {periodLabel(key)}
              </div>
            ))}
          </div>

          {data.board.rows.map(row => {
            const placed = packLanes(data.board.items.filter(i => i.row === row.key))
            const lanes = Math.max(1, ...placed.map(p => p.lane + 1))
            return (
              <div key={row.key} className="contents">
                <div className="sticky left-0 z-[2] border-t border-zinc-200 bg-white py-2.5 pl-5 pr-3 text-[13px] leading-snug text-zinc-800 shadow-[1px_0_0_#e4e4e7]">
                  {row.name}
                  <span className="mt-px block text-[11.5px] text-zinc-500">{row.sub}</span>
                </div>
                <div
                  className="grid gap-x-0.5 gap-y-1 border-t border-zinc-200 py-[9px]"
                  style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${lanes}, 26px)` }}
                >
                  {order.map((key, i) => (
                    <div
                      key={key}
                      className={`-my-[9px] border-l ${i === nowIdx ? 'border-zinc-200 bg-zinc-100' : 'border-zinc-100'}`}
                      style={{ gridColumn: `${i + 1} / ${i + 2}`, gridRow: '1 / -1' }}
                    />
                  ))}
                  {placed.map(({ item, lane }) => {
                    const whole = row.kind === 'group' && item.qty === row.total
                    const qtyText = row.kind === 'group' ? (whole ? `整組 ${item.qty} 台` : `${item.qty} 台`) : item.unit ? `#${item.unit}` : '1 台'
                    const lines = [
                      `${item.who} · ${qtyText}`,
                      item.activity ? `${row.name}（活動保留）` : row.name,
                      `${item.status === 'overdue' ? '整天在外' : rangeText(item.s, item.e)} · ${STATUS_TEXT[item.status]}`,
                      ...(item.note ? [item.note] : []),
                      ...(item.time && item.status !== 'overdue' && item.time.includes('～') ? [`借用期間 ${item.time}`] : []),
                    ]
                    const q = row.kind === 'group' ? (whole ? '整組' : `${item.qty}台`) : ''
                    const full = {
                      out: `${item.who} ${q}`, resv: `${item.who} ${q}`, done: `${item.who} 已還`,
                      noshow: `${item.who} 未取`, overdue: `${item.who} · 逾期未還`, held: `${item.who} ${q}`,
                    }[item.status].trim()
                    return (
                      <div
                        key={`${item.id}:${item.s}`}
                        tabIndex={0}
                        aria-label={lines.join('，')}
                        className={`relative z-[1] flex h-[26px] min-w-0 cursor-default items-center gap-1 whitespace-nowrap rounded px-[7px] text-xs hover:ring-2 hover:ring-zinc-800 hover:ring-offset-1 [&>svg]:h-[13px] [&>svg]:w-[13px] [&>svg]:flex-none ${BAR_STYLE[item.status]}`}
                        style={{ gridColumn: `${item.s + 1} / ${item.e + 2}`, gridRow: String(lane + 1) }}
                        {...tipHandlers(lines)}
                      >
                        {item.status === 'noshow' && ICONS.clock}
                        {item.status === 'overdue' && ICONS.alert}
                        <FitLabel full={full} short={item.who} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {data.board.idleTypes.length > 0 && (
        <p className="px-5 pb-4 text-xs text-zinc-500">
          {isToday ? '今天' : '這天'}沒有短期借用：{data.board.idleTypes.join('、')}
        </p>
      )}
    </div>
  )
}

// ---------- 此刻設備分布 ----------

function DistBar({ name, total, long, short, maint, thin, overdue }: {
  name: string
  total: number
  long: number
  short: number
  maint: number
  thin?: boolean
  overdue?: number
}) {
  const avail = Math.max(0, total - long - short - maint)
  const segs = [
    { n: long, color: 'var(--lend-long)', label: '長期借出' },
    { n: short, color: 'var(--lend-short)', label: '短期借出' },
    { n: maint, color: '#a1a1aa', label: '維修中' },
  ].filter(s => s.n > 0)
  return (
    <div
      className={`flex overflow-hidden rounded bg-[var(--lend-track)] ${thin ? 'h-[7px]' : 'h-3'}`}
      {...tipHandlers([`可借 ${avail} 台`, `${name}：共 ${total} 台的 ${pct(avail, total)}`])}
    >
      {segs.map((seg, i) => {
        const last = i === segs.length - 1 && avail === 0
        return (
          <div
            key={seg.label}
            className={`h-full flex-none hover:brightness-110 ${last ? '' : 'border-r-2 border-white'}`}
            style={{ width: `${(100 * seg.n) / total}%`, background: seg.color }}
            {...tipHandlers([
              `${seg.label} ${seg.n} 台`,
              `${name}：共 ${total} 台的 ${pct(seg.n, total)}`,
              ...(seg.label === '短期借出' && overdue ? [`其中 ${overdue} 台逾期未還`] : []),
            ])}
          />
        )
      })}
    </div>
  )
}

export function DistCard({ dist, nowPeriod }: { dist: DistRow[]; nowPeriod: string | null }) {
  const sum = (k: 'total' | 'long' | 'short' | 'maint') => dist.reduce((a, t) => a + t[k], 0)
  const hasMaint = dist.some(t => t.maint > 0)
  const num = (v: number, cls = '') => (
    <td className={`whitespace-nowrap px-2.5 text-right tabular-nums ${cls}`}>{v === 0 ? '–' : v}</td>
  )
  const total = { name: '全校合計', total: sum('total'), long: sum('long'), short: sum('short'), maint: sum('maint') }
  return (
    <div className="card !p-0 lg:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="font-medium text-zinc-900">設備分布</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            此刻{nowPeriod ? `（${periodLabel(nowPeriod)}）` : ''}每種設備在哪裡：長期借出、短期借出，剩下的就是可借
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-600">
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-long)" />長期借出</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-short)" />短期借出</span>
          {hasMaint && <span className="inline-flex items-center gap-1.5"><Swatch color="#a1a1aa" />維修中</span>}
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--lend-track)" outlined />可借</span>
        </div>
      </div>
      <div className="overflow-x-auto px-5 pb-4 pt-3">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="whitespace-nowrap text-xs text-zinc-500">
              <th className="pb-2 pr-2.5 text-left font-medium">設備</th>
              <th className="pb-2 text-left font-medium">分布</th>
              <th className="hidden pb-2 pl-2.5 text-right font-medium sm:table-cell">長借</th>
              <th className="hidden pb-2 pl-2.5 text-right font-medium sm:table-cell">短借</th>
              {hasMaint && <th className="hidden pb-2 pl-2.5 text-right font-medium sm:table-cell">維修</th>}
              <th className="pb-2 pl-2.5 text-right font-medium">可借</th>
              <th className="hidden pb-2 pl-2.5 text-right font-medium sm:table-cell">合計</th>
            </tr>
          </thead>
          <tbody>
            {dist.map(t => {
              const rows = [
                <tr key={t.name} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap py-2.5 pr-2.5 text-zinc-800">{t.name}</td>
                  <td className="w-full min-w-[140px] py-2.5">
                    <DistBar name={t.name} total={t.total} long={t.long} short={t.short} maint={t.maint} overdue={t.overdue} />
                  </td>
                  {num(t.long, 'hidden sm:table-cell')}
                  {num(t.short, 'hidden sm:table-cell')}
                  {hasMaint && num(t.maint, 'hidden sm:table-cell')}
                  <td className="whitespace-nowrap px-2.5 text-right font-semibold tabular-nums text-zinc-900">
                    {Math.max(0, t.total - t.long - t.short - t.maint)}
                  </td>
                  {num(t.total, 'hidden text-zinc-500 sm:table-cell')}
                </tr>,
              ]
              for (const c of t.carts) {
                rows.push(
                  <tr key={c.id} className="text-xs text-zinc-500">
                    <td className="whitespace-nowrap py-1 pl-5 pr-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        {c.name}
                        {c.overdue > 0 && <StatusChip sev="critical" icon="alert">逾期 {c.overdue}</StatusChip>}
                      </span>
                    </td>
                    <td className="py-1">
                      <DistBar name={c.name} total={c.total} long={c.long} short={c.short} maint={c.maint} overdue={c.overdue} thin />
                    </td>
                    {num(c.long, 'hidden sm:table-cell')}
                    {num(c.short, 'hidden sm:table-cell')}
                    {hasMaint && num(c.maint, 'hidden sm:table-cell')}
                    <td className="whitespace-nowrap px-2.5 text-right tabular-nums text-zinc-600">
                      {Math.max(0, c.total - c.long - c.short - c.maint)}
                    </td>
                    {num(c.total, 'hidden sm:table-cell')}
                  </tr>
                )
              }
              return rows
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-300 font-medium">
              <td className="whitespace-nowrap py-2.5 pr-2.5 text-zinc-900">{total.name}</td>
              <td className="py-2.5">
                <DistBar name={total.name} total={total.total} long={total.long} short={total.short} maint={total.maint} />
              </td>
              {num(total.long, 'hidden sm:table-cell')}
              {num(total.short, 'hidden sm:table-cell')}
              {hasMaint && num(total.maint, 'hidden sm:table-cell')}
              <td className="whitespace-nowrap px-2.5 text-right tabular-nums text-zinc-900">
                {Math.max(0, total.total - total.long - total.short - total.maint)}
              </td>
              {num(total.total, 'hidden text-zinc-500 sm:table-cell')}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
