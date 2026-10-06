'use client'

// 協助借用 › 短期借用：管理者代老師預約（可每週重複）。
// 先選時間，設備卡片直接顯示那段時間可借幾台；建立後為「已預約」，老師照常辦借用、歸還手續。

import { useEffect, useMemo, useState } from 'react'
import { EQUIPMENT_PERIODS, addDays, currentPeriod, periodLabel, todayStr } from '@/lib/equipment'
import type { TeacherOption } from './LendingTabs'
import { PeriodPicker, ResourceCard, dateLabel, dateRangeLabel, unitRangeText, type Resource } from './lend-ui'

interface Occurrence { start: string; end: string }
interface Created { id: string; text: string; cancelled?: boolean }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function Step({ n }: { n: number }) {
  return (
    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 align-[1px] text-xs font-medium text-white">
      {n}
    </span>
  )
}

export function AssistShortTab({
  teachers,
  openPeriods,
  runBusy,
  onFlash,
}: {
  teachers: TeacherOption[]
  openPeriods: string[]
  runBusy: (msg: string, fn: () => Promise<void>) => Promise<void>
  onFlash: (text: string) => void
}) {
  const today = todayStr()
  const periods = useMemo(
    () => EQUIPMENT_PERIODS.filter(p => openPeriods.includes(p.key)).map(p => ({ key: p.key as string, label: p.label as string })),
    [openPeriods]
  )
  const [teacherText, setTeacherText] = useState('')
  const [date, setDate] = useState(today)
  const [multi, setMulti] = useState(false)
  const [endDate, setEndDate] = useState(today)
  const [range, setRange] = useState<{ s: number; e: number } | null>(null)
  const [repeat, setRepeat] = useState(false)
  const [until, setUntil] = useState('')
  const [resKey, setResKey] = useState('')
  const [qty, setQty] = useState(1)
  const [qtyText, setQtyText] = useState('1')
  const [results, setResults] = useState<{ start: string; end: string; resources: Resource[] }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [excluded, setExcluded] = useState<string[]>([])
  const [created, setCreated] = useState<Created[]>([])
  const [reloadKey, setReloadKey] = useState(0)

  const teacher = teachers.find(t => t.name === teacherText.trim()) ?? null
  const lastDate = multi && endDate > date ? endDate : date
  const span = Math.round((Date.parse(lastDate) - Date.parse(date)) / 86400000)
  const nowKey = currentPeriod(openPeriods)
  const minIndexOn = (d: string) => (d === today && nowKey ? Math.max(0, periods.findIndex(p => p.key === nowKey)) : 0)
  const minIndex = minIndexOn(date)
  const startKey = range ? periods[range.s]?.key ?? '' : ''
  const endKey = range ? periods[range.e]?.key ?? '' : ''
  const periodText = range
    ? range.s === range.e ? periods[range.s].label : `${periodLabel(startKey)}–${periodLabel(endKey)}`
    : ''

  // 每週重複：同週幾同節次直到截止日（最多 30 週）；單次跨日不可達 7 天，否則各週會互相重疊
  const occurrences = useMemo<Occurrence[]>(() => {
    if (!startKey || !endKey) return []
    if (!repeat) return [{ start: date, end: lastDate }]
    if (!until || until < date || span > 6) return []
    const list: Occurrence[] = []
    for (let k = 0; k < 30; k++) {
      const start = addDays(date, 7 * k)
      if (start > until) break
      list.push({ start, end: addDays(lastDate, 7 * k) })
    }
    return list
  }, [startKey, endKey, repeat, date, lastDate, until, span])
  const occKey = occurrences.map(o => `${o.start}~${o.end}`).join(',')

  useEffect(() => {
    if (!occKey) {
      setResults(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/equipment-availability', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            occurrences: occKey.split(',').map(x => {
              const [start_date, end_date] = x.split('~')
              return { start_date, end_date }
            }),
            start_period: startKey,
            end_period: endKey,
          }),
        })
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(json.error ?? '查詢可借狀態失敗')
          setResults(null)
        } else {
          setError('')
          setResults(json.results)
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
  }, [occKey, startKey, endKey, reloadKey])

  const resources = results?.[0]?.resources ?? []
  const res = resources.find(r => r.key === resKey) ?? null
  const freeIn = (i: number) => results?.[i]?.resources.find(r => r.key === resKey)?.free ?? []

  // 單台設備每週重複：挑在最多週都有空的那一台（同數取編號小的）
  const typeUnit = useMemo(() => {
    if (!res || res.kind !== 'type' || !results) return null
    const count = new Map<string, { asset: string; n: number }>()
    for (const r of results) {
      for (const u of r.resources.find(x => x.key === res.key)?.free ?? []) {
        const c = count.get(u.id) ?? { asset: u.asset, n: 0 }
        c.n++
        count.set(u.id, c)
      }
    }
    let best: { id: string; asset: string } | null = null
    let bestN = 0
    for (const [id, c] of Array.from(count)) {
      if (c.n > bestN) {
        best = { id, asset: c.asset }
        bestN = c.n
      }
    }
    return best
  }, [res, results])

  const occOk = (i: number) =>
    res?.kind === 'group' ? freeIn(i).length >= qty : typeUnit ? freeIn(i).some(u => u.id === typeUnit.id) : false
  const picked = occurrences.filter((o, i) => occOk(i) && !excluded.includes(o.start))
  const maxQty = res?.free.length ?? 0
  const canCreate = Boolean(teacher && range && res && picked.length > 0 &&
    (res.kind === 'type' ? typeUnit : qty >= 1 && qty <= maxQty))

  const chooseResource = (r: Resource) => {
    if (r.free.length === 0) return
    const n = r.kind === 'group' ? r.free.length : 1
    setResKey(r.key)
    setQty(n)
    setQtyText(String(n))
    setExcluded([])
  }
  const applyQty = (n: number) => {
    const v = Math.min(Math.max(1, Number.isFinite(n) ? n : 1), Math.max(1, maxQty))
    setQty(v)
    setQtyText(String(v))
  }

  const create = async () => {
    if (!teacher || !res || !range) return
    const what = res.kind === 'group'
      ? `${res.name} ${qty === res.total ? '整組' : `${qty} 台`}`
      : `${res.name} #${typeUnit?.asset ?? ''}`
    await runBusy(picked.length > 1 ? `建立 ${picked.length} 筆預約中…` : '建立預約中…', async () => {
      const r = await fetch('/api/admin/equipment-loans', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          teacher_id: teacher.id,
          start_period: startKey,
          end_period: endKey,
          occurrences: picked.map(o => ({ start_date: o.start, end_date: o.end })),
          ...(res.kind === 'group' ? { group_id: res.groupId, quantity: qty } : { equipment_id: typeUnit?.id }),
        }),
      })
      const json = await r.json()
      if (!r.ok) {
        alert(json.error ?? '建立失敗')
        setReloadKey(k => k + 1)
        return
      }
      const failed: { start_date: string; error: string }[] = json.failed ?? []
      const failedStarts = new Set(failed.map(f => f.start_date))
      const okOccs = picked.filter(o => !failedStarts.has(o.start))
      const ids: string[] = json.ids ?? []
      setCreated(list => [
        ...ids.map((id, i) => ({
          id,
          text: `${teacher.name}｜${what}｜${dateRangeLabel(okOccs[i]?.start ?? date, okOccs[i]?.end ?? lastDate)} ${periodText}`,
        })),
        ...list,
      ].slice(0, 40))
      onFlash(`已為 ${teacher.name} 建立 ${json.created} 筆預約`)
      if (failed.length > 0) {
        alert(`有 ${failed.length} 筆沒有建立：\n${failed.map(f => `${f.start_date}：${f.error}`).join('\n')}`)
      }
      setResKey('')
      setExcluded([])
      setReloadKey(k => k + 1)
    })
  }

  const cancelCreated = async (c: Created) => {
    if (!confirm('確定取消這筆預約？時段會立即釋出。')) return
    await runBusy('取消預約中…', async () => {
      const r = await fetch('/api/admin/equipment-loans', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: c.id, action: 'release' }),
      })
      const json = await r.json()
      if (!r.ok) {
        alert(json.error ?? '取消失敗')
        return
      }
      setCreated(list => list.map(x => (x.id === c.id ? { ...x, cancelled: true } : x)))
      onFlash('已取消預約')
      setReloadKey(k => k + 1)
    })
  }

  const summary: [string, string][] = [
    ['借用老師', teacher ? teacher.name : teacherText.trim() ? `「${teacherText.trim()}」不在名單中` : ''],
    ['時間', range ? `${dateRangeLabel(date, lastDate)}　${periodText}` : ''],
    ['重複', repeat ? (until ? `每週到 ${dateLabel(until)}，共 ${picked.length} 筆` : '請選擇重複到哪一天') : ''],
    ['設備', res ? `${res.name}　${res.kind === 'group' ? (qty === res.total ? `整組 ${qty} 台` : `${qty} 台`) : '1 台'}` : ''],
    ['配置編號', res ? (res.kind === 'group' ? unitRangeText(res.free.slice(0, qty)) : typeUnit ? `#${typeUnit.asset}` : '') : ''],
  ]

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <section className="card space-y-3 !p-5">
          <h2 className="font-medium text-zinc-900"><Step n={1} />借用老師</h2>
          <input
            className="input sm:!w-72"
            list="assist-teacher-list"
            placeholder="輸入姓名搜尋"
            autoComplete="off"
            value={teacherText}
            onChange={e => setTeacherText(e.target.value)}
          />
          <datalist id="assist-teacher-list">
            {teachers.map(t => <option key={t.id} value={t.name} />)}
          </datalist>
        </section>

        <section className="card space-y-3 !p-5">
          <h2 className="font-medium text-zinc-900"><Step n={2} />時間</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label">日期</span>
              <input
                type="date"
                className="input !w-44"
                min={today}
                value={date}
                onChange={e => {
                  const v = e.target.value
                  if (!v) return
                  setDate(v)
                  if (endDate < v) setEndDate(v)
                  if (range && range.s < minIndexOn(v)) setRange(null)
                }}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-zinc-700">
              <input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} />
              跨日借用
            </label>
            {multi && (
              <div>
                <span className="label">結束日期</span>
                <input
                  type="date"
                  className="input !w-44"
                  min={date}
                  value={endDate}
                  onChange={e => e.target.value && setEndDate(e.target.value)}
                />
              </div>
            )}
          </div>
          <div>
            <span className="label">節次</span>
            <PeriodPicker
              periods={periods}
              start={range?.s ?? null}
              end={range?.e ?? null}
              minIndex={minIndex}
              onChange={(s, e) => setRange({ s, e })}
            />
            <p className="mt-1.5 text-xs text-zinc-500">
              點一下選開始節次、再點結束節次；只借一節點一下即可。
              {multi && '跨日時首日從開始節次起、末日到結束節次止。'}
            </p>
          </div>
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} />
              每週重複（同週幾、同節次，如固定的課程）
            </label>
            {repeat && (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <span className="label">重複到（含當週）</span>
                  <input
                    type="date"
                    className="input !w-44"
                    min={lastDate}
                    value={until}
                    onChange={e => setUntil(e.target.value)}
                  />
                </div>
                {span > 6 && <p className="pb-2 text-xs text-red-600">每週重複的單次借用不可跨 7 天以上</p>}
              </div>
            )}
          </div>
        </section>

        <section className="card space-y-3 !p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium text-zinc-900"><Step n={3} />設備</h2>
            {results && (
              <p className="text-xs text-zinc-500">
                {dateRangeLabel(date, lastDate)} {periodText} 的可借台數{repeat && occurrences.length > 1 ? '（以第一週為準）' : ''}
              </p>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!results ? (
            <p className="text-sm text-zinc-500">
              {loading ? '查詢可借狀態中…' : '選好時間後，會列出每台車、每種設備那段時間還能借幾台。'}
            </p>
          ) : (
            <div className={`grid grid-cols-1 gap-2 transition-opacity sm:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
              {resources.map(r => (
                <ResourceCard
                  key={r.key}
                  r={r}
                  selected={r.key === resKey}
                  hint={r.kind === 'group' ? '可選台數' : '一次一台'}
                  onClick={() => chooseResource(r)}
                />
              ))}
            </div>
          )}

          {res?.kind === 'group' && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="mr-1 text-sm font-medium text-zinc-700">台數</span>
              <button className="btn-secondary !px-3 !py-1 text-xs" aria-label="減一台" onClick={() => applyQty(qty - 1)}>−</button>
              <input
                className="input !w-16 text-center tabular-nums"
                inputMode="numeric"
                aria-label="台數"
                value={qtyText}
                onChange={e => setQtyText(e.target.value)}
                onBlur={() => applyQty(parseInt(qtyText, 10))}
              />
              <button className="btn-secondary !px-3 !py-1 text-xs" aria-label="加一台" onClick={() => applyQty(qty + 1)}>＋</button>
              <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => applyQty(maxQty)}>全部可借</button>
              <span className="text-xs text-zinc-500">系統自動配編號最小的台數</span>
            </div>
          )}

          {repeat && res && results && occurrences.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-700">每週場次</span>
                <span className="text-xs text-zinc-500">將建立 {picked.length} 筆（共 {occurrences.length} 週）；取消勾選可略過，如段考週</span>
              </div>
              {occurrences.map((o, i) => {
                const ok = occOk(i)
                const on = ok && !excluded.includes(o.start)
                return (
                  <label
                    key={o.start}
                    className={`flex items-center gap-2 rounded border px-3 py-1.5 text-sm ${
                      ok ? 'cursor-pointer border-zinc-200' : 'border-red-200 bg-red-50 text-red-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!ok}
                      checked={on}
                      onChange={() => setExcluded(x => (x.includes(o.start) ? x.filter(d => d !== o.start) : [...x, o.start]))}
                    />
                    <span className="flex-1">{dateRangeLabel(o.start, o.end)}</span>
                    <span className="text-xs tabular-nums">
                      {res.kind === 'group' ? `剩 ${freeIn(i).length} 台` : ok ? '可借' : '這台該時段已被借用'}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <section className="card space-y-3 !p-5">
          <h2 className="font-medium text-zinc-900">預約摘要</h2>
          <dl className="space-y-2 text-sm">
            {summary.filter(([k, v]) => k !== '重複' || v).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                <dt className="text-zinc-500">{k}</dt>
                <dd className={v ? 'text-zinc-900' : 'text-zinc-400'}>{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <button className="btn-primary w-full" disabled={!canCreate} onClick={create}>
            {picked.length > 1 ? `建立 ${picked.length} 筆預約` : '建立預約'}
          </button>
          <p className="text-xs text-zinc-500">
            建立後為「已預約」，老師要在當天到借用頁按「開始借用」並完成檢查。不受教師端可預借天數限制。
          </p>
        </section>
        {created.length > 0 && (
          <section className="card space-y-1 !p-5">
            <h2 className="text-sm font-medium text-zinc-900">剛剛建立的預約</h2>
            <ul className="divide-y divide-zinc-100 text-sm">
              {created.map(c => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className={c.cancelled ? 'text-zinc-400 line-through' : 'text-zinc-800'}>{c.text}</span>
                  {!c.cancelled && (
                    <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => cancelCreated(c)}>取消</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  )
}
