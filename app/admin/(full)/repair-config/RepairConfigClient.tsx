'use client'

import { useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  CONTACT_ROLES,
  contactRoleLabel,
  guideIsEmpty,
  type RepairConfig,
  type RepairGuide,
} from '@/lib/repair'

interface ItemRow {
  id: string
  name: string
  fallback_guide: RepairGuide
  active: boolean
  sort_order: number
}

interface IssueRow {
  id: string
  item_id: string
  name: string
  aliases: string[]
  guide: RepairGuide
  active: boolean
  sort_order: number
}

interface ContactRow {
  id: string
  name: string
  role: string
  contact: string
  note: string
  active: boolean
  sort_order: number
}

/** 問題編輯草稿（aliases、排序用字串維護，存檔時才解析——數字欄位直接綁 number 會讓 0 刪不掉） */
interface IssueDraft {
  id: string        // '' = 新增
  item_id: string
  name: string
  aliasesText: string
  videoUrl: string
  stepsMd: string
  active: boolean
  sortText: string
}

function splitAliases(text: string): string[] {
  return text.split(/[,、;；\n]/).map(a => a.trim()).filter(Boolean)
}

function parseIntOr(text: string, fallback: number): number {
  const n = Number(text.trim())
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/** 設備項目編輯草稿 */
interface ItemDraft {
  id: string        // '' = 新增
  name: string
  fallback_guide: RepairGuide
  active: boolean
  sortText: string
}

/** 維護人員編輯草稿 */
interface ContactDraft {
  id: string        // '' = 新增
  name: string
  role: string
  contact: string
  note: string
  active: boolean
  sortText: string
}

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '操作失敗')
  return data
}

export default function RepairConfigClient({
  initialItems,
  initialIssues,
  initialContacts,
  initialConfig,
}: {
  initialItems: ItemRow[]
  initialIssues: IssueRow[]
  initialContacts: ContactRow[]
  initialConfig: RepairConfig
}) {
  const [items, setItems] = useState<ItemRow[]>(initialItems)
  const [issues, setIssues] = useState<IssueRow[]>(initialIssues)
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts)
  const [slaWarnText, setSlaWarnText] = useState(String(initialConfig.slaWarnHours))
  const [slaAlertText, setSlaAlertText] = useState(String(initialConfig.slaAlertHours))
  const [tab, setTab] = useState<'items' | 'contacts' | 'sla'>('items')

  const [selectedItemId, setSelectedItemId] = useState<string>(initialItems[0]?.id ?? '')
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null)   // 非 null＝正在編輯（id '' 為新增）
  const [issueDraft, setIssueDraft] = useState<IssueDraft | null>(null)
  const [contactDraft, setContactDraft] = useState<ContactDraft | null>(null)

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

  const selectedItem = items.find(i => i.id === selectedItemId) ?? null
  const selectedIssues = issues
    .filter(s => s.item_id === selectedItemId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

  // ---------- 設備項目 ----------

  const saveItem = async (draft: ItemDraft) => {
    const isCreate = !draft.id
    const row: ItemRow = {
      id: draft.id, name: draft.name, fallback_guide: draft.fallback_guide,
      active: draft.active, sort_order: parseIntOr(draft.sortText, 0),
    }
    await runBusy('儲存項目中…', async () => {
      const data = await call('/api/admin/repair-items', isCreate ? 'POST' : 'PUT',
        isCreate ? { ...row, id: undefined } : row)
      const saved: ItemRow = { ...row, id: data.id }
      setItems(list => {
        const next = isCreate ? [...list, saved] : list.map(i => (i.id === saved.id ? saved : i))
        return next.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      })
      setSelectedItemId(saved.id)
      setItemDraft(null)
      flash('項目已儲存')
    })
  }

  const deleteItem = async (row: { id: string; name: string }) => {
    const count = issues.filter(s => s.item_id === row.id).length
    if (!confirm(`確定刪除「${row.name}」？其底下 ${count} 個問題會一併刪除，既有報修案件會保留文字紀錄。若只是暫時不開放，建議改為「停用」。`)) return
    await runBusy('刪除項目中…', async () => {
      await call(`/api/admin/repair-items?id=${row.id}`, 'DELETE')
      setItems(list => list.filter(i => i.id !== row.id))
      setIssues(list => list.filter(s => s.item_id !== row.id))
      if (selectedItemId === row.id) setSelectedItemId('')
      setItemDraft(null)
      flash('項目已刪除')
    })
  }

  // ---------- 標準問題 ----------

  const saveIssue = async (draft: IssueDraft) => {
    const isCreate = !draft.id
    const payload = {
      id: draft.id || undefined,
      item_id: draft.item_id,
      name: draft.name,
      aliases: splitAliases(draft.aliasesText),
      guide: { videoUrl: draft.videoUrl.trim(), stepsMd: draft.stepsMd, photos: [] },
      active: draft.active,
      sort_order: parseIntOr(draft.sortText, 0),
    }
    await runBusy('儲存問題中…', async () => {
      const data = await call('/api/admin/repair-issues', isCreate ? 'POST' : 'PUT', payload)
      const saved: IssueRow = {
        id: data.id,
        item_id: draft.item_id,
        name: draft.name.trim(),
        aliases: splitAliases(draft.aliasesText),
        guide: { videoUrl: draft.videoUrl.trim(), stepsMd: draft.stepsMd, photos: [] },
        active: draft.active,
        sort_order: parseIntOr(draft.sortText, 0),
      }
      setIssues(list => (isCreate ? [...list, saved] : list.map(s => (s.id === saved.id ? saved : s))))
      setIssueDraft(null)
      flash('問題已儲存')
    })
  }

  const deleteIssue = async (row: IssueRow) => {
    if (!confirm(`確定刪除問題「${row.name}」？既有報修案件會保留文字紀錄。`)) return
    await runBusy('刪除問題中…', async () => {
      await call(`/api/admin/repair-issues?id=${row.id}`, 'DELETE')
      setIssues(list => list.filter(s => s.id !== row.id))
      setIssueDraft(null)
      flash('問題已刪除')
    })
  }

  // ---------- 維護人員 ----------

  const saveContact = async (draft: ContactDraft) => {
    const isCreate = !draft.id
    const row: ContactRow = {
      id: draft.id, name: draft.name, role: draft.role, contact: draft.contact,
      note: draft.note, active: draft.active, sort_order: parseIntOr(draft.sortText, 0),
    }
    await runBusy('儲存人員中…', async () => {
      const data = await call('/api/admin/repair-contacts', isCreate ? 'POST' : 'PUT',
        isCreate ? { ...row, id: undefined } : row)
      const saved: ContactRow = { ...row, id: data.id }
      setContacts(list => {
        const next = isCreate ? [...list, saved] : list.map(c => (c.id === saved.id ? saved : c))
        return next.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      })
      setContactDraft(null)
      flash('人員已儲存')
    })
  }

  const deleteContact = async (row: { id: string; name: string }) => {
    if (!confirm(`確定刪除「${row.name}」？`)) return
    await runBusy('刪除人員中…', async () => {
      await call(`/api/admin/repair-contacts?id=${row.id}`, 'DELETE')
      setContacts(list => list.filter(c => c.id !== row.id))
      setContactDraft(null)
      flash('人員已刪除')
    })
  }

  // ---------- SLA ----------

  const saveConfig = async () => {
    const warn = parseIntOr(slaWarnText, 0)
    const alert = parseIntOr(slaAlertText, 0)
    if (warn <= 0 || alert <= 0) {
      flash('請輸入大於 0 的小時數')
      return
    }
    const next: RepairConfig = { slaWarnHours: warn, slaAlertHours: alert }
    await runBusy('儲存設定中…', async () => {
      await call('/api/admin/repair-config', 'PUT', next)
      setSlaWarnText(String(warn))
      setSlaAlertText(String(alert))
      flash('設定已儲存')
    })
  }

  const emptyIssueDraft = (itemId: string): IssueDraft => ({
    id: '', item_id: itemId, name: '', aliasesText: '', videoUrl: '', stepsMd: '',
    active: true, sortText: String(selectedIssues.length),
  })

  const issueToDraft = (s: IssueRow): IssueDraft => ({
    id: s.id, item_id: s.item_id, name: s.name,
    aliasesText: s.aliases.join('、'),
    videoUrl: s.guide.videoUrl, stepsMd: s.guide.stepsMd,
    active: s.active, sortText: String(s.sort_order),
  })

  return (
    <div className="space-y-4">
      {busy && <BusyOverlay text={busy} />}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">報修設定</h1>
        {message && <span className="text-sm text-zinc-600" aria-live="polite">{message}</span>}
      </div>

      <div className="flex border-b border-zinc-200">
        {([
          ['items', '設備項目與問題'],
          ['contacts', '維護人員'],
          ['sla', '警告門檻'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-zinc-800 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ============ 設備項目與問題 ============ */}
      {tab === 'items' && (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          {/* 項目清單 */}
          <div className="card space-y-2 self-start">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-900">設備項目</h2>
              <button
                className="btn-secondary !px-3 !py-1"
                onClick={() => setItemDraft({ id: '', name: '', fallback_guide: { videoUrl: '', stepsMd: '', photos: [] }, active: true, sortText: String(items.length) })}
              >
                ＋新增
              </button>
            </div>
            {items.length === 0 && (
              <p className="text-sm text-zinc-500">還沒有項目——先新增「電視」「網路」「冷氣」等常見報修對象。</p>
            )}
            <div className="space-y-1">
              {items.map(item => (
                <button
                  key={item.id}
                  className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                    item.id === selectedItemId ? 'bg-zinc-800 text-white' : 'hover:bg-zinc-100 text-zinc-700'
                  }`}
                  onClick={() => { setSelectedItemId(item.id); setItemDraft(null); setIssueDraft(null) }}
                >
                  <span className="flex items-center justify-between">
                    <span>{item.name}{!item.active && <span className="ml-1 text-xs opacity-70">（停用）</span>}</span>
                    <span className={`text-xs ${item.id === selectedItemId ? 'text-zinc-300' : 'text-zinc-400'}`}>
                      {issues.filter(s => s.item_id === item.id).length} 題
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 項目編輯器（新增/編輯） */}
          {itemDraft ? (
            <div className="card space-y-3 self-start">
              <h2 className="text-sm font-medium text-zinc-900">{itemDraft.id ? '編輯項目' : '新增項目'}</h2>
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem_auto]">
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">項目名稱</span>
                  <input className="input" value={itemDraft.name} placeholder="例：教室電視"
                    onChange={e => setItemDraft({ ...itemDraft, name: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">排序</span>
                  <input className="input" inputMode="numeric" value={itemDraft.sortText}
                    onChange={e => setItemDraft({ ...itemDraft, sortText: e.target.value })} />
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm text-zinc-700">
                  <input type="checkbox" checked={itemDraft.active}
                    onChange={e => setItemDraft({ ...itemDraft, active: e.target.checked })} />
                  開放報修
                </label>
              </div>
              <div className="space-y-2 rounded border border-zinc-200 p-3">
                <p className="text-sm font-medium text-zinc-700">通用自助排解（此項目沒有對到標準問題時顯示）</p>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">教學影片網址</span>
                  <input className="input" value={itemDraft.fallback_guide.videoUrl} placeholder="https://youtu.be/…（可留空）"
                    onChange={e => setItemDraft({ ...itemDraft, fallback_guide: { ...itemDraft.fallback_guide, videoUrl: e.target.value } })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">排解步驟（一行一步）</span>
                  <textarea className="input min-h-24" value={itemDraft.fallback_guide.stepsMd}
                    onChange={e => setItemDraft({ ...itemDraft, fallback_guide: { ...itemDraft.fallback_guide, stepsMd: e.target.value } })} />
                </label>
              </div>
              <div className="flex justify-between">
                {itemDraft.id ? (
                  <button className="btn-danger" onClick={() => deleteItem(itemDraft)}>刪除項目</button>
                ) : <span />}
                <span className="flex gap-2">
                  <button className="btn-secondary" onClick={() => setItemDraft(null)}>取消</button>
                  <button className="btn-primary" disabled={!itemDraft.name.trim()} onClick={() => saveItem(itemDraft)}>儲存</button>
                </span>
              </div>
            </div>
          ) : selectedItem ? (
            /* 選中項目：問題字典 */
            <div className="card space-y-3 self-start">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-medium text-zinc-900">
                    {selectedItem.name}
                    {!selectedItem.active && <span className="ml-2 text-xs text-zinc-400">（停用中）</span>}
                  </h2>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    老師報修時可直接點選這些問題；同義詞會餵給自由輸入的即時建議。
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary"
                    onClick={() => setItemDraft({
                      id: selectedItem.id, name: selectedItem.name, fallback_guide: selectedItem.fallback_guide,
                      active: selectedItem.active, sortText: String(selectedItem.sort_order),
                    })}>
                    編輯項目
                  </button>
                  <button className="btn-primary" onClick={() => setIssueDraft(emptyIssueDraft(selectedItem.id))}>新增問題</button>
                </div>
              </div>

              {selectedIssues.length === 0 && !issueDraft && (
                <p className="text-sm text-zinc-500">還沒有標準問題——例如「沒有網路」「沒有畫面」「沒有聲音」。</p>
              )}

              <div className="space-y-2">
                {selectedIssues.map(s =>
                  issueDraft && issueDraft.id === s.id ? null : (
                    <div key={s.id} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2">
                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-zinc-800">{s.name}</span>
                        {!s.active && <span className="ml-2 text-xs text-zinc-400">停用</span>}
                        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-zinc-500">
                          {s.aliases.length > 0 && <span>同義詞：{s.aliases.join('、')}</span>}
                          <span>{guideIsEmpty(s.guide) ? '未設自助內容' : '✓ 已設自助內容'}</span>
                        </div>
                      </div>
                      <button className="btn-secondary !px-3 !py-1" onClick={() => setIssueDraft(issueToDraft(s))}>編輯</button>
                    </div>
                  )
                )}
              </div>

              {/* 問題編輯器 */}
              {issueDraft && (
                <div className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-3">
                  <p className="text-sm font-medium text-zinc-700">{issueDraft.id ? '編輯問題' : '新增問題'}</p>
                  <div className="grid gap-3 sm:grid-cols-[1fr_6rem_auto]">
                    <label className="block text-sm">
                      <span className="mb-1 block text-zinc-600">問題名稱</span>
                      <input className="input" value={issueDraft.name} placeholder="例：沒有網路"
                        onChange={e => setIssueDraft({ ...issueDraft, name: e.target.value })} />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-zinc-600">排序</span>
                      <input className="input" inputMode="numeric" value={issueDraft.sortText}
                        onChange={e => setIssueDraft({ ...issueDraft, sortText: e.target.value })} />
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm text-zinc-700">
                      <input type="checkbox" checked={issueDraft.active}
                        onChange={e => setIssueDraft({ ...issueDraft, active: e.target.checked })} />
                      啟用
                    </label>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600">同義詞（以「、」或逗號分隔；老師自由輸入時比對用）</span>
                    <input className="input" value={issueDraft.aliasesText} placeholder="例：連不上網、wifi 壞掉、無法上網"
                      onChange={e => setIssueDraft({ ...issueDraft, aliasesText: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600">教學影片網址（可留空）</span>
                    <input className="input" value={issueDraft.videoUrl} placeholder="https://youtu.be/…"
                      onChange={e => setIssueDraft({ ...issueDraft, videoUrl: e.target.value })} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-zinc-600">排解步驟（一行一步；老師報修後會看到）</span>
                    <textarea className="input min-h-24" value={issueDraft.stepsMd}
                      placeholder={'例：\n1. 確認電視旁的網路線有插好\n2. 將電視關機 10 秒再開機\n3. 仍無法連線請聯絡維護人員'}
                      onChange={e => setIssueDraft({ ...issueDraft, stepsMd: e.target.value })} />
                  </label>
                  <div className="flex justify-between">
                    {issueDraft.id ? (
                      <button className="btn-danger"
                        onClick={() => { const row = selectedIssues.find(s => s.id === issueDraft.id); if (row) deleteIssue(row) }}>
                        刪除問題
                      </button>
                    ) : <span />}
                    <span className="flex gap-2">
                      <button className="btn-secondary" onClick={() => setIssueDraft(null)}>取消</button>
                      <button className="btn-primary" disabled={!issueDraft.name.trim()} onClick={() => saveIssue(issueDraft)}>儲存</button>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card self-start">
              <p className="text-sm text-zinc-500">左側選擇一個設備項目，或新增項目。</p>
            </div>
          )}
        </div>
      )}

      {/* ============ 維護人員 ============ */}
      {tab === 'contacts' && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-zinc-900">維護人員</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                老師報修後會看到這份聯絡清單，可以直接呼叫協助（含學生志工）。
              </p>
            </div>
            <button className="btn-primary"
              onClick={() => setContactDraft({ id: '', name: '', role: 'teacher', contact: '', note: '', active: true, sortText: String(contacts.length) })}>
              新增人員
            </button>
          </div>

          {contacts.length === 0 && !contactDraft && (
            <p className="text-sm text-zinc-500">還沒有維護人員。</p>
          )}

          <div className="space-y-2">
            {contacts.map(c =>
              contactDraft && contactDraft.id === c.id ? null : (
                <div key={c.id} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-zinc-800">{c.name}</span>
                    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{contactRoleLabel(c.role)}</span>
                    {!c.active && <span className="ml-2 text-xs text-zinc-400">停用</span>}
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {c.contact || '（未填聯絡方式）'}{c.note && `｜${c.note}`}
                    </div>
                  </div>
                  <button className="btn-secondary !px-3 !py-1"
                    onClick={() => setContactDraft({
                      id: c.id, name: c.name, role: c.role, contact: c.contact,
                      note: c.note, active: c.active, sortText: String(c.sort_order),
                    })}>
                    編輯
                  </button>
                </div>
              )
            )}
          </div>

          {contactDraft && (
            <div className="space-y-3 rounded border border-zinc-300 bg-zinc-50 p-3">
              <p className="text-sm font-medium text-zinc-700">{contactDraft.id ? '編輯人員' : '新增人員'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">姓名</span>
                  <input className="input" value={contactDraft.name}
                    onChange={e => setContactDraft({ ...contactDraft, name: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">身分</span>
                  <select className="input" value={contactDraft.role}
                    onChange={e => setContactDraft({ ...contactDraft, role: e.target.value })}>
                    {CONTACT_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">聯絡方式（分機、手機、LINE…）</span>
                  <input className="input" value={contactDraft.contact}
                    onChange={e => setContactDraft({ ...contactDraft, contact: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">備註（負責範圍、可協助時段…）</span>
                  <input className="input" value={contactDraft.note}
                    onChange={e => setContactDraft({ ...contactDraft, note: e.target.value })} />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-zinc-600">排序</span>
                  <input className="input !w-24" inputMode="numeric" value={contactDraft.sortText}
                    onChange={e => setContactDraft({ ...contactDraft, sortText: e.target.value })} />
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm text-zinc-700">
                  <input type="checkbox" checked={contactDraft.active}
                    onChange={e => setContactDraft({ ...contactDraft, active: e.target.checked })} />
                  顯示於教師端
                </label>
              </div>
              <div className="flex justify-between">
                {contactDraft.id ? (
                  <button className="btn-danger" onClick={() => deleteContact(contactDraft)}>刪除人員</button>
                ) : <span />}
                <span className="flex gap-2">
                  <button className="btn-secondary" onClick={() => setContactDraft(null)}>取消</button>
                  <button className="btn-primary" disabled={!contactDraft.name.trim()} onClick={() => saveContact(contactDraft)}>儲存</button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ 警告門檻 ============ */}
      {tab === 'sla' && (
        <div className="card max-w-xl space-y-3">
          <div>
            <h2 className="font-medium text-zinc-900">案件警告門檻</h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              案件報表會依「距離報修經過的時間」上色提醒：超過黃色門檻顯示警告、超過紅色門檻顯示嚴重警告。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-600">黃色警告（小時）</span>
              <input className="input" inputMode="numeric" value={slaWarnText} placeholder="例：24"
                onChange={e => setSlaWarnText(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-zinc-600">紅色警告（小時）</span>
              <input className="input" inputMode="numeric" value={slaAlertText} placeholder="例：72"
                onChange={e => setSlaAlertText(e.target.value)} />
            </label>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={saveConfig}>儲存設定</button>
          </div>
        </div>
      )}
    </div>
  )
}
