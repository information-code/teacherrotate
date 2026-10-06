'use client'

// 借用總覽 › 今日總覽：指標、需處理、設備課表、此刻設備分布、長期借用摘要。
// 資料來自 /api/admin/equipment-board（一次回傳）；換日期只影響設備課表。

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { addDays, periodLabel } from '@/lib/equipment'
import {
  FitLabel,
  HoverTip,
  ICONS,
  StatusChip,
  Swatch,
  dateLabel,
  tipHandlers,
  type IconName,
  type Severity,
} from './lend-ui'

type MessageVars = { teacher: string; equipment: string; date: string; periods: string }
type ItemStatus = 'out' | 'resv' | 'done' | 'noshow' | 'overdue' | 'held'

interface BoardItem {
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
interface BoardRow { key: string; kind: 'group' | 'type'; name: string; sub: string; total: number }
type Alert =
  | { kind: 'overdue'; loanId: string; who: string; label: string; time: string; days: number; affected: number; vars: MessageVars }
  | { kind: 'noshow'; loanId: string; who: string; label: string; time: string; days: number; vars: MessageVars }
  | { kind: 'longOverdue'; loanId: string; who: string; label: string; time: string; days: number }
  | { kind: 'blocked'; teacherId: string; who: string; count: number; limit: number }
interface DistRow {
  name: string
  total: number
  long: number
  short: number
  maint: number
  overdue: number
  held: number
  carts: { id: string; name: string; total: number; long: number; short: number; maint: number; overdue: number }[]
}
interface BoardData {
  date: string
  today: string
  nowPeriod: string | null
  openPeriods: string[]
  kpi: {
    today: { total: number; out: number; resv: number; done: number; noshow: number }
    outNow: number
    overdueNow: number
    heldNow: number
    long: { total: number; internal: number; external: number; overdue: number }
  }
  alerts: Alert[]
  board: { rows: BoardRow[]; items: BoardItem[]; idleTypes: string[] }
  dist: DistRow[]
  long: {
    byType: { name: string; count: number; typeTotal: number }[]
    wave: { due: string; pending: number; renewed: number; opensOn: string; daysToOpen: number; daysToDue: number } | null
  }
}

const pct = (n: number, total: number) => `${total > 0 ? Math.round((100 * n) / total) : 0}%`

export function TodayDashboard({
  onCopyOverdue,
  onCopyPickup,
  runBusy,
  onFlash,
}: {
  onCopyOverdue: (vars: MessageVars) => Promise<void>
  onCopyPickup: (vars: MessageVars) => Promise<void>
  runBusy: (msg: string, fn: () => Promise<void>) => Promise<void>
  onFlash: (text: string) => void
}) {
  const [date, setDate] = useState('')
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/equipment-board${date ? `?date=${date}` : ''}`)
      .then(async res => {
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) setError(json.error ?? '載入失敗')
        else {
          setError('')
          setData(json)
        }
      })
      .catch(() => { if (!cancelled) setError('載入失敗，請重新整理。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, reloadKey])
  const reload = () => setReloadKey(k => k + 1)

  if (!data) {
    return (
      <div className="card">
        <p className={`text-sm ${error ? 'text-red-600' : 'text-zinc-500'}`}>{error || '載入中…'}</p>
      </div>
    )
  }

  const patchLoan = async (id: string, action: 'release' | 'close', confirmText: string, doneText: string) => {
    if (!confirm(confirmText)) return
    await runBusy(action === 'release' ? '取消預約中…' : '結案中…', async () => {
      const res = await fetch('/api/admin/equipment-loans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      const json = await res.json()
      if (!res.ok) alert(json.error ?? '操作失敗')
      else onFlash(doneText)
      reload()
    })
  }
  const resetNoShow = async (teacherId: string, who: string) => {
    if (!confirm(`確定將 ${who} 的「預約未借」次數歸零？歸零後老師即可恢復自行預約。`)) return
    await runBusy('歸零中…', async () => {
      const res = await fetch('/api/admin/equipment-no-show', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacher_id: teacherId }),
      })
      if (!res.ok) alert((await res.json()).error ?? '操作失敗')
      else onFlash(`已將 ${who} 的預約未借次數歸零`)
      reload()
    })
  }

  return (
    <div className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <KpiRow data={data} />
      <AlertsCard
        alerts={data.alerts}
        onCopyOverdue={onCopyOverdue}
        onCopyPickup={onCopyPickup}
        onPatch={patchLoan}
        onReset={resetNoShow}
      />
      <BoardCard data={data} onDate={setDate} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <DistCard dist={data.dist} nowPeriod={data.nowPeriod} />
        <LongCard data={data} />
      </div>
      <HoverTip />
    </div>
  )
}

// ---------- 指標 ----------

function Kpi({ label, value, unit, children, onClick }: {
  label: string
  value: number
  unit: string
  children: ReactNode
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-zinc-900">{value}</span>
        <span className="text-sm text-zinc-500">{unit}</span>
      </div>
      <div className="mt-1 text-xs text-zinc-500">{children}</div>
    </>
  )
  return onClick ? (
    <button type="button" className="card !p-4 text-left transition-colors hover:border-zinc-400" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="card !p-4">{body}</div>
  )
}

const ALERT_KIND: Record<Alert['kind'], { sev: Severity; icon: IconName; tag: string }> = {
  overdue: { sev: 'critical', icon: 'alert', tag: '逾期未還' },
  noshow: { sev: 'serious', icon: 'clock', tag: '預約未借' },
  longOverdue: { sev: 'serious', icon: 'renew', tag: '長借逾期' },
  blocked: { sev: 'warning', icon: 'lock', tag: '暫停預約' },
}

function KpiRow({ data }: { data: BoardData }) {
  const t = data.kpi.today
  const todayParts = [
    t.out && `借用中 ${t.out}`, t.resv && `預約 ${t.resv}`, t.done && `已還 ${t.done}`, t.noshow && `未取 ${t.noshow}`,
  ].filter(Boolean)
  const outParts = [
    data.kpi.overdueNow && `含逾期未還 ${data.kpi.overdueNow} 台`, data.kpi.heldNow && `活動保留 ${data.kpi.heldNow} 台`,
  ].filter(Boolean)
  const counts = new Map<Alert['kind'], number>()
  for (const a of data.alerts) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="今日短期借用" value={t.total} unit="筆">
        {todayParts.length > 0 ? todayParts.join(' · ') : '今天沒有短期借用'}
      </Kpi>
      <Kpi label="此刻借出" value={data.kpi.outNow} unit="台">
        {outParts.length > 0 ? outParts.join(' · ') : '短期借用與活動保留'}
      </Kpi>
      <Kpi label="長期借出" value={data.kpi.long.total} unit="台">
        校內 {data.kpi.long.internal} · 系統外 {data.kpi.long.external}
        {data.kpi.long.overdue > 0 && ` · 逾期 ${data.kpi.long.overdue}`}
      </Kpi>
      <Kpi
        label="需處理"
        value={data.alerts.length}
        unit="件"
        onClick={() => document.getElementById('lend-alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        {data.alerts.length === 0 ? (
          '沒有待處理事項'
        ) : (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {Array.from(counts).map(([kind, n]) => (
              <StatusChip key={kind} sev={ALERT_KIND[kind].sev} icon={ALERT_KIND[kind].icon}>
                {ALERT_KIND[kind].tag} {n}
              </StatusChip>
            ))}
          </span>
        )}
      </Kpi>
    </div>
  )
}

// ---------- 需處理 ----------

function AlertsCard({ alerts, onCopyOverdue, onCopyPickup, onPatch, onReset }: {
  alerts: Alert[]
  onCopyOverdue: (vars: MessageVars) => Promise<void>
  onCopyPickup: (vars: MessageVars) => Promise<void>
  onPatch: (id: string, action: 'release' | 'close', confirmText: string, doneText: string) => Promise<void>
  onReset: (teacherId: string, who: string) => Promise<void>
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? alerts : alerts.slice(0, 5)
  const btn = 'btn-secondary !px-2.5 !py-1 text-xs'

  return (
    <div id="lend-alerts" className="card scroll-mt-4 !p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-5 py-4">
        <h2 className="font-medium text-zinc-900">
          需處理 <span className="ml-1 text-sm font-normal text-zinc-500">{alerts.length} 件</span>
        </h2>
        <p className="text-xs text-zinc-500">依嚴重程度排序；結案、取消或歸零後自動移出清單</p>
      </div>
      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-zinc-500">
          <StatusChip sev="good" icon="check">一切正常</StatusChip>
          目前沒有需要處理的事項
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {visible.map(a => {
            const kind = ALERT_KIND[a.kind]
            const age =
              a.kind === 'blocked' ? `${a.count} / ${a.limit} 次`
                : a.kind === 'noshow' ? (a.days === 0 ? '今天' : `${a.days} 天前`)
                  : `${a.days} 天`
            return (
              <li
                key={a.kind === 'blocked' ? `b:${a.teacherId}` : `${a.kind}:${a.loanId}`}
                className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-5 py-3 sm:grid-cols-[150px_minmax(0,1fr)_auto]"
              >
                <div className="flex items-center gap-x-2 gap-y-1 sm:flex-col sm:items-start">
                  <StatusChip sev={kind.sev} icon={kind.icon}>{kind.tag}</StatusChip>
                  <span className="text-xs tabular-nums text-zinc-500">{age}</span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-zinc-900">
                    <span className="font-medium">{a.who}</span>
                    {a.kind !== 'blocked' && <>　{a.label}</>}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {a.kind === 'blocked'
                      ? '預約未借已達上限，目前無法自行預約；老師來找你時按「歸零」即可恢復'
                      : a.kind === 'overdue'
                        ? <>{a.time}{a.affected > 0 && ` · 這批設備後面還有 ${a.affected} 筆預約，不還會拿不到`}</>
                        : a.time}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {a.kind === 'overdue' && (
                    <>
                      <button className={btn} onClick={() => onCopyOverdue(a.vars)}>複製催還</button>
                      <button
                        className={btn}
                        onClick={() => onPatch(a.loanId, 'close',
                          `確定將 ${a.who} 借用的「${a.label}」代為結案？會視同已歸還並釋出設備。`, '已代為結案')}
                      >
                        代為結案
                      </button>
                    </>
                  )}
                  {a.kind === 'noshow' && (
                    <>
                      <button className={btn} onClick={() => onCopyPickup(a.vars)}>複製提醒</button>
                      <button
                        className={btn}
                        onClick={() => onPatch(a.loanId, 'release',
                          `確定取消 ${a.who} 對「${a.label}」的預約？${a.days > 0 ? '會記一次「預約未借」。' : '時段會立即釋出。'}`,
                          '已取消預約')}
                      >
                        取消預約
                      </button>
                    </>
                  )}
                  {a.kind === 'longOverdue' && (
                    <Link className={btn} href="/admin/equipment-lend?tab=long">到長期借用處理</Link>
                  )}
                  {a.kind === 'blocked' && (
                    <button className={btn} onClick={() => onReset(a.teacherId, a.who)}>歸零</button>
                  )}
                </div>
              </li>
            )
          })}
          {!showAll && alerts.length > 5 && (
            <li className="px-5 py-2.5">
              <button
                className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                onClick={() => setShowAll(true)}
              >
                顯示其餘 {alerts.length - 5} 件
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

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

function BoardCard({ data, onDate }: { data: BoardData; onDate: (date: string) => void }) {
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

      <div className="overflow-x-auto px-5 pb-2 pt-3">
        <div className="grid" style={{ gridTemplateColumns: '172px minmax(0, 1fr)', minWidth: 172 + order.length * 62 }}>
          <div />
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
                <div className="border-t border-zinc-200 py-2.5 pr-3 text-[13px] leading-snug text-zinc-800">
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

function DistCard({ dist, nowPeriod }: { dist: DistRow[]; nowPeriod: string | null }) {
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

// ---------- 長期借用摘要 ----------

function LongCard({ data }: { data: BoardData }) {
  const long = data.kpi.long
  const max = Math.max(1, ...data.long.byType.map(t => t.count))
  const wave = data.long.wave
  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-5 py-4">
        <h2 className="font-medium text-zinc-900">長期借用</h2>
        <Link href="/admin/equipment-lend?tab=long" className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900">
          管理 →
        </Link>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-semibold text-zinc-900">{long.total}</span>
            <span className="text-sm text-zinc-500">台借出中</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            校內教師 {long.internal} · 系統外人員 {long.external} · 逾期 {long.overdue}
          </div>
        </div>
        {data.long.byType.length > 0 && (
          <div className="space-y-2.5">
            {data.long.byType.map(t => (
              <div key={t.name} {...tipHandlers([`${t.count} 台`, `${t.name}：全校 ${t.typeTotal} 台的 ${pct(t.count, t.typeTotal)}`])}>
                <div className="mb-1 flex justify-between text-xs text-zinc-600">
                  <span>{t.name}</span>
                  <span className="tabular-nums text-zinc-900">{t.count}</span>
                </div>
                <div className="h-2.5 rounded-r bg-[var(--lend-long)]" style={{ width: `${(100 * t.count) / max}%` }} />
              </div>
            ))}
          </div>
        )}
        {wave && (
          <div className="space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3">
            <StatusChip sev="neutral" icon="renew">續借潮</StatusChip>
            <p className="text-sm text-zinc-800">
              <span className="font-semibold">{wave.pending + wave.renewed} 台</span>在 {dateLabel(wave.due)}到期
            </p>
            {wave.daysToOpen > 0 ? (
              <p className="text-xs text-zinc-500">
                {dateLabel(wave.opensOn)} 起老師可在借用頁回傳續借（還有 {wave.daysToOpen} 天）。開放後這裡顯示續借進度。
              </p>
            ) : (
              <div>
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>已續借（剩 {wave.daysToDue} 天到期）</span>
                  <span className="tabular-nums">{wave.renewed} / {wave.pending + wave.renewed}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--lend-track)]">
                  <div
                    className="h-full bg-[var(--lend-long)]"
                    style={{ width: pct(wave.renewed, wave.pending + wave.renewed) }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
