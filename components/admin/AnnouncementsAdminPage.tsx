'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { PageLoading } from '@/components/ui/PageLoading'
import { OFFICES, type Announcement, type PublisherViewer } from '@/lib/dashboard'

interface FormState {
  id: string | null
  title: string
  office: string
  content: string
  link_url: string
  pinned: boolean
  requires_action: boolean
  publish_at: string  // datetime-local 值
  expire_at: string   // datetime-local 值，空字串＝不下架
}

const EMPTY_FORM: FormState = {
  id: null, title: '', office: '', content: '', link_url: '',
  pinned: false, requires_action: false, publish_at: '', expire_at: '',
}

/** ISO → datetime-local 輸入值（本地時區） */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toIso(local: string): string | null {
  return local ? new Date(local).toISOString() : null
}

function statusOf(a: Announcement): { label: string; className: string } {
  const now = new Date().toISOString()
  if (a.publish_at > now) return { label: '未上架', className: 'badge-default' }
  if (a.expire_at && a.expire_at <= now) return { label: '已下架', className: 'badge-default !text-zinc-400' }
  return { label: '上架中', className: 'badge-success' }
}

export function AnnouncementsAdminPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [totalTeachers, setTotalTeachers] = useState(0)
  const [viewer, setViewer] = useState<PublisherViewer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/announcements')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '載入失敗')
      setAnnouncements(json.announcements)
      setTotalTeachers(json.totalTeachers)
      setViewer(json.viewer ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗，請重新整理頁面。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setForm({ ...EMPTY_FORM, publish_at: toLocalInput(new Date().toISOString()) })
  }

  function openEdit(a: Announcement) {
    setForm({
      id: a.id,
      title: a.title,
      office: a.office,
      content: a.content,
      link_url: a.link_url,
      pinned: a.pinned,
      requires_action: a.requires_action,
      publish_at: toLocalInput(a.publish_at),
      expire_at: toLocalInput(a.expire_at),
    })
  }

  async function save() {
    if (!form || saving) return
    if (!form.title.trim()) {
      alert('請填寫公告標題。')
      return
    }
    setSaving(true)
    try {
      const payload = {
        id: form.id ?? undefined,
        title: form.title,
        office: form.office,
        content: form.content,
        link_url: form.link_url,
        pinned: form.pinned,
        requires_action: form.requires_action,
        publish_at: toIso(form.publish_at) ?? new Date().toISOString(),
        expire_at: toIso(form.expire_at),
      }
      const res = await fetch('/api/admin/announcements', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? '儲存失敗，請再試一次。')
        return
      }
      setForm(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(a: Announcement) {
    if (!confirm(`刪除公告「${a.title}」？已讀紀錄會一併刪除。`)) return
    const res = await fetch(`/api/admin/announcements?id=${a.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      alert(json?.error ?? '刪除失敗，請再試一次。')
      return
    }
    load()
  }

  if (loading && announcements.length === 0 && !error) {
    return <div className="relative min-h-[50vh]"><PageLoading /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="page-title !mb-0">公告管理</h2>
        <button className="btn-primary" onClick={openCreate}>新增公告</button>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50 !p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button className="btn-secondary mt-2" onClick={load}>重新載入</button>
        </div>
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>標題</th>
              <th>處室</th>
              <th>狀態</th>
              <th>已讀</th>
              <th>發布時間</th>
              <th className="w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {announcements.length === 0 && (
              <tr><td colSpan={6} className="text-center text-zinc-400">尚無公告，點右上「新增公告」開始。</td></tr>
            )}
            {announcements.map(a => {
              const status = statusOf(a)
              return (
                <tr key={a.id}>
                  <td>
                    <span className="flex items-center gap-1.5">
                      {a.pinned && <span className="badge-warn flex-shrink-0">置頂</span>}
                      {a.requires_action && (
                        <span className="badge-default flex-shrink-0 !border-red-300 !bg-red-50 !text-red-700">需填報</span>
                      )}
                      <span className="font-medium">{a.title}</span>
                    </span>
                  </td>
                  <td>{a.office || '—'}</td>
                  <td><span className={status.className}>{status.label}</span></td>
                  <td className="whitespace-nowrap">
                    <span className={cn((a.read_count ?? 0) >= totalTeachers && totalTeachers > 0 && 'text-green-600')}>
                      {a.read_count ?? 0}
                    </span>
                    <span className="text-zinc-400"> / {totalTeachers}</span>
                  </td>
                  <td className="whitespace-nowrap text-zinc-500">
                    {a.publish_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="whitespace-nowrap">
                    {a.can_edit !== false ? (
                      <>
                        <button className="text-sm text-zinc-600 underline-offset-2 hover:underline" onClick={() => openEdit(a)}>編輯</button>
                        <button className="ml-3 text-sm text-red-600 underline-offset-2 hover:underline" onClick={() => remove(a)}>刪除</button>
                      </>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setForm(null)}>
          <div
            className="card max-h-[90vh] w-full max-w-xl overflow-y-auto !p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-semibold text-zinc-900">
              {form.id ? '編輯公告' : '新增公告'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="label">標題 *</label>
                <input className="input" value={form.title} maxLength={200}
                  onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">處室</label>
                  {viewer?.role === 'staff' ? (
                    <p className="py-2 text-sm text-zinc-700">
                      {viewer.office}
                      <span className="ml-1.5 text-xs text-zinc-400">依您的職務（{viewer.duty}）自動帶入</span>
                    </p>
                  ) : viewer?.role === 'superadmin' && !form.id ? (
                    <p className="py-2 text-sm text-zinc-700">
                      教務處 <span className="ml-1.5 text-xs text-zinc-400">最高管理者發布固定歸教務處</span>
                    </p>
                  ) : (
                    <select className="input" value={form.office}
                      onChange={e => setForm({ ...form, office: e.target.value })}>
                      <option value="">（不指定）</option>
                      {OFFICES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
                <div className="flex items-end gap-4 pb-2">
                  <label className="flex items-center gap-1.5 text-sm text-zinc-700">
                    <input type="checkbox" className="h-4 w-4 accent-zinc-700" checked={form.pinned}
                      onChange={e => setForm({ ...form, pinned: e.target.checked })} />
                    置頂
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-zinc-700">
                    <input type="checkbox" className="h-4 w-4 accent-zinc-700" checked={form.requires_action}
                      onChange={e => setForm({ ...form, requires_action: e.target.checked })} />
                    需填報
                  </label>
                </div>
              </div>
              <div>
                <label className="label">內容</label>
                <textarea className="input min-h-[8rem]" value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })} />
              </div>
              <div>
                <label className="label">表單連結（選填，老師點「前往填報」開啟）</label>
                <input className="input" placeholder="https://…" value={form.link_url}
                  onChange={e => setForm({ ...form, link_url: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">上架時間</label>
                  <input type="datetime-local" className="input" value={form.publish_at}
                    onChange={e => setForm({ ...form, publish_at: e.target.value })} />
                </div>
                <div>
                  <label className="label">下架時間（留空＝不下架）</label>
                  <input type="datetime-local" className="input" value={form.expire_at}
                    onChange={e => setForm({ ...form, expire_at: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setForm(null)}>取消</button>
              <button className="btn-primary" disabled={saving} onClick={save}>
                {saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
