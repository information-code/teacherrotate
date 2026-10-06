'use client'

// 協助借用 › 固定活動：資訊組為校內活動或事項保留設備（如校慶、研習）。
// 只選日期（整天），不需借用人，也不走預約、拍照、借用、歸還手續；建立即占用，取消即釋出。

import { useCallback, useEffect, useState } from 'react'
import { todayStr } from '@/lib/equipment'
import { ResourceCard, dateRangeLabel, type Resource } from '@/components/equipment/lend-ui'

interface Activity {
  id: string
  name: string
  start: string
  end: string
  state: 'ongoing' | 'upcoming' | 'past' | 'cancelled'
  items: { label: string; qty: number }[]
}

const STATE: Record<Activity['state'], { text: string; cls: string }> = {
  ongoing: { text: '進行中', cls: 'badge-success' },
  upcoming: { text: '即將開始', cls: 'badge-default' },
  past: { text: '已結束', cls: 'badge-default' },
  cancelled: { text: '已取消', cls: 'badge-default' },
}
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function ActivityTab({ runBusy, onFlash }: {
  runBusy: (msg: string, fn: () => Promise<void>) => Promise<void>
  onFlash: (text: string) => void
}) {
  const today = todayStr()
  const [name, setName] = useState('')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [resources, setResources] = useState<Resource[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [activities, setActivities] = useState<Activity[] | null>(null)
  const [listError, setListError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!start || !end || end < start) {
      setResources(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/equipment-availability', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ occurrences: [{ start_date: start, end_date: end }] }),
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error ?? '查詢可借狀態失敗')
          setResources(null)
        } else {
          setError('')
          setResources(json.results[0]?.resources ?? [])
        }
      } catch {
        if (!cancelled) setError('查詢可借狀態失敗，請再試一次。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [start, end, reloadKey])

  // 換日期後，已選台數不可超過新期間的可借數
  useEffect(() => {
    if (!resources) return
    setPicked(prev => {
      const next: Record<string, number> = {}
      for (const [key, q] of Object.entries(prev)) {
        const free = resources.find(r => r.key === key)?.free.length ?? 0
        if (free > 0) next[key] = Math.min(q, free)
      }
      return next
    })
  }, [resources])

  const loadActivities = useCallback(async () => {
    const res = await fetch('/api/admin/equipment-activities')
    const json = await res.json()
    if (!res.ok) setListError(json.error ?? '載入失敗')
    else {
      setListError('')
      setActivities(json.activities)
    }
  }, [])
  useEffect(() => { loadActivities() }, [loadActivities, reloadKey])

  const toggle = (r: Resource) => {
    if (r.free.length === 0 && !picked[r.key]) return
    setPicked(prev => {
      const next = { ...prev }
      if (next[r.key]) delete next[r.key]
      else next[r.key] = r.kind === 'group' ? r.free.length : 1
      return next
    })
  }
  const setQty = (key: string, q: number, max: number) =>
    setPicked(prev => ({ ...prev, [key]: Math.min(Math.max(1, q), max) }))

  const items = Object.entries(picked)
    .map(([key, qty]) => ({ key, qty, r: resources?.find(x => x.key === key) }))
    .filter((i): i is { key: string; qty: number; r: Resource } => Boolean(i.r))
  const totalUnits = items.reduce((a, i) => a + i.qty, 0)
  const canCreate = Boolean(name.trim()) && items.length > 0 && end >= start

  const create = async () => {
    const title = name.trim()
    await runBusy('建立固定活動中…', async () => {
      const res = await fetch('/api/admin/equipment-activities', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          name: title,
          start_date: start,
          end_date: end,
          items: items.map(i =>
            i.r.kind === 'group' ? { group_id: i.r.groupId, quantity: i.qty } : { type_name: i.r.name, quantity: i.qty }
          ),
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '建立失敗')
        setReloadKey(k => k + 1)
        return
      }
      onFlash(`已建立「${title}」，保留 ${totalUnits} 台設備`)
      setName('')
      setPicked({})
      setReloadKey(k => k + 1)
    })
  }

  const cancelActivity = async (a: Activity) => {
    if (!confirm(`確定取消「${a.name}」？保留的設備會立即釋出給老師借用。`)) return
    await runBusy('取消中…', async () => {
      const res = await fetch('/api/admin/equipment-activities', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: a.id, action: 'cancel' }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '取消失敗')
        return
      }
      onFlash(`已取消「${a.name}」`)
      setReloadKey(k => k + 1)
    })
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="card min-w-0 space-y-4 !p-5">
        <div>
          <h2 className="font-medium text-zinc-900">建立固定活動</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            為校內活動或事項保留設備，只選日期（整天）。不需借用人，也不走預約、拍照、借用、歸還手續；
            建立後這些設備在期間內整天保留，老師端會看到已借出。
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div>
            <span className="label">活動名稱或事項</span>
            <input
              className="input"
              maxLength={60}
              placeholder="例：校慶、教師研習、五年級戶外教學"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <span className="label">開始日期</span>
            <input
              type="date"
              className="input sm:!w-40"
              min={today}
              value={start}
              onChange={e => {
                const v = e.target.value
                if (!v) return
                setStart(v)
                if (end < v) setEnd(v)
              }}
            />
          </div>
          <div>
            <span className="label">結束日期</span>
            <input
              type="date"
              className="input sm:!w-40"
              min={start}
              value={end}
              onChange={e => e.target.value && setEnd(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-zinc-700">設備（可多選）</span>
            <span className="text-xs text-zinc-500">{dateRangeLabel(start, end)} 整天的可借台數</span>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {resources === null ? (
            <p className="text-sm text-zinc-500">{loading ? '查詢可借狀態中…' : '請選擇日期。'}</p>
          ) : (
            <div className={`grid grid-cols-1 gap-2 transition-opacity sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
              {resources.map(r => (
                <ResourceCard
                  key={r.key}
                  r={r}
                  selected={Boolean(picked[r.key])}
                  hint={r.kind === 'group' ? '可選台數' : '依編號配台'}
                  onClick={() => toggle(r)}
                />
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-sm font-medium text-zinc-900">
              保留清單 <span className="font-normal text-zinc-500">共 {totalUnits} 台</span>
            </div>
            {items.map(({ key, qty, r }) => (
              <div key={key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 text-zinc-800">{r.name}</span>
                <button className="btn-secondary !px-2.5 !py-1 text-xs" aria-label="減一台" onClick={() => setQty(key, qty - 1, r.free.length)}>−</button>
                <span className="w-10 text-center tabular-nums">{qty}</span>
                <button className="btn-secondary !px-2.5 !py-1 text-xs" aria-label="加一台" onClick={() => setQty(key, qty + 1, r.free.length)}>＋</button>
                <span className="w-12 text-xs tabular-nums text-zinc-500">/ {r.free.length}</span>
                <button className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-900" onClick={() => toggle(r)}>
                  移除
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="btn-primary" disabled={!canCreate} onClick={create}>建立固定活動</button>
      </section>

      <section className="card min-w-0 space-y-3 !p-5">
        <h2 className="font-medium text-zinc-900">固定活動</h2>
        {listError && <p className="text-sm text-red-600">{listError}</p>}
        {activities === null ? (
          !listError && <p className="text-sm text-zinc-400">載入中…</p>
        ) : activities.length === 0 ? (
          <p className="text-sm text-zinc-500">還沒有固定活動。</p>
        ) : (
          <ul className="space-y-2">
            {activities.map(a => (
              <li
                key={a.id}
                className={`space-y-1.5 rounded border border-zinc-200 p-3 ${a.state === 'past' || a.state === 'cancelled' ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900">{a.name}</span>
                  <span className={STATE[a.state].cls}>{STATE[a.state].text}</span>
                </div>
                <div className="text-xs text-zinc-600">{dateRangeLabel(a.start, a.end)} 整天</div>
                <div className="text-xs text-zinc-500">{a.items.map(i => `${i.label} ${i.qty} 台`).join('、')}</div>
                {(a.state === 'ongoing' || a.state === 'upcoming') && (
                  <div className="pt-1">
                    <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => cancelActivity(a)}>取消保留</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
