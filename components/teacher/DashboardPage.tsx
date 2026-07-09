'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { MonthCalendar, type CalendarCellItem } from '@/components/ui/MonthCalendar'
import { PageLoading } from '@/components/ui/PageLoading'
import {
  dashboardTodayStr, dateInRange, fmtDateLabel, monthGridDates,
  type Announcement, type Holiday, type PersonalEvent, type SchoolEvent, type Todo,
} from '@/lib/dashboard'

interface DashboardData {
  events: SchoolEvent[]
  holidays: Holiday[]
  personalEvents: PersonalEvent[]
  announcements: Announcement[]
  todos: Todo[]
}

export function DashboardPage() {
  const today = dashboardTodayStr()
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [selectedDate, setSelectedDate] = useState(today)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeAnnouncement, setActiveAnnouncement] = useState<Announcement | null>(null)

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

  // 行事曆格子內容：學校活動（跨日逐日展開）→ 假日/補班 → 個人事項
  const itemsByDate = useMemo(() => {
    const map: Record<string, CalendarCellItem[]> = {}
    if (!data) return map
    const push = (date: string, item: CalendarCellItem) => {
      (map[date] ??= []).push(item)
    }
    for (const h of data.holidays) {
      push(h.date, { key: `h-${h.date}`, label: h.name, kind: h.is_holiday ? 'holiday' : 'workday' })
    }
    for (const ev of data.events) {
      for (const date of gridDates) {
        if (dateInRange(date, ev.start_date, ev.end_date)) {
          push(date, { key: `e-${ev.id}-${date}`, label: ev.title, kind: 'event' })
        }
      }
    }
    for (const p of data.personalEvents) {
      push(p.date, { key: `p-${p.id}`, label: p.title, kind: 'personal' })
    }
    return map
  }, [data, gridDates])

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
              <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-sky-400" />學校活動</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-red-400" />假日</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-zinc-400" />補行上班</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 bg-amber-400" />個人</span>
              </div>
            </div>
            <MonthCalendar
              year={year}
              month={month}
              itemsByDate={itemsByDate}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
            <DayDetail
              date={selectedDate}
              data={data}
              onChanged={load}
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
    </div>
  )
}

// ── 選定日期詳情＋新增個人事項 ─────────────────────────────
function DayDetail({
  date,
  data,
  onChanged,
}: {
  date: string
  data: DashboardData | null
  onChanged: () => void
}) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  const holidays = (data?.holidays ?? []).filter(h => h.date === date)
  const events = (data?.events ?? []).filter(ev => dateInRange(date, ev.start_date, ev.end_date))
  const personals = (data?.personalEvents ?? []).filter(p => p.date === date)

  async function addPersonal() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/teacher/personal-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, title }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '新增失敗，請再試一次。')
        return
      }
      setTitle('')
      onChanged()
    } finally {
      setSaving(false)
    }
  }

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

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <h4 className="mb-2 text-sm font-semibold text-zinc-700">{fmtDateLabel(date)}</h4>
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
            <span className="text-zinc-800">
              {ev.title}
              {ev.start_date !== ev.end_date && (
                <span className="ml-1 text-xs text-zinc-400">
                  {ev.start_date.slice(5).replace('-', '/')}～{ev.end_date.slice(5).replace('-', '/')}
                </span>
              )}
              {ev.description && <span className="block text-xs text-zinc-500">{ev.description}</span>}
            </span>
          </li>
        ))}
        {personals.map(p => (
          <li key={p.id} className="group flex items-center gap-2 text-sm">
            <span className="h-2 w-2 flex-shrink-0 bg-amber-400" />
            <span className="flex-1 text-zinc-800">{p.title}</span>
            <button
              className="text-xs text-zinc-400 hover:text-red-600"
              onClick={() => removePersonal(p.id)}
            >
              刪除
            </button>
          </li>
        ))}
        {holidays.length === 0 && events.length === 0 && personals.length === 0 && (
          <li className="text-sm text-zinc-400">這天沒有活動。</li>
        )}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          className="input flex-1"
          placeholder="新增我的事項…"
          value={title}
          maxLength={100}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addPersonal() }}
        />
        <button className="btn-primary" disabled={!title.trim() || saving} onClick={addPersonal}>
          新增
        </button>
      </div>
    </div>
  )
}

// ── 公告面板 ─────────────────────────────────────────────
function AnnouncementPanel({
  announcements,
  onOpen,
}: {
  announcements: Announcement[]
  onOpen: (a: Announcement) => void
}) {
  return (
    <div className="card !p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-700">重要公告</h3>
      {announcements.length === 0 ? (
        <p className="text-sm text-zinc-400">目前沒有公告。</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {announcements.map(a => (
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
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const open = todos.filter(t => t.status === 'todo')
  const overdue = open.filter(t => t.due_date && t.due_date < today)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const dueToday = open.filter(t => t.due_date === today)
  const upcoming = open.filter(t => !t.due_date || t.due_date > today)
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  const done = todos.filter(t => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  async function addTodo() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/teacher/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, due_date: dueDate || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '新增失敗，請再試一次。')
        return
      }
      setTitle('')
      setDueDate('')
      onChange([...todos, json])
    } finally {
      setSaving(false)
    }
  }

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
      <h3 className="mb-3 text-sm font-semibold text-zinc-700">代辦事項</h3>

      <div className="mb-3 space-y-2">
        <input
          className="input"
          placeholder="新增代辦…"
          value={title}
          maxLength={200}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
        />
        <div className="flex gap-2">
          <input
            type="date"
            className="input flex-1"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            aria-label="到期日（選填）"
          />
          <button className="btn-primary" disabled={!title.trim() || saving} onClick={addTodo}>
            新增
          </button>
        </div>
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
