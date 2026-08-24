'use client'

import { useEffect, useRef, useState } from 'react'
import { PageLoading } from '@/components/ui/PageLoading'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  REPAIR_STATUSES,
  contactRoleLabel,
  elapsedText,
  repairStatusLabel,
  resolvedKindLabel,
} from '@/lib/repair'

// ---------- 型別 ----------

interface ItemRow { id: string; name: string }
interface IssueRow { id: string; item_id: string; name: string; count: number }
interface ContactRow { name: string; role: string; contact: string; note: string }

interface ReportRow {
  id: string
  item_id: string | null
  item_name: string
  issue_id: string | null
  issue_name: string
  custom_issue: string
  location: string
  photoUrls: string[]
  status: string
  resolved_kind: string | null
  created_at: string
  accepted_at: string | null
  dispatched_at: string | null
  vendor_at: string | null
  closed_at: string | null
}

interface PageData {
  items: ItemRow[]
  issues: IssueRow[]
  contacts: ContactRow[]
  reports: ReportRow[]
}

interface UploadedPhoto { path: string; url: string | null }

type View =
  | { mode: 'list' }
  | { mode: 'form' }
  | { mode: 'detail'; reportId: string }

function issueText(r: ReportRow): string {
  return r.issue_name || r.custom_issue || '（未填問題）'
}

function timeText(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 案件狀態顯示文字：結案時帶解決方式 */
function statusText(r: ReportRow): string {
  if (r.status === 'closed' && (r.resolved_kind === 'self' || r.resolved_kind === 'vanished')) {
    return `已解決（${resolvedKindLabel(r.resolved_kind)}）`
  }
  if (r.status === 'closed') return '已結案'
  return repairStatusLabel(r.status)
}

export function RepairPage() {
  const [data, setData] = useState<PageData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState<View>({ mode: 'list' })

  // 表單狀態。formItemId 為 OTHER_ITEM＝「其他設備」（自行填寫名稱、問題只能自由描述）
  const OTHER_ITEM = '__other__'
  const [formItemId, setFormItemId] = useState('')
  const [formOtherName, setFormOtherName] = useState('')
  const [formIssueId, setFormIssueId] = useState('')      // '' 且 custom 也空＝未選
  const [formCustom, setFormCustom] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [formLocation, setFormLocation] = useState('')
  const [formPhotos, setFormPhotos] = useState<UploadedPhoto[]>([])
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const [message, setMessage] = useState('')
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const [busy, setBusy] = useState('')
  const runBusy = async (msg: string, fn: () => Promise<void>) => {
    setBusy(msg)
    try {
      await fn()
    } catch (e) {
      flash(e instanceof Error ? e.message : '操作失敗')
    } finally {
      setBusy('')
    }
  }

  // 經過時間每 30 秒更新
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const load = async () => {
    const res = await fetch('/api/teacher/repair')
    const json = await res.json()
    if (!res.ok) {
      setLoadError(json.error || '載入失敗')
      return null
    }
    setData(json)
    return json as PageData
  }

  useEffect(() => { void load() }, [])

  if (loadError) return <div className="card"><p className="text-sm text-red-600">{loadError}</p></div>
  if (!data) return <PageLoading />

  const resetForm = () => {
    setFormItemId('')
    setFormOtherName('')
    setFormIssueId('')
    setFormCustom('')
    setUseCustom(false)
    setFormLocation('')
    setFormPhotos([])
  }

  const openForm = () => {
    resetForm()
    setView({ mode: 'form' })
  }

  const isOtherItem = formItemId === OTHER_ITEM
  const formIssues = data.issues
    .filter(s => s.item_id === formItemId)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'))

  const canSubmit = isOtherItem
    ? Boolean(formOtherName.trim()) && Boolean(formCustom.trim())
    : Boolean(formItemId) && (useCustom ? Boolean(formCustom.trim()) : Boolean(formIssueId))

  const uploadPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    await runBusy('上傳照片中…', async () => {
      const next = [...formPhotos]
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/teacher/repair/photo', { method: 'POST', body: form })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || '照片上傳失敗')
        next.push({ path: json.path, url: json.url })
      }
      setFormPhotos(next)
    })
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (galleryInputRef.current) galleryInputRef.current.value = ''
  }

  const submitReport = async () => {
    await runBusy('送出報修中…', async () => {
      const res = await fetch('/api/teacher/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: isOtherItem ? null : formItemId,
          other_item_name: isOtherItem ? formOtherName : '',
          issue_id: isOtherItem || useCustom ? null : formIssueId || null,
          custom_issue: isOtherItem || useCustom ? formCustom : '',
          location: formLocation,
          photos: formPhotos.map(p => p.path),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '送出失敗')
      await load()
      setView({ mode: 'detail', reportId: json.id })
      flash('報修已送出')
    })
  }

  const resolveReport = async (report: ReportRow, kind: 'self' | 'vanished') => {
    const label = kind === 'self' ? '自行排除' : '問題自行消失'
    if (!confirm(`確定回報「${label}」？案件會直接結案。`)) return
    await runBusy('回報中…', async () => {
      const res = await fetch('/api/teacher/repair', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: report.id, resolved_kind: kind }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || '回報失敗')
      await load()
      flash('已回報解決，案件結案')
    })
  }

  const detailReport =
    view.mode === 'detail' ? data.reports.find(r => r.id === view.reportId) ?? null : null

  return (
    <div className="space-y-4">
      {busy && <BusyOverlay text={busy} />}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">設備報修</h1>
        {message && <span className="text-sm text-zinc-600" aria-live="polite">{message}</span>}
      </div>

      {/* ============ 我的案件列表 ============ */}
      {view.mode === 'list' && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-zinc-900">我的報修</h2>
              <p className="mt-0.5 text-sm text-zinc-500">點案件可查看進度與維護人員聯絡方式。</p>
            </div>
            <button className="btn-primary" onClick={openForm}>我要報修</button>
          </div>

          {data.reports.length === 0 && (
            <p className="text-sm text-zinc-500">還沒有報修紀錄。</p>
          )}

          <div className="space-y-2">
            {data.reports.map(r => (
              <button
                key={r.id}
                className="w-full rounded border border-zinc-200 px-3 py-2 text-left transition-colors hover:bg-zinc-50"
                onClick={() => setView({ mode: 'detail', reportId: r.id })}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium text-zinc-800">{r.item_name}</span>
                    <span className="text-zinc-600">｜{issueText(r)}</span>
                    {r.location && <span className="text-zinc-400">（{r.location}）</span>}
                  </span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                    r.status === 'closed' ? 'bg-zinc-100 text-zinc-500' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {statusText(r)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {timeText(r.created_at)} 報修
                  {r.status !== 'closed' && `｜已經過 ${elapsedText(r.created_at, now)}`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ============ 報修表單 ============ */}
      {view.mode === 'form' && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-zinc-900">填寫報修</h2>
            <button className="btn-secondary" onClick={() => setView({ mode: 'list' })}>返回</button>
          </div>

          {/* 選設備項目 */}
          <div>
            <p className="mb-1.5 text-sm text-zinc-600">報修設備</p>
            {data.items.length === 0 && (
              <p className="text-sm text-zinc-500">目前沒有開放報修的設備項目，請聯絡資訊組。</p>
            )}
            <div className="flex flex-wrap gap-2">
              {data.items.map(item => (
                <button
                  key={item.id}
                  className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                    item.id === formItemId
                      ? 'border-zinc-800 bg-zinc-800 text-white'
                      : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50'
                  }`}
                  onClick={() => { setFormItemId(item.id); setFormIssueId(''); setUseCustom(false) }}
                >
                  {item.name}
                </button>
              ))}
              <button
                className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                  isOtherItem
                    ? 'border-zinc-800 bg-zinc-800 text-white'
                    : 'border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-50'
                }`}
                onClick={() => { setFormItemId(OTHER_ITEM); setFormIssueId(''); setUseCustom(false) }}
              >
                其他設備…
              </button>
            </div>
            {isOtherItem && (
              <input
                className="input mt-2"
                placeholder="請填寫設備名稱（例：實物投影機）"
                value={formOtherName}
                onChange={e => setFormOtherName(e.target.value)}
              />
            )}
          </div>

          {/* 選問題（依被報修次數排序）；其他設備＝直接自由描述 */}
          <div>
            <p className="mb-1.5 text-sm text-zinc-600">遇到什麼問題？</p>
            {!formItemId && (
              <p className="text-sm text-zinc-400">請先在上方選擇報修設備。</p>
            )}
            {formItemId && !isOtherItem && (
              <>
                <div className="flex flex-wrap gap-2">
                  {formIssues.map(s => (
                    <button
                      key={s.id}
                      className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                        !useCustom && s.id === formIssueId
                          ? 'border-zinc-800 bg-zinc-800 text-white'
                          : 'border-zinc-300 text-zinc-700 hover:bg-zinc-50'
                      }`}
                      onClick={() => { setFormIssueId(s.id); setUseCustom(false) }}
                    >
                      {s.name}
                      {s.count > 0 && (
                        <span className={`ml-1.5 text-xs ${!useCustom && s.id === formIssueId ? 'text-zinc-300' : 'text-zinc-400'}`}>
                          {s.count} 次
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                      useCustom
                        ? 'border-zinc-800 bg-zinc-800 text-white'
                        : 'border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-50'
                    }`}
                    onClick={() => { setUseCustom(true); setFormIssueId('') }}
                  >
                    其他問題…
                  </button>
                </div>
                {useCustom && (
                  <textarea
                    className="input mt-2 min-h-20"
                    placeholder="請描述遇到的狀況（例：開機後畫面一直閃爍）"
                    value={formCustom}
                    onChange={e => setFormCustom(e.target.value)}
                  />
                )}
              </>
            )}
            {isOtherItem && (
              <textarea
                className="input min-h-20"
                placeholder="請描述遇到的狀況（例：開機後畫面一直閃爍）"
                value={formCustom}
                onChange={e => setFormCustom(e.target.value)}
              />
            )}
          </div>

          {/* 地點 */}
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600">地點（教室／場地）</span>
            <input className="input" value={formLocation} placeholder="例：三年甲班"
              onChange={e => setFormLocation(e.target.value)} />
          </label>

          {/* 照片：拍照（手機/平板直接開相機）與相簿分開兩顆按鈕 */}
          <div>
            <p className="mb-1.5 text-sm text-zinc-600">問題照片（選填，可多張）</p>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => uploadPhotos(e.target.files)}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => uploadPhotos(e.target.files)}
            />
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => cameraInputRef.current?.click()}>📷 拍照</button>
              <button className="btn-secondary" onClick={() => galleryInputRef.current?.click()}>🖼 從相簿選</button>
            </div>
            {formPhotos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {formPhotos.map((p, i) => (
                  <div key={p.path} className="relative">
                    {p.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt={`照片 ${i + 1}`} className="h-20 w-20 rounded border border-zinc-200 object-cover" />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded border border-zinc-200 text-xs text-zinc-400">已上傳</div>
                    )}
                    <button
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-xs text-white"
                      onClick={() => setFormPhotos(list => list.filter(x => x.path !== p.path))}
                      aria-label="移除照片"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={!canSubmit} onClick={submitReport}>送出報修</button>
          </div>
        </div>
      )}

      {/* ============ 案件詳情（報修完成頁） ============ */}
      {view.mode === 'detail' && detailReport && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium text-zinc-900">
                  {detailReport.item_name}｜{issueText(detailReport)}
                </h2>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {detailReport.location && `地點：${detailReport.location}｜`}
                  {timeText(detailReport.created_at)} 報修
                </p>
              </div>
              <button className="btn-secondary" onClick={() => setView({ mode: 'list' })}>返回</button>
            </div>

            {detailReport.status !== 'closed' && (
              <p className="text-sm text-zinc-700">
                距離報修已經過 <span className="font-semibold">{elapsedText(detailReport.created_at, now)}</span>
              </p>
            )}

            {/* 狀態進度 */}
            {detailReport.status === 'closed' &&
             (detailReport.resolved_kind === 'self' || detailReport.resolved_kind === 'vanished') ? (
              <p className="text-sm text-green-700">
                ✓ 已解決（{resolvedKindLabel(detailReport.resolved_kind)}），案件已結案。
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {REPAIR_STATUSES.map((s, i) => {
                  const reached =
                    REPAIR_STATUSES.findIndex(x => x.key === detailReport.status) >= i
                  return (
                    <span key={s.key} className="flex items-center gap-1">
                      {i > 0 && <span className="text-zinc-300">→</span>}
                      <span className={`rounded px-2 py-1 ${
                        reached ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-400'
                      }`}>
                        {s.label}
                      </span>
                    </span>
                  )
                })}
              </div>
            )}

            {detailReport.photoUrls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detailReport.photoUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`照片 ${i + 1}`} className="h-24 w-24 rounded border border-zinc-200 object-cover" />
                  </a>
                ))}
              </div>
            )}

            {/* 已解決回報 */}
            {detailReport.status !== 'closed' && (
              <div className="rounded border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-sm text-zinc-700">
                  問題已經解決了嗎？回報後案件會結案，維護人員就不需要出勤。
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button className="btn-secondary" onClick={() => resolveReport(detailReport, 'vanished')}>
                    問題自行消失
                  </button>
                  <button className="btn-primary" onClick={() => resolveReport(detailReport, 'self')}>
                    我已自行排除
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 維護人員 */}
          {data.contacts.length > 0 && detailReport.status !== 'closed' && (
            <div className="card space-y-2">
              <h3 className="text-sm font-medium text-zinc-900">急用嗎？可以聯絡維護人員</h3>
              <div className="space-y-1.5">
                {data.contacts.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-zinc-800">{c.name}</span>
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{contactRoleLabel(c.role)}</span>
                      {c.note && <span className="ml-2 text-xs text-zinc-500">{c.note}</span>}
                    </span>
                    <span className="text-zinc-700">{c.contact}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
