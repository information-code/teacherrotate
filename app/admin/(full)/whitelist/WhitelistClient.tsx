'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { isVirtualEmail } from '@/lib/utils'

const GRADE_LABELS = ['一年級', '二年級', '三年級', '四年級', '五年級', '六年級']

// 聘任別：正式（全功能）、代理（配課選填＋設備借用）、鐘點（僅設備借用）、外師（協同英語，僅看課表）
type EmploymentType = 'formal' | 'substitute' | 'hourly' | 'foreign'
const EMPLOYMENT_LABELS: Record<string, string> = {
  formal: '正式',
  substitute: '代理',
  hourly: '鐘點',
  foreign: '外師',
}

interface TeacherEntry {
  id: string
  name: string | null
  email: string
  role: string
  employment_type: string
  created_at: string
  logged_in: boolean
}

interface Props {
  entries: TeacherEntry[]
  isSuperAdmin: boolean
  year: number
}

type Hours = Record<string, Record<string, number>>
interface SplitInfo {
  name: string | null
  hours: Hours
  perClass: Record<string, number>
  openClasses: Record<string, { ck: string; label: string; mine?: boolean }[]>   // `科目|年級` → 還沒指派老師的班（mine＝已經是這個待聘帳號的）
  blockers: { lessonHours: number; lessons: string[]; classes: string[] }
  candidates: { id: string; name: string | null; email: string }[]
}
const sumHours = (h: Hours) => Object.values(h ?? {}).reduce((s, byG) => s + Object.values(byG ?? {}).reduce((t, v) => t + (Number(v) || 0), 0), 0)

export default function WhitelistClient({ entries: initial, isSuperAdmin, year }: Props) {
  const router = useRouter()
  const [entries, setEntries] = useState<TeacherEntry[]>(initial)

  // 新增
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType>('formal')
  const [virtualMode, setVirtualMode] = useState(false)          // 待聘（虛擬）帳號
  const [virtualRole, setVirtualRole] = useState<'subject' | 'homeroom' | 'hourly' | 'foreign'>('subject')   // 待聘職務：代理科任／代理導師／鐘點／外師
  const [virtualGrade, setVirtualGrade] = useState(1)
  const [addError, setAddError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [empTogglingId, setEmpTogglingId] = useState<string | null>(null)

  // 搜尋
  const [query, setQuery] = useState('')

  // 編輯 email（虛擬帳號轉正時同時可改姓名）
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  // 拆分：從待聘帳號拆一塊配課給找到的老師，其餘原地保留繼續找人（可重複做）
  const [splitId, setSplitId] = useState<string | null>(null)
  const [splitInfo, setSplitInfo] = useState<SplitInfo | null>(null)
  const [splitErr, setSplitErr] = useState('')
  const [splitBusy, setSplitBusy] = useState(false)
  const [take, setTake] = useState<Hours>({})
  const [picks, setPicks] = useState<Record<string, string[]>>({})   // 科目 → classKey[]
  const [splitMode, setSplitMode] = useState<'convert' | 'split'>('split')
  const [to, setTo] = useState<{ mode: 'create' | 'merge'; email: string; name: string }>({ mode: 'create', email: '', name: '' })

  async function openSplit(id: string, mode: 'convert' | 'split') {
    setSplitId(id); setSplitInfo(null); setSplitErr(''); setSplitBusy(true); setSplitMode(mode)
    setTake({}); setPicks({}); setTo({ mode: 'create', email: '', name: '' })
    try {
      const res = await fetch(`/api/admin/whitelist/split?id=${id}&year=${year}`)
      const d = await res.json()
      if (!res.ok) { setSplitErr(d.error ?? '載入失敗'); return }
      setSplitInfo(d)
      if (mode === 'convert') {
        // 轉正＝整份都歸他，節數不必再填一次；已經指派給這個待聘帳號的班先勾起來
        setTake(d.hours as Hours)
        const pre: Record<string, string[]> = {}
        for (const [k, list] of Object.entries(d.openClasses ?? {}) as [string, { ck: string; mine?: boolean }[]][]) {
          const subj = k.split('|')[0]
          const mine = list.filter(c => c.mine).map(c => c.ck)
          if (mine.length) pre[subj] = [...(pre[subj] ?? []), ...mine]
        }
        setPicks(pre)
      }
    } finally { setSplitBusy(false) }
  }
  const setTakeAt = (subj: string, g: string, v: number, max: number) =>
    setTake(prev => ({ ...prev, [subj]: { ...(prev[subj] ?? {}), [g]: Math.max(0, Math.min(max, v || 0)) } }))
  const togglePick = (subj: string, ck: string) => setPicks(prev => {
    const cur = prev[subj] ?? []
    return { ...prev, [subj]: cur.includes(ck) ? cur.filter(x => x !== ck) : [...cur, ck] }
  })
  /** 這一科要指派幾個班（節數 ÷ 每班節數），以及已勾了幾個 */
  function classNeed(info: SplitInfo, subj: string) {
    const per = Number(info.perClass?.[subj]) || 1
    const hrs = Object.values(take[subj] ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
    const need = Math.round(hrs / per)
    const got = (picks[subj] ?? []).length
    return { per, need, got }
  }
  /** 勾選的班要落在有拆節數的那些年級 */
  const picksValid = (info: SplitInfo) => Object.keys(info.hours).every(subj => {
    const { need, got } = classNeed(info, subj)
    if (need !== got) return false
    return (picks[subj] ?? []).every(ck => (Number(take[subj]?.[ck.split('-')[0]]) || 0) > 0)
  })

  async function submitSplit() {
    if (!splitId || !splitInfo) return
    if (splitMode === 'split' && sumHours(take) <= 0) { setSplitErr('請填入這位老師能承擔的節數'); return }
    if (splitMode === 'convert' && to.mode !== 'merge' && !to.name.trim()) { setSplitErr('請填入老師姓名'); return }
    setSplitBusy(true); setSplitErr('')
    try {
      const res = await fetch('/api/admin/whitelist/split', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: splitId, year, mode: splitMode, to, hours: take, classes: picks }),
      })
      const d = await res.json()
      if (!res.ok) { setSplitErr(d.error ?? '拆分失敗'); return }
      setSplitId(null)
      alert(d.converted
        ? (to.mode === 'merge'
          ? `已併入既有帳號，並指派 ${d.assigned ?? 0} 個班。\n配課已加進對方的配課裡，待聘帳號已刪除。`
          : `已轉正，並指派 ${d.assigned ?? 0} 個班。\n這個帳號的 ID 沒有變，設定與課表的引用原地生效。`)
        : `已拆出 ${d.taken} 節、指派 ${d.assigned ?? 0} 個班給這位老師。\n`
          + (d.remaining > 0
            ? `「${splitInfo.name ?? ''}」還剩 ${d.remaining} 節，繼續找人。`
            : `「${splitInfo.name ?? ''}」已經沒有剩餘配課，可以刪除這個待聘帳號了。`))
      router.refresh()
    } finally { setSplitBusy(false) }
  }

  // 刪除
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 角色切換
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filtered = entries.filter(e => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (e.name ?? '').toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
  })
  const admins = filtered.filter(e => e.role === 'admin')
  const loggedIn = filtered.filter(e => e.role === 'teacher' && e.logged_in)
  const pending = filtered.filter(e => e.role === 'teacher' && !e.logged_in)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    setSubmitting(true)
    const res = await fetch('/api/admin/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(virtualMode
        ? { name, virtual: true, virtualRole, virtualGrade: virtualRole === 'homeroom' ? virtualGrade : undefined }
        : { name, email, employmentType }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setAddError(data.error ?? '新增失敗'); return }
    setEntries(prev => [...prev, data].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-TW')))
    setName('')
    setEmail('')
    setEmploymentType('formal')
    router.refresh()
  }

  async function handleChangeEmployment(entry: TeacherEntry, next: string) {
    if (next === entry.employment_type) return
    if (!confirm(`將「${entry.name ?? entry.email}」改為${EMPLOYMENT_LABELS[next] ?? next}教師？`)) return
    setEmpTogglingId(entry.id)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, employment_type: next }),
    })
    setEmpTogglingId(null)
    if (!res.ok) return
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, employment_type: next } : e))
    router.refresh()
  }

  async function handleSaveEmail(id: string, withName: boolean) {
    setEditError('')
    setSaving(true)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withName ? { id, email: editEmail, name: editName } : { id, email: editEmail }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      // 待聘帳號撞到既有老師 → 詢問是否合併（配課帶過去、引用改指、刪除待聘帳號）
      if (data.canMerge) {
        const ok = confirm(
          `此 Email 屬於既有老師「${data.conflictName ?? '（未知）'}」。\n\n` +
          `要將此待聘帳號合併過去嗎？\n` +
          `・配課資料轉移給既有老師（同年度以待聘帳號的配課為準）\n` +
          `・配班、排課、撕榜引用全部改指既有老師\n` +
          `・待聘帳號隨後刪除（無法復原）`,
        )
        if (!ok) return
        setSaving(true)
        const res2 = await fetch('/api/admin/whitelist', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, email: editEmail, merge: true }),
        })
        const data2 = await res2.json()
        setSaving(false)
        if (!res2.ok) { setEditError(data2.error ?? '合併失敗'); return }
        setEntries(prev => prev.filter(e => e.id !== id))
        setEditingId(null)
        alert(`已合併到「${data2.target?.name ?? ''}」，待聘帳號已刪除。`)
        router.refresh()
        return
      }
      setEditError(data.error ?? '儲存失敗')
      return
    }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, email: data.email, name: data.name ?? e.name } : e))
    setEditingId(null)
    router.refresh()
  }

  async function handleDelete(id: string, name: string | null) {
    if (!confirm(`確定刪除「${name ?? email}」的帳號？`)) return
    setDeletingId(id)
    const res = await fetch(`/api/admin/whitelist?id=${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (!res.ok) return
    setEntries(prev => prev.filter(e => e.id !== id))
    router.refresh()
  }

  async function handleToggleRole(entry: TeacherEntry) {
    const newRole = entry.role === 'admin' ? 'teacher' : 'admin'
    const label = newRole === 'admin' ? `設「${entry.name ?? entry.email}」為管理員？` : `移除「${entry.name ?? entry.email}」的管理員權限？`
    if (!confirm(label)) return
    setTogglingId(entry.id)
    const res = await fetch('/api/admin/whitelist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, role: newRole }),
    })
    setTogglingId(null)
    if (!res.ok) return
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, role: newRole } : e))
    router.refresh()
  }

  function renderRow(entry: TeacherEntry) {
    const isEditing = editingId === entry.id
    const virtual = isVirtualEmail(entry.email)
    return (
      <div key={entry.id} className="py-2.5 border-b border-zinc-100 last:border-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-800">{entry.name ?? '（未填）'}</span>
              {entry.role === 'admin' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-white rounded-sm">管理員</span>
              )}
              {virtual && (
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-sm">待聘</span>
              )}
              {entry.employment_type === 'substitute' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-700 border border-sky-200 rounded-sm">代理</span>
              )}
              {entry.employment_type === 'hourly' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 border border-violet-200 rounded-sm">鐘點</span>
              )}
              {entry.employment_type === 'foreign' && (
                <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 border border-rose-200 rounded-sm">外師</span>
              )}
            </div>
            {isEditing ? (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                {virtual && (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="真實姓名"
                    className="input text-xs py-1 w-28"
                    autoFocus
                  />
                )}
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder={virtual ? '真實 Google Email' : ''}
                  className="input text-xs py-1"
                  autoFocus={!virtual}
                />
                <button onClick={() => handleSaveEmail(entry.id, virtual)} disabled={saving} className="btn-primary text-xs py-1 px-2 whitespace-nowrap">
                  {saving ? '儲存中...' : virtual ? '轉正' : '儲存'}
                </button>
                <button onClick={() => setEditingId(null)} className="text-xs text-zinc-400 hover:text-zinc-600">取消</button>
              </div>
            ) : (
              <span className="text-xs text-zinc-400 ml-0">
                {virtual ? '尚未綁定 Email——考上後點「轉正」填入真實姓名與信箱' : entry.email}
              </span>
            )}
            {isEditing && editError && <p className="text-xs text-red-500 mt-1">{editError}</p>}
          </div>
          {!isEditing && (
            <div className="flex items-center gap-3 flex-shrink-0">
              {isSuperAdmin && (
                <button
                  onClick={() => handleToggleRole(entry)}
                  disabled={togglingId === entry.id}
                  className="text-xs text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
                >
                  {entry.role === 'admin' ? '移除管理員' : '設為管理員'}
                </button>
              )}
              {entry.role !== 'admin' && (
                // 值綁 entries state：confirm 取消時 state 未變，select 自動回到原值
                <select
                  value={entry.employment_type}
                  onChange={e => handleChangeEmployment(entry, e.target.value)}
                  disabled={empTogglingId === entry.id}
                  className="text-xs text-zinc-500 border border-zinc-200 rounded-sm px-1 py-0.5 bg-white disabled:opacity-40"
                >
                  <option value="formal">正式</option>
                  <option value="substitute">代理</option>
                  <option value="hourly">鐘點</option>
                  <option value="foreign">外師</option>
                </select>
              )}
              <button onClick={() => virtual
                ? openSplit(entry.id, 'convert')
                : (setEditingId(entry.id), setEditEmail(entry.email), setEditName(entry.name ?? ''), setEditError(''))}
                title={virtual ? '這位老師承擔全部課務：改成真實姓名信箱，並指派班級' : undefined}
                className={`text-xs whitespace-nowrap ${virtual ? 'text-amber-600 hover:text-amber-700 font-medium' : 'text-zinc-400 hover:text-zinc-700'}`}>
                {virtual ? '轉正' : '改 Email'}
              </button>
              {virtual && (
                <button onClick={() => openSplit(entry.id, 'split')}
                  title="找到老師只能承擔部分課務時：拆一塊配課給他，其餘留在這個待聘帳號繼續找人"
                  className="text-xs whitespace-nowrap text-sky-600 hover:text-sky-700 font-medium">拆一部分</button>
              )}
              <button
                onClick={() => handleDelete(entry.id, entry.name)}
                disabled={deletingId === entry.id}
                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
              >
                刪除
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const rest = (subj: string, g: string, orig: number) => orig - (Number(take[subj]?.[g]) || 0)
  const splitDialog = splitId && (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={() => !splitBusy && setSplitId(null)}>
      <div className="card w-full max-w-2xl my-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold">{splitMode === 'convert' ? '待聘帳號轉正' : '拆出部分配課'}</h2>
          <span className="text-sm text-zinc-500">{splitInfo?.name ?? ''}</span>
          <button onClick={() => setSplitId(null)} disabled={splitBusy}
            className="ml-auto text-zinc-400 hover:text-zinc-700 text-sm">✕</button>
        </div>

        {splitBusy && !splitInfo && <p className="text-sm text-zinc-400 py-6 text-center">載入中…</p>}
        {splitErr && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{splitErr}</p>}

        {splitInfo && (splitInfo.blockers.lessonHours > 0 || splitInfo.blockers.classes.length > 0) && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2 space-y-1">
            <div className="font-medium">這個帳號在課表上已經有課，不能拆分</div>
            {splitInfo.blockers.lessonHours > 0 && (
              <div className="text-xs">・已排 {splitInfo.blockers.lessonHours} 節：{splitInfo.blockers.lessons.join('、')}</div>
            )}
            {splitInfo.blockers.classes.length > 0 && (
              <div className="text-xs">・已指派配班：{splitInfo.blockers.classes.join('、')}</div>
            )}
            <div className="text-xs opacity-80">拆分只分配課，分不了「哪幾堂歸誰」——請先在排課工具處理掉再回來。</div>
          </div>
        )}

        {splitInfo && splitInfo.blockers.lessonHours === 0 && splitInfo.blockers.classes.length === 0 && (
          Object.keys(splitInfo.hours).length === 0
            ? <p className="text-sm text-zinc-400">這個帳號已經沒有配課了，可以直接刪除。</p>
            : <>
              <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-sm px-3 py-2">
                {splitMode === 'convert'
                  ? <>找到的老師能承擔<b>全部</b>課務時用這個。配課整份歸他、<b>帳號 ID 不變</b>，
                    設定與課表裡原本指向這個待聘帳號的引用會原地生效。下面順便把班級指派掉。</>
                  : <>找到一位老師只能承擔<b>部分</b>課務時用這個。填入他實際能上的節數，
                    其餘<b>原地留在「{splitInfo.name}」繼續找人</b>——之後再找到人可以再拆一次。</>}
              </p>
              <div className="border border-zinc-200 rounded-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">配課</th>
                      <th className="px-2 py-1.5 font-medium w-16">原本</th>
                      <th className="px-2 py-1.5 font-medium w-24">{splitMode === 'convert' ? '歸這位老師' : '拆給老師'}</th>
                      {splitMode === 'split' && <th className="px-2 py-1.5 font-medium w-24">留在待聘</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(splitInfo.hours).flatMap(([subj, byG]) =>
                      Object.entries(byG).filter(([, n]) => Number(n) > 0).map(([g, n]) => (
                        <tr key={`${subj}|${g}`} className="border-t border-zinc-100">
                          <td className="px-3 py-1.5">{subj} <span className="text-zinc-400 text-xs">{GRADE_LABELS[Number(g) - 1] ?? `${g}年級`}</span></td>
                          <td className="text-center text-zinc-500 tabular-nums">{n}</td>
                          <td className="text-center py-1">
                            {splitMode === 'convert'
                              ? <span className="tabular-nums font-medium">{n}</span>
                              : <input type="number" min={0} max={Number(n)} value={Number(take[subj]?.[g]) || 0}
                                  onChange={e => setTakeAt(subj, g, Number(e.target.value), Number(n))}
                                  className="w-16 text-center border border-zinc-200 rounded-sm py-0.5 tabular-nums" />}
                          </td>
                          {splitMode === 'split' && (
                            <td className={`text-center tabular-nums ${rest(subj, g, Number(n)) === 0 ? 'text-zinc-300' : 'text-zinc-600'}`}>
                              {rest(subj, g, Number(n))}
                            </td>
                          )}
                        </tr>
                      )))}
                    <tr className="border-t border-zinc-200 bg-zinc-50 text-xs">
                      <td className="px-3 py-1.5 text-zinc-500">合計</td>
                      <td className="text-center tabular-nums">{sumHours(splitInfo.hours)}</td>
                      <td className="text-center tabular-nums font-medium text-sky-700">{sumHours(take)}</td>
                      {splitMode === 'split' && <td className="text-center tabular-nums font-medium">{sumHours(splitInfo.hours) - sumHours(take)}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>

              {sumHours(take) > 0 && Object.keys(splitInfo.hours).map(subj => {
                const { per, need, got } = classNeed(splitInfo, subj)
                if (need <= 0) return null
                const grades = Object.entries(take[subj] ?? {}).filter(([, n]) => Number(n) > 0).map(([g]) => g)
                return (
                  <div key={subj} className="border border-zinc-200 rounded-sm p-3 space-y-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium">{subj}　這位老師上哪幾個班</span>
                      <span className={`text-xs ${got === need ? 'text-green-600' : 'text-amber-600'}`}>
                        需要 {need} 班（每班 {per} 節）・已選 {got} 班
                      </span>
                    </div>
                    {grades.map(g => (
                      <div key={g} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-zinc-400 w-14">{GRADE_LABELS[Number(g) - 1] ?? `${g}年級`}</span>
                        {(splitInfo.openClasses?.[`${subj}|${g}`] ?? []).length === 0
                          ? <span className="text-xs text-zinc-400">（這個年級沒有待指派的班）</span>
                          : (splitInfo.openClasses[`${subj}|${g}`]).map(c => {
                            const on = (picks[subj] ?? []).includes(c.ck)
                            return (
                              <button key={c.ck} type="button" onClick={() => togglePick(subj, c.ck)}
                                className={`text-xs px-2 py-0.5 rounded-sm border ${on
                                  ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
                                {c.label}
                              </button>
                            )
                          })}
                      </div>
                    ))}
                    <p className="text-[11px] text-zinc-400">
                      只列出還沒指派老師的班。不指定的話那幾節是懸空的——課表上那些班會繼續顯示「直播共學」。
                    </p>
                  </div>
                )
              })}

              <div className="border border-zinc-200 rounded-sm p-3 space-y-2">
                <div className="text-sm font-medium">{splitMode === 'convert' ? '這位老師是' : '拆給誰'}</div>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={to.mode !== 'merge'} onChange={() => setTo({ ...to, mode: 'create', email: '' })} />
                    {splitMode === 'convert' ? '這個帳號轉正（ID 不變）' : '新建帳號'}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={to.mode === 'merge'} onChange={() => setTo({ ...to, mode: 'merge', email: '' })} />
                    併到既有帳號
                  </label>
                </div>
                {to.mode === 'merge' ? (
                  <select value={to.email} onChange={e => setTo({ ...to, email: e.target.value })} className="input text-sm w-full">
                    <option value="">選擇既有帳號…</option>
                    {(splitInfo.candidates ?? []).map(c => (
                      <option key={c.id} value={c.email}>{c.name ?? c.email}（{c.email}）</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input value={to.name} onChange={e => setTo({ ...to, name: e.target.value })}
                      placeholder="姓名" className="input text-sm w-32" />
                    <input value={to.email} onChange={e => setTo({ ...to, email: e.target.value })}
                      placeholder="真實 Email" className="input text-sm flex-1" />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <p className="text-xs text-zinc-400 flex-1">
                  {to.mode === 'merge'
                    ? '併入時是把節數加進去，不會蓋掉對方原本的配課；設定與課表的引用會一併改指，待聘帳號隨後刪除。'
                    : splitMode === 'convert'
                      ? '帳號 ID 不變，配課不動——只改姓名信箱，並把班級指派掉。'
                      : '新建一個帳號給這位老師。'}
                </p>
                <button onClick={() => setSplitId(null)} disabled={splitBusy} className="btn btn-secondary text-sm">取消</button>
                <button onClick={submitSplit}
                  disabled={splitBusy || !to.email.trim() || sumHours(take) <= 0 || !picksValid(splitInfo)}
                  title={!picksValid(splitInfo) ? '要選滿對應的班級數才能送出' : undefined}
                  className="btn btn-primary text-sm">
                  {splitBusy ? '處理中…'
                    : splitMode === 'convert' ? (to.mode === 'merge' ? '併入並指派班級' : '轉正並指派班級')
                    : `拆出 ${sumHours(take)} 節`}
                </button>
              </div>
            </>
        )}
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl space-y-6">
      {splitDialog}
      <div className="flex items-center justify-between">
        <h1 className="page-title">帳號資料</h1>
        <div className="text-sm text-zinc-400">
          共 {entries.length} 位 ·
          <span className="text-zinc-600 ml-1">管理員 {entries.filter(e => e.role === 'admin').length}</span> ·
          <span className="text-zinc-600 ml-1">已登入 {entries.filter(e => e.role === 'teacher' && e.logged_in).length}</span> ·
          <span className="text-amber-500 ml-1">待登入 {entries.filter(e => e.role === 'teacher' && !e.logged_in).length}</span>
        </div>
      </div>

      {/* 新增表單 */}
      <div className="card">
        <h2 className="text-sm font-medium text-zinc-700 mb-3">新增教師帳號</h2>
        <form onSubmit={handleAdd} className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-32">
            <label className="block text-xs text-zinc-500 mb-1">姓名</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={virtualMode ? (virtualRole === 'hourly' ? '待聘鐘點A' : virtualRole === 'foreign' ? '待聘外師A' : '待聘代理A') : '王小明'} required className="input" />
          </div>
          {!virtualMode && (
            <>
              <div className="flex-[2] min-w-48">
                <label className="block text-xs text-zinc-500 mb-1">Google 登入 Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teacher@gmail.com" required className="input" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">聘任別</label>
                <select value={employmentType} onChange={e => setEmploymentType(e.target.value as EmploymentType)} className="input">
                  <option value="formal">正式</option>
                  <option value="substitute">代理</option>
                  <option value="hourly">鐘點</option>
                  <option value="foreign">外師</option>
                </select>
              </div>
            </>
          )}
          {virtualMode && (
            <>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">預定職務</label>
                <select value={virtualRole} onChange={e => setVirtualRole(e.target.value as 'subject' | 'homeroom' | 'hourly' | 'foreign')} className="input">
                  <option value="subject">代理科任</option>
                  <option value="homeroom">代理導師</option>
                  <option value="hourly">鐘點教師</option>
                  <option value="foreign">外師（協同英語）</option>
                </select>
              </div>
              {virtualRole === 'homeroom' && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">年級</label>
                  <select value={virtualGrade} onChange={e => setVirtualGrade(Number(e.target.value))} className="input">
                    {GRADE_LABELS.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
            {submitting ? '新增中...' : virtualMode ? '新增待聘帳號' : '新增'}
          </button>
        </form>
        <label className="flex items-center gap-1.5 mt-2 text-xs text-zinc-500">
          <input type="checkbox" checked={virtualMode} onChange={e => setVirtualMode(e.target.checked)} />
          待聘（虛擬）帳號——甄選未放榜先建帳號假性配課排課（代理／鐘點／外師皆可），考上後點「轉正」填入真實姓名與 Email，
          所有配課、配班、排課自動保留
        </label>
        {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
      </div>

      {/* 搜尋 */}
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋姓名或 Email..." className="input" />

      {/* 管理員 */}
      {admins.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-1">
            管理員
            {!isSuperAdmin && <span className="ml-2 text-xs text-zinc-400 font-normal">需超級管理員才能新增或移除</span>}
          </h2>
          <div>{admins.map(renderRow)}</div>
        </div>
      )}

      {/* 待登入教師 */}
      {pending.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-1">
            待登入
            <span className="ml-2 text-xs text-amber-500 font-normal">帳號已建立，尚未登入過</span>
          </h2>
          <div>{pending.map(renderRow)}</div>
        </div>
      )}

      {/* 已登入教師 */}
      {loggedIn.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-medium text-zinc-700 mb-1">
            已登入
            <span className="ml-2 text-xs text-zinc-400 font-normal">已完成 Google 驗證</span>
          </h2>
          <div>{loggedIn.map(renderRow)}</div>
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">
          {query ? '無符合結果' : '尚無任何帳號'}
        </p>
      )}
    </div>
  )
}
