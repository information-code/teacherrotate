'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MonthCalendar, type CalendarCellItem } from '@/components/ui/MonthCalendar'
import { PageLoading } from '@/components/ui/PageLoading'
import {
  dashboardTodayStr, dateInRange, fmtDateLabel, monthGridDates,
  type Holiday, type SchoolEvent,
} from '@/lib/dashboard'

interface EventForm {
  id: string | null
  title: string
  description: string
  start_date: string
  end_date: string
}

interface HolidayForm {
  date: string
  name: string
  is_holiday: boolean
  isNew: boolean
}

export function CalendarAdminPage() {
  const today = dashboardTodayStr()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [events, setEvents] = useState<SchoolEvent[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [eventForm, setEventForm] = useState<EventForm | null>(null)
  const [holidayForm, setHolidayForm] = useState<HolidayForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const gridDates = useMemo(() => monthGridDates(year, month), [year, month])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // 格線可能橫跨兩個年度（12月／1月），假日需撈齊
      const years = Array.from(new Set([gridDates[0].slice(0, 4), gridDates[41].slice(0, 4)]))
      const [eventsRes, ...holidayRes] = await Promise.all([
        fetch(`/api/admin/school-events?start=${gridDates[0]}&end=${gridDates[41]}`),
        ...years.map(y => fetch(`/api/admin/holidays?year=${y}`)),
      ])
      const eventsJson = await eventsRes.json()
      if (!eventsRes.ok) throw new Error(eventsJson.error ?? '載入失敗')
      const holidayLists: Holiday[][] = []
      for (const res of holidayRes) {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '載入失敗')
        holidayLists.push(json)
      }
      setEvents(eventsJson)
      setHolidays(holidayLists.flat())
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗，請重新整理頁面。')
    } finally {
      setLoading(false)
    }
  }, [gridDates])

  useEffect(() => { load() }, [load])

  const itemsByDate = useMemo(() => {
    const map: Record<string, CalendarCellItem[]> = {}
    const push = (date: string, item: CalendarCellItem) => { (map[date] ??= []).push(item) }
    for (const h of holidays) {
      push(h.date, { key: `h-${h.date}`, label: h.name, kind: h.is_holiday ? 'holiday' : 'workday' })
    }
    for (const ev of events) {
      for (const date of gridDates) {
        if (dateInRange(date, ev.start_date, ev.end_date)) {
          push(date, { key: `e-${ev.id}-${date}`, label: ev.title, kind: 'event' })
        }
      }
    }
    return map
  }, [events, holidays, gridDates])

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  // ── 假日同步 ─────────────────────────────────────────
  async function syncHolidays() {
    if (syncing) return
    if (!confirm(`同步 ${year} 年的政府行政機關辦公日曆表？該年既有的同步資料會被覆蓋，手動新增的日期不受影響。`)) return
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '同步失敗，請再試一次。')
        return
      }
      alert(`已同步 ${year} 年假日，共 ${json.count} 筆。`)
      load()
    } finally {
      setSyncing(false)
    }
  }

  // ── 活動 CRUD ────────────────────────────────────────
  async function saveEvent() {
    if (!eventForm || saving) return
    if (!eventForm.title.trim()) { alert('請填寫活動名稱。'); return }
    if (eventForm.end_date < eventForm.start_date) { alert('結束日期不可早於開始日期。'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/school-events', {
        method: eventForm.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: eventForm.id ?? undefined,
          title: eventForm.title,
          description: eventForm.description,
          start_date: eventForm.start_date,
          end_date: eventForm.end_date,
        }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? '儲存失敗，請再試一次。'); return }
      setEventForm(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function removeEvent(ev: SchoolEvent) {
    if (!confirm(`刪除活動「${ev.title}」？`)) return
    const res = await fetch(`/api/admin/school-events?id=${ev.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      alert(json?.error ?? '刪除失敗，請再試一次。')
      return
    }
    load()
  }

  // ── 假日手動維護 ──────────────────────────────────────
  async function saveHoliday() {
    if (!holidayForm || saving) return
    if (!holidayForm.name.trim()) { alert('請填寫名稱。'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/holidays', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: holidayForm.date,
          name: holidayForm.name,
          is_holiday: holidayForm.is_holiday,
        }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error ?? '儲存失敗，請再試一次。'); return }
      setHolidayForm(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function removeHoliday(h: Holiday) {
    if (!confirm(`移除 ${fmtDateLabel(h.date)}「${h.name}」？`)) return
    const res = await fetch(`/api/admin/holidays?date=${h.date}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      alert(json?.error ?? '刪除失敗，請再試一次。')
      return
    }
    load()
  }

  const dayEvents = events.filter(ev => dateInRange(selectedDate, ev.start_date, ev.end_date))
  const dayHolidays = holidays.filter(h => h.date === selectedDate)

  if (loading && events.length === 0 && holidays.length === 0 && !error) {
    return <div className="relative min-h-[50vh]"><PageLoading /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title !mb-0">行事曆管理</h2>
        <button className="btn-secondary" disabled={syncing} onClick={syncHolidays}>
          {syncing ? '同步中…' : `同步 ${year} 年假日`}
        </button>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 !p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button className="btn-secondary mt-2" onClick={load}>重新載入</button>
        </div>
      )}

      <div className="card !p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button className="btn-secondary !px-2.5 !py-1" onClick={() => moveMonth(-1)} aria-label="上個月">‹</button>
            <span className="min-w-[7.5rem] text-center text-sm font-semibold text-zinc-900">
              {year} 年 {month} 月
            </span>
            <button className="btn-secondary !px-2.5 !py-1" onClick={() => moveMonth(1)} aria-label="下個月">›</button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-sky-400" />學校活動</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-red-400" />假日</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-zinc-400" />補行上班</span>
          </div>
        </div>
        <MonthCalendar
          year={year}
          month={month}
          itemsByDate={itemsByDate}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />

        {/* 選定日期詳情與操作 */}
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-zinc-700">{fmtDateLabel(selectedDate)}</h4>
            <div className="flex gap-2">
              <button
                className="btn-secondary !px-2.5 !py-1 text-xs"
                onClick={() => setEventForm({
                  id: null, title: '', description: '',
                  start_date: selectedDate, end_date: selectedDate,
                })}
              >
                新增活動
              </button>
              <button
                className="btn-secondary !px-2.5 !py-1 text-xs"
                onClick={() => setHolidayForm({ date: selectedDate, name: '', is_holiday: true, isNew: true })}
              >
                新增假日／補班
              </button>
            </div>
          </div>
          <ul className="space-y-1.5">
            {dayHolidays.map(h => (
              <li key={h.date + h.name} className="flex items-center gap-2 text-sm">
                <span className={h.is_holiday ? 'h-2 w-2 flex-shrink-0 bg-red-400' : 'h-2 w-2 flex-shrink-0 bg-zinc-400'} />
                <span className={h.is_holiday ? 'flex-1 text-red-600' : 'flex-1 text-zinc-700'}>
                  {h.name}
                  <span className="ml-1.5 text-xs text-zinc-400">
                    {h.is_holiday ? '放假' : '補行上班'}・{h.source === 'sync' ? '同步' : '手動'}
                  </span>
                </span>
                <button
                  className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                  onClick={() => setHolidayForm({ date: h.date, name: h.name, is_holiday: h.is_holiday, isNew: false })}
                >
                  編輯
                </button>
                <button className="text-xs text-red-600 underline-offset-2 hover:underline" onClick={() => removeHoliday(h)}>
                  移除
                </button>
              </li>
            ))}
            {dayEvents.map(ev => (
              <li key={ev.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-2 w-2 flex-shrink-0 bg-sky-400" />
                <span className="flex-1 text-zinc-800">
                  {ev.title}
                  {ev.start_date !== ev.end_date && (
                    <span className="ml-1 text-xs text-zinc-400">
                      {ev.start_date.slice(5).replace('-', '/')}～{ev.end_date.slice(5).replace('-', '/')}
                    </span>
                  )}
                  {ev.description && <span className="block text-xs text-zinc-500">{ev.description}</span>}
                </span>
                <button
                  className="text-xs text-zinc-500 underline-offset-2 hover:underline"
                  onClick={() => setEventForm({
                    id: ev.id, title: ev.title, description: ev.description,
                    start_date: ev.start_date, end_date: ev.end_date,
                  })}
                >
                  編輯
                </button>
                <button className="text-xs text-red-600 underline-offset-2 hover:underline" onClick={() => removeEvent(ev)}>
                  刪除
                </button>
              </li>
            ))}
            {dayHolidays.length === 0 && dayEvents.length === 0 && (
              <li className="text-sm text-zinc-400">這天沒有活動。</li>
            )}
          </ul>
        </div>
      </div>

      <p className="text-xs text-zinc-400">
        假日資料來源：行政院人事行政總處「政府行政機關辦公日曆表」。政府資料通常於前一年度下半年發布，
        若同步失敗請稍後再試，或用「新增假日／補班」手動補上（含校定假日、補假等）。
      </p>

      {eventForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEventForm(null)}>
          <div className="card w-full max-w-md !p-5" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-base font-semibold text-zinc-900">
              {eventForm.id ? '編輯活動' : '新增活動'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label">活動名稱 *</label>
                <input className="input" value={eventForm.title} maxLength={100}
                  onChange={e => setEventForm({ ...eventForm, title: e.target.value })} />
              </div>
              <div>
                <label className="label">說明（選填）</label>
                <textarea className="input min-h-[4rem]" value={eventForm.description}
                  onChange={e => setEventForm({ ...eventForm, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">開始日期</label>
                  <input type="date" className="input" value={eventForm.start_date}
                    onChange={e => setEventForm({ ...eventForm, start_date: e.target.value })} />
                </div>
                <div>
                  <label className="label">結束日期</label>
                  <input type="date" className="input" value={eventForm.end_date}
                    onChange={e => setEventForm({ ...eventForm, end_date: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEventForm(null)}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={saveEvent}>
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {holidayForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHolidayForm(null)}>
          <div className="card w-full max-w-md !p-5" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-base font-semibold text-zinc-900">
              {holidayForm.isNew ? '新增假日／補班' : '編輯假日／補班'}（{fmtDateLabel(holidayForm.date)}）
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label">名稱 *</label>
                <input className="input" placeholder="例：校慶補假、期末校務會議停課" value={holidayForm.name} maxLength={50}
                  onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })} />
              </div>
              <div>
                <label className="label">類型</label>
                <select
                  className="input"
                  value={holidayForm.is_holiday ? 'holiday' : 'workday'}
                  onChange={e => setHolidayForm({ ...holidayForm, is_holiday: e.target.value === 'holiday' })}
                >
                  <option value="holiday">放假日</option>
                  <option value="workday">補行上班日</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setHolidayForm(null)}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={saveHoliday}>
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
