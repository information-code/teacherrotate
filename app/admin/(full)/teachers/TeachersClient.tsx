'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  EMAIL_HEADER,
  READONLY_HEADERS,
  TEACHER_COLUMNS,
  formatCell,
} from '@/lib/teacher-io'
import type { Profile, ExperienceItem } from '@/types/database'

type SpecialtyKey = keyof Pick<Profile,
  'local_language' | 'four_language' | 'sea_language' | 'sign_language' |
  'local_language_qualifications' | 'english_specialty' | 'english_specialty_20' |
  'english_specialty_cef' | 'guidance_specialty_qua' | 'guidance_specialty_graduate' |
  'guidance_specialty' | 'bilingual_specialty' | 'nature_specialty' |
  'tech_specialty' | 'life_specialty'
>

const SPECIALTY_GROUPS: { group: string; tags: { key: SpecialtyKey; label: string }[] }[] = [
  {
    group: '本土語',
    tags: [
      { key: 'local_language',                label: '閩南語' },
      { key: 'four_language',                 label: '客語四線' },
      { key: 'sea_language',                  label: '客語海線' },
      { key: 'sign_language',                 label: '手語' },
      { key: 'local_language_qualifications', label: '教支資格' },
    ],
  },
  {
    group: '英語',
    tags: [
      { key: 'english_specialty',    label: '英語專長' },
      { key: 'english_specialty_20', label: '20學分班' },
      { key: 'english_specialty_cef', label: 'CEF B2' },
    ],
  },
  {
    group: '輔導',
    tags: [
      { key: 'guidance_specialty_qua',      label: '專輔資格' },
      { key: 'guidance_specialty_graduate', label: '輔導相關系所' },
      { key: 'guidance_specialty',          label: '輔導專長' },
    ],
  },
  {
    group: '特殊專長',
    tags: [
      { key: 'bilingual_specialty', label: '雙語' },
      { key: 'nature_specialty',    label: '自然' },
      { key: 'tech_specialty',      label: '資訊' },
      { key: 'life_specialty',      label: '生活研習' },
    ],
  },
]

interface Props {
  profiles: Profile[]
  kanpuYearsMap: Record<string, number>
}

export default function TeachersClient({ profiles, kanpuYearsMap }: Props) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<SpecialtyKey | null>(null)
  const [selected, setSelected] = useState<Profile | null>(null)
  const [localProfiles, setLocalProfiles] = useState<Profile[]>(profiles)
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLocalProfiles(profiles) }, [profiles])

  function handleExport() {
    const headers = [EMAIL_HEADER, ...TEACHER_COLUMNS.map(c => c.header), ...READONLY_HEADERS]
    const rows = localProfiles.map(p => {
      const row: Record<string, string | number> = { [EMAIL_HEADER]: p.email }
      for (const col of TEACHER_COLUMNS) {
        row[col.header] = formatCell(col, (p as unknown as Record<string, unknown>)[col.field])
      }
      row[READONLY_HEADERS[0]] = kanpuYearsMap[p.id] ?? 0
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
    ws['!cols'] = headers.map(h => ({ wch: h === EMAIL_HEADER ? 28 : Math.max(8, h.length * 2 + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '教師名單')
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    XLSX.writeFile(wb, `教師名單_${stamp}.xlsx`)
  }

  const filtered = localProfiles
    .filter(p => {
      const q = query.trim().toLowerCase()
      const matchText = !q || (p.name ?? '').includes(q) || p.email.toLowerCase().includes(q)
      const matchTag = !activeTag || p[activeTag] === true
      return matchText && matchTag
    })
    .sort((a, b) => {
      if (a.status === b.status) return 0
      return a.status === 'inactive' ? 1 : -1
    })

  async function toggleStatus(profile: Profile) {
    const newStatus = profile.status === 'active' ? 'inactive' : 'active'
    const res = await fetch('/api/admin/teacher-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: profile.id, status: newStatus }),
    })
    if (!res.ok) return
    const updated = { ...profile, status: newStatus }
    setLocalProfiles(prev => prev.map(p => p.id === profile.id ? updated : p))
    setSelected(updated)
  }

  return (
    <div className="flex flex-col md:flex-row h-full -m-3 md:-m-6 overflow-hidden">
      {/* 左側：搜尋 + 名單（手機改為上方、限高可捲動） */}
      <div className="w-full md:w-72 flex-shrink-0 max-h-60 md:max-h-none border-b md:border-r border-zinc-200 flex flex-col bg-white print:hidden">
        {/* 批次作業 */}
        <div className="px-3 pt-3 flex gap-2">
          <button onClick={handleExport} className="btn-secondary text-xs flex-1 py-1">⬇ 匯出名單</button>
          <button onClick={() => setImportOpen(true)} className="btn-secondary text-xs flex-1 py-1">⬆ 批次匯入</button>
        </div>
        {/* 搜尋 */}
        <div className="px-3 pt-2 pb-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋姓名或信箱..."
            className="input"
          />
        </div>
        {/* 專長篩選（分組） */}
        <div className="px-3 pb-3 border-b border-zinc-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">專長篩選</span>
            {activeTag && (
              <button onClick={() => setActiveTag(null)} className="text-xs text-zinc-400 hover:text-zinc-700">
                清除
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {SPECIALTY_GROUPS.map(({ group, tags }) => (
              <div key={group} className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-400 w-12 flex-shrink-0">{group}</span>
                <div className="flex flex-wrap gap-1">
                  {tags.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTag(activeTag === key ? null : key)}
                      className={`text-xs px-1.5 py-0.5 border transition-colors ${
                        activeTag === key
                          ? 'bg-zinc-800 text-white border-zinc-800'
                          : 'text-zinc-500 border-zinc-200 hover:border-zinc-400 hover:text-zinc-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-zinc-400 p-4">無符合結果</p>
          )}
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                selected?.id === p.id ? 'bg-zinc-100' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-zinc-900 text-sm">{p.name ?? '（未填姓名）'}</span>
                {p.status === 'inactive' && (
                  <span className="text-xs px-1 border border-red-300 text-red-400">離校</span>
                )}
              </div>
              <div className="text-xs text-zinc-400 truncate">{p.email}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-zinc-100 text-xs text-zinc-400">
          <div className="flex justify-between">
            <span>總計 <span className="font-medium text-zinc-600">{localProfiles.length}</span> 位</span>
            <span>在校 <span className="font-medium text-zinc-600">{localProfiles.filter(p => p.status !== 'inactive').length}</span> 位</span>
            <span>離校 <span className="font-medium text-red-400">{localProfiles.filter(p => p.status === 'inactive').length}</span> 位</span>
          </div>
        </div>
      </div>

      {/* 右側：履歷 */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {!selected ? (
          <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
            請從左側選擇教師以查看履歷
          </div>
        ) : (
          <TeacherResume
            profile={selected}
            kanpuYears={kanpuYearsMap[selected.id] ?? 0}
            onToggleStatus={() => toggleStatus(selected)}
            onUpdateOtherSchoolYears={async years => {
              const res = await fetch('/api/admin/teacher-other-school-years', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teacher_id: selected.id, other_school_years: years }),
              })
              if (!res.ok) return false
              const updated = { ...selected, other_school_years: years }
              setLocalProfiles(prev => prev.map(p => p.id === selected.id ? updated : p))
              setSelected(updated)
              return true
            }}
            onUpdateKanpuSubstituteYears={async years => {
              const res = await fetch('/api/admin/teacher-kanpu-substitute-years', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teacher_id: selected.id, kanpu_substitute_years: years }),
              })
              if (!res.ok) return false
              const updated = { ...selected, kanpu_substitute_years: years }
              setLocalProfiles(prev => prev.map(p => p.id === selected.id ? updated : p))
              setSelected(updated)
              return true
            }}
          />
        )}
      </div>

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); setSelected(null); router.refresh() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 批次匯入：解析 xlsx → 預覽差異 → 確認寫入
// ─────────────────────────────────────────────────────────────

interface ChangeRow { header: string; from: string; to: string }
interface Preview {
  recognizedColumns: string[]
  ignoredColumns: string[]
  updates: { id: string; email: string; name: string | null; changes: ChangeRow[] }[]
  creates: { email: string; name: string | null }[]
  unchanged: number
  errors: string[]
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setError(''); setPreview(null); setResult(null); setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      // defval:'' → 空白格也會產生鍵，才分得出「這欄沒出現」和「這欄留白」
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        wb.Sheets[wb.SheetNames[0]], { defval: '' }
      )
      if (parsed.length === 0) { setError('檔案沒有資料列'); return }
      setRows(parsed)
      setFileName(file.name)
      const res = await fetch('/api/admin/teacher-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed, commit: false }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '解析失敗'); return }
      setPreview(data)
    } catch {
      setError('檔案解析失敗，請確認為正確的 .xlsx 格式')
    } finally {
      setBusy(false)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    maxFiles: 1,
  })

  async function handleCommit() {
    if (!preview) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/admin/teacher-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, commit: true }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '匯入失敗'); return }
      const parts = [`更新 ${data.updated} 位`, `新增 ${data.created} 位`, `未變更 ${data.unchanged} 位`]
      setResult(parts.join('、'))
      setPreview(null)
      if ((data.failed ?? []).length > 0) setError((data.failed as string[]).join('\n'))
    } finally {
      setBusy(false)
    }
  }

  const nothingToDo = preview && preview.updates.length === 0 && preview.creates.length === 0
  const blocked = !!preview && preview.errors.length > 0

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={() => !busy && onClose()}
    >
      <div className="card w-full max-w-3xl my-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">批次匯入教師資料</h2>
          <button onClick={onClose} disabled={busy} className="text-sm text-zinc-400 hover:text-zinc-700">關閉</button>
        </div>

        <div className="text-xs text-zinc-500 space-y-1 border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p>請先按「⬇ 匯出名單」下載現有資料，改完再上傳同一份檔案。</p>
          <p><code>{EMAIL_HEADER}</code> 是比對鍵，<strong>請勿修改</strong>；要改 email 請到「白名單」頁。</p>
          <p>標題列<strong>沒有</strong>的欄位一律不動；有這欄但格子<strong>留白</strong>＝清空（勾選欄變未勾、年資變 0）。所以只想改幾欄時，可以只留 <code>{EMAIL_HEADER}</code> 和那幾欄。</p>
          <p>「在校狀態」填<strong>離校</strong>即可批次設定離校；系統裡沒有的 email 會列為新增，確認後才建立帳號。</p>
          <p>從檔案裡<strong>刪掉某一列不會刪帳號</strong>，只是那個人這次不處理；要讓人消失請填「離校」。</p>
        </div>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-sm p-6 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-zinc-500 bg-zinc-50' : 'border-zinc-300 hover:border-zinc-400'
          }`}
        >
          <input {...getInputProps()} />
          <p className="text-sm text-zinc-500">
            {fileName ? `已選擇：${fileName}（點擊可重新選擇）` : '拖放 .xlsx 檔案至此，或點擊選擇'}
          </p>
        </div>

        {busy && <p className="text-sm text-zinc-400">處理中...</p>}

        {error && (
          <div className="px-3 py-2 border border-red-200 bg-red-50 text-sm text-red-700 whitespace-pre-wrap">
            {error}
          </div>
        )}

        {result && (
          <div className="flex items-center justify-between px-3 py-2 border border-green-200 bg-green-50 text-sm text-green-800">
            <span>匯入完成：{result}</span>
            <button onClick={onDone} className="btn-primary text-sm">回到名單</button>
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            {preview.ignoredColumns.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
                以下欄位不認得，已忽略：{preview.ignoredColumns.join('、')}
              </p>
            )}

            {preview.errors.length > 0 && (
              <div className="border border-red-200 bg-red-50 px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                <p className="text-xs font-medium text-red-700">有 {preview.errors.length} 個問題，修正後才能匯入：</p>
                {preview.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}

            <div className="flex gap-4 text-sm text-zinc-600">
              <span>更新 <strong className="text-zinc-900">{preview.updates.length}</strong> 位</span>
              <span>新增 <strong className="text-green-700">{preview.creates.length}</strong> 位</span>
              <span className="text-zinc-400">未變更 {preview.unchanged} 位</span>
            </div>

            {preview.creates.length > 0 && (
              <div className="border border-green-200">
                <div className="px-3 py-1.5 bg-green-50 text-xs font-medium text-green-800">
                  將新增帳號（{preview.creates.length}）
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-zinc-100">
                  {preview.creates.map(c => (
                    <div key={c.email} className="px-3 py-1.5 text-sm">
                      <span className="font-medium text-zinc-900">{c.name ?? '（未填姓名）'}</span>
                      <span className="text-xs text-zinc-400 ml-2">{c.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.updates.length > 0 && (
              <div className="border border-zinc-200">
                <div className="px-3 py-1.5 bg-zinc-50 text-xs font-medium text-zinc-700">
                  將更新（{preview.updates.length}）— 點擊展開變更內容
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-zinc-100">
                  {preview.updates.map(u => (
                    <div key={u.id}>
                      <button
                        onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                        className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 flex items-center justify-between"
                      >
                        <span className="text-sm">
                          <span className="font-medium text-zinc-900">{u.name ?? '（未填姓名）'}</span>
                          <span className="text-xs text-zinc-400 ml-2">{u.email}</span>
                        </span>
                        <span className="text-xs text-zinc-500">{u.changes.length} 項變更</span>
                      </button>
                      {expanded === u.id && (
                        <div className="px-3 pb-2 space-y-0.5">
                          {u.changes.map(c => (
                            <div key={c.header} className="text-xs flex gap-2">
                              <span className="text-zinc-500 w-28 flex-shrink-0">{c.header}</span>
                              <span className="text-zinc-400 line-through">{c.from}</span>
                              <span className="text-zinc-400">→</span>
                              <span className="text-zinc-900 font-medium">{c.to}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {nothingToDo && !blocked && <span className="text-sm text-zinc-400">沒有需要變更的資料</span>}
              <button onClick={onClose} disabled={busy} className="btn-secondary">取消</button>
              <button
                onClick={handleCommit}
                disabled={busy || blocked || !!nothingToDo}
                className="btn-primary"
              >
                {busy ? '匯入中...' : `確認匯入（更新 ${preview.updates.length}、新增 ${preview.creates.length}）`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TeacherResume({
  profile,
  kanpuYears,
  onToggleStatus,
  onUpdateOtherSchoolYears,
  onUpdateKanpuSubstituteYears,
}: {
  profile: Profile
  kanpuYears: number
  onToggleStatus: () => void
  onUpdateOtherSchoolYears: (years: number) => Promise<boolean>
  onUpdateKanpuSubstituteYears: (years: number) => Promise<boolean>
}) {
  const [savingOther, setSavingOther] = useState(false)
  const [savingSubstitute, setSavingSubstitute] = useState(false)
  const [otherSaved, setOtherSaved] = useState(false)
  const [substituteSaved, setSubstituteSaved] = useState(false)

  const otherYearsNum = Number(profile.other_school_years ?? 0)
  const substituteNum = Number(profile.kanpu_substitute_years ?? 0)
  const kanpuTotal = kanpuYears + substituteNum
  const seniorityScore = kanpuTotal * 0.8 + otherYearsNum * 0.2

  async function commitYears(
    n: number,
    current: number,
    setSaving: (b: boolean) => void,
    setSaved: (b: boolean) => void,
    updater: (n: number) => Promise<boolean>,
  ) {
    const rounded = Math.round(n * 100) / 100
    if (rounded === current) return
    setSaving(true)
    const ok = await updater(rounded)
    setSaving(false)
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      alert('儲存失敗，請稍後再試')
    }
  }
  const experiences = (
    Array.isArray(profile.experience) ? profile.experience : []
  ) as unknown as ExperienceItem[]

  const languages = [
    profile.local_language && `閩南語${profile.local_language_grade ? `（${profile.local_language_grade}）` : ''}`,
    profile.four_language && `客語（四線）${profile.four_language_grade ? `（${profile.four_language_grade}）` : ''}`,
    profile.sea_language && `客語（海線）${profile.sea_language_grade ? `（${profile.sea_language_grade}）` : ''}`,
    profile.sign_language && `手語${profile.sign_language_grade ? `（${profile.sign_language_grade}）` : ''}`,
  ].filter(Boolean) as string[]

  const specialties = [
    profile.local_language_qualifications && '本土語教支資格',
    profile.english_specialty && '教師證加註英語專長',
    profile.english_specialty_20 && '英語 20 學分班',
    profile.english_specialty_cef && 'CEF B2 級以上英語加註專長',
    profile.guidance_specialty_qua && '具專輔資格',
    profile.guidance_specialty_graduate && '輔導／諮商／心理相關系所畢業',
    profile.guidance_specialty && '教師證加註輔導專長',
    profile.bilingual_specialty && '教師證加註雙語專長',
    profile.nature_specialty && '教師證加註自然專長',
    profile.tech_specialty && '教師證加註資訊專長',
    profile.life_specialty && '生活課程 12 小時以上研習',
  ].filter(Boolean) as string[]

  const textFields = [
    { label: '進修研習', value: profile.study_experience },
    { label: '研究發表', value: profile.research_publication },
    { label: '有效教學', value: profile.effective_teaching },
    { label: '公開課', value: profile.public_lesson },
    { label: '班級管理', value: profile.class_management },
    { label: '專業社群', value: profile.professional_community },
    { label: '公開講座', value: profile.public_lecture },
    { label: '特殊班級經營', value: profile.special_class_management },
    { label: '競賽指導', value: profile.competition_guidance },
    { label: '其他', value: profile.other },
  ].filter(f => f.value)

  const hasEducation = profile.university || profile.graduate_school || profile.credit_class || profile.other_education
  const hasLanguage = languages.length > 0 || profile.other_language_text || profile.english_specialty_grade
  const hasSpecialty = specialties.length > 0 || profile.other_checkbox

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <h2 className="page-title mb-0">個人履歷</h2>
          {profile.status === 'inactive' && (
            <span className="text-xs px-2 py-0.5 border border-red-300 text-red-500">離校</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleStatus}
            className={profile.status === 'inactive' ? 'btn-secondary' : 'btn-danger'}
          >
            {profile.status === 'inactive' ? '設為在校' : '設為已離校'}
          </button>
          <button onClick={() => window.print()} className="btn-secondary">
            列印 / 匯出 PDF
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {/* 基本資訊 */}
        <div className="card">
          <h1 className="text-xl font-semibold text-zinc-900 mb-1">
            {profile.name ?? '（未填姓名）'}
          </h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-500 mt-2">
            <span>{profile.email}</span>
            {profile.phone && <span>電話：{profile.phone}</span>}
            {profile.line_id && <span>Line：{profile.line_id}</span>}
          </div>
        </div>

        {/* 年資 */}
        <div className="card">
          <h3 className="resume-section-title">年資</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-zinc-500 mb-1">關埔正式年資（依工作紀錄）</div>
              <div className="text-lg font-semibold text-zinc-900">{kanpuYears} <span className="text-xs font-normal text-zinc-500 ml-0.5">年</span></div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">關埔代理年資（管理者填入）</div>
              <div className="flex items-center gap-2 print:hidden">
                <NumberInput
                  min={0}
                  max={60}
                  step={0.01}
                  value={substituteNum}
                  onChange={n => commitYears(n, substituteNum, setSavingSubstitute, setSubstituteSaved, onUpdateKanpuSubstituteYears)}
                  disabled={savingSubstitute}
                  className="input w-20 text-center py-0.5 text-sm font-semibold"
                />
                <span className="text-xs text-zinc-500">年</span>
                {savingSubstitute && <span className="text-xs text-zinc-400">儲存中...</span>}
                {substituteSaved && <span className="text-xs text-green-600">已儲存</span>}
              </div>
              <div className="hidden print:block text-lg font-semibold text-zinc-900">{substituteNum} <span className="text-xs font-normal text-zinc-500 ml-0.5">年</span></div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">他校年資（管理者填入）</div>
              <div className="flex items-center gap-2 print:hidden">
                <NumberInput
                  min={0}
                  max={60}
                  step={0.01}
                  value={otherYearsNum}
                  onChange={n => commitYears(n, otherYearsNum, setSavingOther, setOtherSaved, onUpdateOtherSchoolYears)}
                  disabled={savingOther}
                  className="input w-20 text-center py-0.5 text-sm font-semibold"
                />
                <span className="text-xs text-zinc-500">年</span>
                {savingOther && <span className="text-xs text-zinc-400">儲存中...</span>}
                {otherSaved && <span className="text-xs text-green-600">已儲存</span>}
              </div>
              <div className="hidden print:block text-lg font-semibold text-zinc-900">{otherYearsNum} <span className="text-xs font-normal text-zinc-500 ml-0.5">年</span></div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">年資積分</div>
              <div className="text-lg font-semibold text-zinc-900">{seniorityScore.toFixed(2)}</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">關埔 {kanpuTotal.toFixed(2)} × 0.8 + 他校 {otherYearsNum} × 0.2</div>
            </div>
          </div>
          <p className="text-[11px] text-zinc-400 mt-2">輪動積分相同時，以年資積分高者優先。關埔年資 = 正式（依 rotation 紀錄，已扣除留停／育嬰／借調／延長病假）+ 代理（手動填入）。</p>
        </div>

        {/* 學歷 */}
        {hasEducation && (
          <div className="card">
            <h3 className="resume-section-title">學歷</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {profile.university && (
                <div><span className="text-zinc-500">大學：</span>{profile.university}</div>
              )}
              {profile.graduate_school && (
                <div><span className="text-zinc-500">研究所：</span>{profile.graduate_school}</div>
              )}
              {profile.credit_class && (
                <div><span className="text-zinc-500">學分班：</span>{profile.credit_class}</div>
              )}
              {profile.other_education && (
                <div className="col-span-2"><span className="text-zinc-500">其他：</span>{profile.other_education}</div>
              )}
            </div>
          </div>
        )}

        {/* 語言專長 */}
        {hasLanguage && (
          <div className="card">
            <h3 className="resume-section-title">語言專長</h3>
            <div className="flex flex-wrap gap-2">
              {languages.map(l => (
                <span key={l} className="badge badge-default">{l}</span>
              ))}
              {profile.other_language_text && (
                <span className="badge badge-default">{profile.other_language_text}</span>
              )}
              {profile.english_specialty_grade && (
                <span className="badge badge-default">雙語增能學分班 {profile.english_specialty_grade}</span>
              )}
            </div>
          </div>
        )}

        {/* 教學專長與資格 */}
        {hasSpecialty && (
          <div className="card">
            <h3 className="resume-section-title">教學專長與資格</h3>
            <div className="flex flex-wrap gap-2">
              {specialties.map(s => (
                <span key={s} className="badge badge-success">{s}</span>
              ))}
              {profile.other_checkbox && (
                <span className="badge badge-default">{profile.other_checkbox}</span>
              )}
            </div>
          </div>
        )}

        {/* 自我描述 */}
        {textFields.length > 0 && (
          <div className="card">
            <h3 className="resume-section-title">自我描述</h3>
            <div className="space-y-4">
              {textFields.map(({ label, value }) => (
                <div key={label}>
                  <div className="text-xs font-medium text-zinc-500 mb-1">{label}</div>
                  <div className="text-sm text-zinc-800 whitespace-pre-wrap">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 服務經歷 */}
        {experiences.length > 0 && (
          <div className="card">
            <h3 className="resume-section-title">服務經歷</h3>
            <div className="space-y-2">
              {experiences.map((exp, i) => (
                <div key={i} className="flex gap-6 text-sm">
                  <span className="text-zinc-500 flex-shrink-0 w-16">{exp.year} 年度</span>
                  <span className="text-zinc-800">{exp.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
