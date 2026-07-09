'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { MonthCalendar, type CalendarCellItem } from '@/components/ui/MonthCalendar'
import { PageLoading } from '@/components/ui/PageLoading'
import {
  dashboardTodayStr, dateInRange, fmtDateLabel, fmtTimeRange, monthGridDates,
  type Announcement, type Holiday, type PersonalEvent, type SchoolEvent, type Todo,
} from '@/lib/dashboard'

interface DashboardData {
  events: SchoolEvent[]
  holidays: Holiday[]
  personalEvents: PersonalEvent[]
  announcements: Announcement[]
  todos: Todo[]
}

/** 活動 modal 狀態：新增個人事項／檢視編輯個人事項／唯讀學校活動 */
type EventModalState =
  | { kind: 'create' }
  | { kind: 'personal'; event: PersonalEvent }
  | { kind: 'school'; event: SchoolEvent }

export function DashboardPage() {
  const today = dashboardTodayStr()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeAnnouncement, setActiveAnnouncement] = useState<Announcement | null>(null)
  const [eventModal, setEventModal] = useState<EventModalState | null>(null)

  const gridDates = useMemo(() => monthGridDates(year, month), [year, month])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/teacher/dashboard?start=${gridDates[0]}&end=${gridDates[41]}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '載入失敗')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗，請重新整理頁面。')
    } finally {
      setLoading(false)
    }
  }, [gridDates])

  useEffect(() => { load() }, [load])

  // 行事曆格子內容，排序：國定假日/補班最上 → 學校活動 → 整天個人事項 → 有時間的個人事項依時間序
  const itemsByDate = useMemo(() => {
    const map: Record<string, { item: CalendarCellItem; sortKey: string }[]> = {}
    if (!data) return {}
    const push = (date: string, sortKey: string, item: CalendarCellItem) => {
      (map[date] ??= []).push({ item, sortKey })
    }
    for (const h of data.holidays) {
      push(h.date, '0', { key: `h-${h.date}`, label: h.name, kind: h.is_holiday ? 'holiday' : 'workday' })
    }
    for (const ev of data.events) {
      for (const date of gridDates) {
        if (dateInRange(date, ev.start_date, ev.end_date)) {
          push(date, `1-${ev.start_date}`, { key: `e-${ev.id}-${date}`, label: ev.title, kind: 'event' })
        }
      }
    }
    for (const p of data.personalEvents) {
      push(p.date, p.start_time ? `3-${p.start_time}` : '2', {
        key: `p-${p.id}`,
        label: p.start_time ? `${p.start_time.slice(0, 5)} ${p.title}` : p.title,
        kind: 'personal',
      })
    }
    const sorted: Record<string, CalendarCellItem[]> = {}
    for (const [date, entries] of Object.entries(map)) {
      sorted[date] = entries
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map(e => e.item)
    }
    return sorted
  }, [data, gridDates])

  /** 月曆小籤點擊 → 依 key 前綴找回原始資料開啟詳情 */
  function openCalendarItem(item: { key: string }) {
    if (!data) return
    if (item.key.startsWith('p-')) {
      const ev = data.personalEvents.find(p => p.id === item.key.slice(2))
      if (ev) setEventModal({ kind: 'personal', event: ev })
    } else if (item.key.startsWith('e-')) {
      const id = item.key.slice(2, -11)  // 去掉 'e-' 前綴與 '-YYYY-MM-DD' 尾碼
      const ev = data.events.find(e => e.id === id)
      if (ev) setEventModal({ kind: 'school', event: ev })
    }
  }

  function moveMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  function goToday() {
    const d = new Date()
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
    setSelectedDate(today)
  }

  // ── 公告 ──────────────────────────────────────────────
  async function openAnnouncement(a: Announcement) {
    setActiveAnnouncement(a)
    if (!a.read) {
      setData(prev => prev && ({
        ...prev,
        announcements: prev.announcements.map(x => x.id === a.id ? { ...x, read: true } : x),
      }))
      await fetch('/api/teacher/announcement-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      })
    }
  }

  async function addAnnouncementTodo(a: Announcement) {
    const res = await fetch('/api/teacher/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: a.title, note: a.office, announcement_id: a.id }),
    })
    const json = await res.json()
    if (!res.ok) {
      alert(json.error ?? '加入失敗，請再試一次。')
      return
    }
    setData(prev => prev && ({ ...prev, todos: [...prev.todos, json] }))
    setActiveAnnouncement(null)
  }

  if (loading && !data) {
    return (
      <div className="relative min-h-[50vh]">
        <PageLoading />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="page-title !mb-0">工作首頁</h2>

      {error && (
        <div className="card border-red-200 bg-red-50 !p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button className="btn-secondary mt-2" onClick={load}>重新載入</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 右欄（手機優先顯示）：代辦事項 */}
        <div className="order-1 lg:order-2 lg:col-span-1">
          <TodoPanel
            todos={data?.todos ?? []}
            today={today}
            onChange={todos => setData(prev => prev && ({ ...prev, todos }))}
          />
        </div>

        {/* 左欄：行事曆＋公告 */}
        <div className="order-2 space-y-4 lg:order-1 lg:col-span-2">
          <div className="card !p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button className="btn-secondary !px-2.5 !py-1" onClick={() => moveMonth(-1)} aria-label="上個月">‹</button>
                <span className="min-w-[7.5rem] text-center text-sm font-semibold text-zinc-900">
                  {year} 年 {month} 月
                </span>
                <button className="btn-secondary !px-2.5 !py-1" onClick={() => moveMonth(1)} aria-label="下個月">›</button>
                <button className="btn-secondary !ml-1 !px-2.5 !py-1" onClick={goToday}>今天</button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 bg-sky-400" />學校活動</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 bg-red-400" />假日</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 bg-zinc-400" />補行上班</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 bg-amber-400" />個人</span>
                </div>
                <AddIconButton label="新增個人事項" onClick={() => setEventModal({ kind: 'create' })} />
              </div>
            </div>
            <MonthCalendar
              year={year}
              month={month}
              itemsByDate={itemsByDate}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onItemClick={openCalendarItem}
            />
            <DayDetail
              date={selectedDate}
              data={data}
              onChanged={load}
              onOpen={setEventModal}
            />
          </div>

          <AnnouncementPanel
            announcements={data?.announcements ?? []}
            onOpen={openAnnouncement}
          />
        </div>
      </div>

      {activeAnnouncement && (
        <AnnouncementModal
          announcement={activeAnnouncement}
          alreadyAdded={(data?.todos ?? []).some(t => t.announcement_id === activeAnnouncement.id)}
          onAddTodo={() => addAnnouncementTodo(activeAnnouncement)}
          onClose={() => setActiveAnnouncement(null)}
        />
      )}

      {eventModal && (
        <EventDetailModal
          state={eventModal}
          defaultDate={selectedDate}
          onClose={() => setEventModal(null)}
          onSaved={date => {
            setEventModal(null)
            setSelectedDate(date)
            load()
          }}
        />
      )}
    </div>
  )
}

/** 面板右上角的「＋」新增按鈕 */
function AddIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-secondary !p-1.5"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  )
}

// ── 活動詳情 modal ────────────────────────────────────────
// 個人事項：唯讀詳情 →「編輯」切換為表單（新增時直接是表單）。
// 學校活動：僅唯讀詳情。
function EventDetailModal({
  state,
  defaultDate,
  onClose,
  onSaved,
}: {
  state: EventModalState
  defaultDate: string
  onClose: () => void
  onSaved: (date: string) => void
}) {
  const personal = state.kind === 'personal' ? state.event : null
  const school = state.kind === 'school' ? state.event : null
  const [editing, setEditing] = useState(state.kind === 'create')
  const [date, setDate] = useState(personal?.date ?? defaultDate)
  const [allDay, setAllDay] = useState(!personal?.start_time)
  const [startTime, setStartTime] = useState(personal?.start_time?.slice(0, 5) ?? '')
  const [endTime, setEndTime] = useState(personal?.end_time?.slice(0, 5) ?? '')
  const [title, setTitle] = useState(personal?.title ?? '')
  const [note, setNote] = useState(personal?.note ?? '')
  const [saving, setSaving] = useState(false)

  const canSave = Boolean(title.trim() && date && (allDay || (startTime && endTime)))

  function resetToOriginal() {
    setDate(personal?.date ?? defaultDate)
    setAllDay(!personal?.start_time)
    setStartTime(personal?.start_time?.slice(0, 5) ?? '')
    setEndTime(personal?.end_time?.slice(0, 5) ?? '')
    setTitle(personal?.title ?? '')
    setNote(personal?.note ?? '')
  }

  async function save() {
    if (!canSave || saving) return
    if (!allDay && endTime <= startTime) {
      alert('結束時間須晚於開始時間。')
      return
    }
    setSaving(true)
    try {
      const payload = {
        id: personal?.id,
        date,
        title,
        note,
        start_time: allDay ? '' : startTime,
        end_time: allDay ? '' : endTime,
      }
      const res = await fetch('/api/teacher/personal-events', {
        method: personal ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '儲存失敗，請再試一次。')
        return
      }
      onSaved(date)
    } finally {
      setSaving(false)
    }
  }

  const heading = state.kind === 'create' ? '新增個人事項'
    : editing ? '編輯個人事項'
    : school ? '學校活動' : '個人事項'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md !p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5', school ? 'bg-sky-400' : 'bg-amber-400')} />
          <h3 className="text-base font-semibold text-zinc-900">{heading}</h3>
        </div>

        {!editing ? (
          /* 唯讀詳情（學校活動／個人事項） */
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-zinc-400">日期</dt>
              <dd className="text-zinc-800">
                {school
                  ? school.start_date === school.end_date
                    ? fmtDateLabel(school.start_date)
                    : `${fmtDateLabel(school.start_date)} ～ ${fmtDateLabel(school.end_date)}`
                  : fmtDateLabel(date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-400">時間</dt>
              <dd className="text-zinc-800">
                {school || allDay ? '整天' : fmtTimeRange(`${startTime}:00`, `${endTime}:00`)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-400">活動名稱</dt>
              <dd className="text-zinc-800">{school ? school.title : title}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-400">活動備註</dt>
              <dd className="whitespace-pre-wrap text-zinc-800">
                {(school ? school.description : note) || '—'}
              </dd>
            </div>
            {school && (school.office || school.publisher_title) && (
              <div>
                <dt className="text-xs font-medium text-zinc-400">發布單位</dt>
                <dd className="text-zinc-800">
                  {[school.office, school.publisher_title].filter(Boolean).join('・')}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          /* 表單（新增／編輯個人事項） */
          <div className="space-y-3">
            <div>
              <label className="label">日期</label>
              <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label">時間</label>
              <div className="flex items-center gap-2">
                <select
                  className="input !w-auto"
                  value={allDay ? 'allday' : 'timed'}
                  onChange={e => setAllDay(e.target.value === 'allday')}
                >
                  <option value="allday">整天</option>
                  <option value="timed">指定時間</option>
                </select>
                {!allDay && (
                  <>
                    <input type="time" className="input flex-1" value={startTime}
                      onChange={e => setStartTime(e.target.value)} aria-label="開始時間" />
                    <span className="text-zinc-400">–</span>
                    <input type="time" className="input flex-1" value={endTime}
                      onChange={e => setEndTime(e.target.value)} aria-label="結束時間" />
                  </>
                )}
              </div>
            </div>
            <div>
              <label className="label">活動名稱 *</label>
              <input
                className="input"
                value={title}
                maxLength={100}
                autoFocus={state.kind === 'create'}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save() }}
              />
            </div>
            <div>
              <label className="label">活動備註（選填）</label>
              <textarea className="input min-h-[4rem]" value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          {!editing && personal && (
            <button
              className="btn-danger mr-auto"
              disabled={saving}
              onClick={async () => {
                if (!confirm(`刪除「${personal.title}」？`)) return
                setSaving(true)
                const res = await fetch(`/api/teacher/personal-events?id=${personal.id}`, { method: 'DELETE' })
                setSaving(false)
                if (!res.ok) {
                  const json = await res.json().catch(() => null)
                  alert(json?.error ?? '刪除失敗，請再試一次。')
                  return
                }
                onSaved(date)
              }}
            >
              刪除
            </button>
          )}
          <span className="ml-auto flex gap-2">
          {!editing ? (
            <>
              <button className="btn-secondary" onClick={onClose}>關閉</button>
              {personal && (
                <button className="btn-primary" onClick={() => setEditing(true)}>編輯</button>
              )}
            </>
          ) : (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  if (state.kind === 'create') onClose()
                  else { resetToOriginal(); setEditing(false) }
                }}
              >
                取消
              </button>
              <button className="btn-primary" disabled={!canSave || saving} onClick={save}>
                {saving ? '儲存中…' : state.kind === 'create' ? '新增' : '儲存'}
              </button>
            </>
          )}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── 選定日期詳情 ─────────────────────────────────────────
function DayDetail({
  date,
  data,
  onChanged,
  onOpen,
}: {
  date: string
  data: DashboardData | null
  onChanged: () => void
  onOpen: (state: EventModalState) => void
}) {
  const holidays = (data?.holidays ?? []).filter(h => h.date === date)
  const events = (data?.events ?? []).filter(ev => dateInRange(date, ev.start_date, ev.end_date))
  const personals = (data?.personalEvents ?? []).filter(p => p.date === date)

  async function removePersonal(id: string) {
    if (!confirm('刪除這個個人事項？')) return
    const res = await fetch(`/api/teacher/personal-events?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      alert(json?.error ?? '刪除失敗，請再試一次。')
      return
    }
    onChanged()
  }

  // 這天沒有任何項目就整段不顯示；桌機一律隱藏（直接在月曆格子上操作），
  // 手機格子太窄只有圓點，保留點日期展開清單
  if (holidays.length === 0 && events.length === 0 && personals.length === 0) return null

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 sm:hidden">
      <ul className="space-y-1.5">
        {holidays.map(h => (
          <li key={h.date + h.name} className="flex items-center gap-2 text-sm">
            <span className={cn('h-2 w-2 flex-shrink-0', h.is_holiday ? 'bg-red-400' : 'bg-zinc-400')} />
            <span className={h.is_holiday ? 'text-red-600' : 'text-zinc-700'}>{h.name}</span>
          </li>
        ))}
        {events.map(ev => (
          <li key={ev.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 bg-sky-400" />
            <button
              type="button"
              className="flex-1 text-left text-zinc-800 hover:underline underline-offset-2"
              onClick={() => onOpen({ kind: 'school', event: ev })}
            >
              {ev.title}
              {ev.start_date !== ev.end_date && (
                <span className="ml-1 text-xs text-zinc-400">
                  {ev.start_date.slice(5).replace('-', '/')}～{ev.end_date.slice(5).replace('-', '/')}
                </span>
              )}
            </button>
          </li>
        ))}
        {personals.map(p => (
          <li key={p.id} className="group flex items-start gap-2 text-sm">
            <span className="mt-1.5 h-2 w-2 flex-shrink-0 bg-amber-400" />
            <button
              type="button"
              className="flex-1 text-left text-zinc-800 hover:underline underline-offset-2"
              onClick={() => onOpen({ kind: 'personal', event: p })}
            >
              {p.start_time && (
                <span className="mr-1 text-xs text-zinc-500">{fmtTimeRange(p.start_time, p.end_time)}</span>
              )}
              {p.title}
            </button>
            <button
              className="text-xs text-zinc-400 hover:text-red-600"
              onClick={() => removePersonal(p.id)}
            >
              刪除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── 公告面板 ─────────────────────────────────────────────
const OFFICE_FILTERS = ['全部', '教務處', '學務處', '總務處', '輔導室'] as const

function AnnouncementPanel({
  announcements,
  onOpen,
}: {
  announcements: Announcement[]
  onOpen: (a: Announcement) => void
}) {
  const [filter, setFilter] = useState<string>('全部')
  const shown = filter === '全部' ? announcements : announcements.filter(a => a.office === filter)

  return (
    <div className="card !p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-700">重要公告</h3>
        <div className="flex flex-wrap gap-1">
          {OFFICE_FILTERS.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => setFilter(o)}
              className={cn(
                'border px-2 py-0.5 text-xs',
                filter === o
                  ? 'border-zinc-800 bg-zinc-800 text-white'
                  : 'border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50'
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-400">
          {filter === '全部' ? '目前沒有公告。' : `目前沒有${filter}的公告。`}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {shown.map(a => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpen(a)}
                className="flex w-full items-center gap-2 py-2.5 text-left hover:bg-zinc-50"
              >
                {!a.read && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" aria-label="未讀" />}
                <span className={cn('flex-1 truncate text-sm', a.read ? 'text-zinc-600' : 'font-semibold text-zinc-900')}>
                  {a.title}
                </span>
                {a.pinned && <span className="badge-warn flex-shrink-0">置頂</span>}
                {a.requires_action && <span className="badge-default flex-shrink-0 !border-red-300 !bg-red-50 !text-red-700">需填報</span>}
                {a.office && <span className="badge-default flex-shrink-0">{a.office}</span>}
                <span className="hidden flex-shrink-0 text-xs text-zinc-400 sm:block">
                  {a.publish_at.slice(5, 10).replace('-', '/')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AnnouncementModal({
  announcement,
  alreadyAdded,
  onAddTodo,
  onClose,
}: {
  announcement: Announcement
  alreadyAdded: boolean
  onAddTodo: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[85vh] w-full max-w-lg overflow-y-auto !p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          {announcement.office && <span className="badge-default">{announcement.office}</span>}
          {announcement.pinned && <span className="badge-warn">置頂</span>}
          {announcement.requires_action && (
            <span className="badge-default !border-red-300 !bg-red-50 !text-red-700">需填報</span>
          )}
        </div>
        <h3 className="text-base font-semibold text-zinc-900">{announcement.title}</h3>
        <p className="mt-0.5 text-xs text-zinc-400">
          {announcement.publisher_title && `${announcement.publisher_title}・`}
          發布於 {announcement.publish_at.slice(0, 10)}
        </p>
        <div className="divider" />
        <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
          {announcement.content || '（無內文）'}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>關閉</button>
          <button className="btn-secondary" disabled={alreadyAdded} onClick={onAddTodo}>
            {alreadyAdded ? '已加入代辦' : '加入代辦'}
          </button>
          {announcement.link_url && (
            <a
              className="btn-primary"
              href={announcement.link_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              前往填報
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 代辦事項面板 ──────────────────────────────────────────
function TodoPanel({
  todos,
  today,
  onChange,
}: {
  todos: Todo[]
  today: string
  onChange: (todos: Todo[]) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const open = todos.filter(t => t.status === 'todo')
  const overdue = open.filter(t => t.due_date && t.due_date < today)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const dueToday = open.filter(t => t.due_date === today)
  const upcoming = open.filter(t => !t.due_date || t.due_date > today)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  const done = todos.filter(t => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  async function toggle(t: Todo) {
    const nextStatus = t.status === 'done' ? 'todo' : 'done'
    // 樂觀更新，失敗再還原
    onChange(todos.map(x => x.id === t.id
      ? { ...x, status: nextStatus, completed_at: nextStatus === 'done' ? new Date().toISOString() : null }
      : x))
    const res = await fetch('/api/teacher/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, status: nextStatus }),
    })
    if (!res.ok) {
      onChange(todos)
      const json = await res.json().catch(() => null)
      alert(json?.error ?? '更新失敗，請再試一次。')
    }
  }

  async function remove(t: Todo) {
    if (!confirm(`刪除代辦「${t.title}」？`)) return
    const res = await fetch(`/api/teacher/todos?id=${t.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      alert(json?.error ?? '刪除失敗，請再試一次。')
      return
    }
    onChange(todos.filter(x => x.id !== t.id))
  }

  function renderGroup(label: string, items: Todo[], labelClass?: string) {
    if (items.length === 0) return null
    return (
      <div>
        <div className={cn('mb-1 text-xs font-medium text-zinc-400', labelClass)}>{label}</div>
        <ul className="space-y-1">
          {items.map(t => (
            <TodoRow key={t.id} todo={t} today={today} onToggle={() => toggle(t)} onRemove={() => remove(t)} />
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="card !p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">代辦事項</h3>
        <AddIconButton label="新增代辦" onClick={() => setShowAdd(true)} />
      </div>

      {open.length === 0 && (
        <p className="py-2 text-sm text-zinc-400">目前沒有代辦事項。</p>
      )}
      <div className="space-y-3">
        {renderGroup('已逾期', overdue, 'text-red-500')}
        {renderGroup('今天', dueToday, 'text-amber-600')}
        {renderGroup('待辦', upcoming)}
      </div>

      {done.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-2">
          <button
            className="text-xs text-zinc-400 hover:text-zinc-600"
            onClick={() => setShowDone(v => !v)}
          >
            已完成（{done.length}）{showDone ? '▴' : '▾'}
          </button>
          {showDone && (
            <ul className="mt-1 space-y-1">
              {done.map(t => (
                <TodoRow key={t.id} todo={t} today={today} onToggle={() => toggle(t)} onRemove={() => remove(t)} />
              ))}
            </ul>
          )}
        </div>
      )}

      {showAdd && (
        <TodoModal
          onClose={() => setShowAdd(false)}
          onSaved={todo => {
            setShowAdd(false)
            onChange([...todos, todo])
          }}
        />
      )}
    </div>
  )
}

// ── 新增代辦 modal ────────────────────────────────────────
function TodoModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (todo: Todo) => void
}) {
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/teacher/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, note, due_date: dueDate || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '新增失敗，請再試一次。')
        return
      }
      onSaved(json)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md !p-5" onClick={e => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-zinc-900">新增代辦</h3>
        <div className="space-y-3">
          <div>
            <label className="label">內容 *</label>
            <input
              className="input"
              value={title}
              maxLength={200}
              autoFocus
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save() }}
            />
          </div>
          <div>
            <label className="label">到期日（選填）</label>
            <input type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div>
            <label className="label">備註（選填）</label>
            <textarea className="input min-h-[4rem]" value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={!title.trim() || saving} onClick={save}>
            {saving ? '儲存中…' : '新增'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TodoRow({
  todo,
  today,
  onToggle,
  onRemove,
}: {
  todo: Todo
  today: string
  onToggle: () => void
  onRemove: () => void
}) {
  const isDone = todo.status === 'done'
  const isOverdue = !isDone && Boolean(todo.due_date && todo.due_date < today)
  return (
    <li className="group flex items-start gap-2 py-0.5">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-zinc-700"
        checked={isDone}
        onChange={onToggle}
        aria-label={isDone ? '標為未完成' : '標為完成'}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', isDone ? 'text-zinc-400 line-through' : 'text-zinc-800')}>
          {todo.title}
        </p>
        {todo.note && !isDone && (
          <p className="text-xs text-zinc-500">{todo.note}</p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-zinc-400">
          {todo.due_date && (
            <span className={cn(isOverdue && 'text-red-500')}>{fmtDateLabel(todo.due_date)}</span>
          )}
          {todo.source === 'announcement' && <span className="badge-default !px-1 !py-0 !text-[10px]">公告</span>}
          {todo.source === 'assigned' && <span className="badge-default !px-1 !py-0 !text-[10px]">交辦</span>}
        </p>
      </div>
      <button
        className="flex-shrink-0 text-xs text-zinc-300 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
        onClick={onRemove}
      >
        刪除
      </button>
    </li>
  )
}
