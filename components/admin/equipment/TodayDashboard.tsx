'use client'

// 借用總覽 › 今日總覽：指標、需處理、設備課表、此刻設備分布、長期借用摘要。
// 資料來自 /api/admin/equipment-board（一次回傳）；換日期只影響設備課表。

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { HoverTip, StatusChip, dateLabel, tipHandlers, type IconName, type Severity } from '@/components/equipment/lend-ui'
import { BoardCard, DistCard, pct, type BoardItem, type BoardRow, type DistRow } from '@/components/equipment/LendingBoard'

type MessageVars = { teacher: string; equipment: string; date: string; periods: string }
type Alert =
  | { kind: 'overdue'; loanId: string; who: string; label: string; time: string; days: number; affected: number; vars: MessageVars }
  | { kind: 'noshow'; loanId: string; who: string; label: string; time: string; days: number; vars: MessageVars }
  | { kind: 'longOverdue'; loanId: string; who: string; label: string; time: string; days: number }
  | { kind: 'blocked'; teacherId: string; who: string; count: number; limit: number }
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
