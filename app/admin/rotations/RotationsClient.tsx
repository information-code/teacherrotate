'use client'

import { useState, useCallback, useEffect } from 'react'

const SKIP_WORKS = ['留職停薪', '育嬰留停', '借調']
const MIDLOW_WORKS = ['中年級導師', '低年級導師', '中年級接棒班', '低年級接棒班']
const MIDLOW_LIMIT = 8

function getMidLowConsecutiveYears(rotationsForTeacher: { year: number; work: string }[]): number {
  const sorted = [...rotationsForTeacher].sort((a, b) => b.year - a.year)
  let count = 0
  for (const r of sorted) {
    if (SKIP_WORKS.includes(r.work)) continue
    if (MIDLOW_WORKS.includes(r.work)) count++
    else break
  }
  return count
}


import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import { sortWorks, buildTimeline, getWorkCategory, CATEGORY_STYLE, groupWorks } from '@/lib/work-sort'

type Tab = '工作紀錄' | '工作歷程' | '工作編輯'

interface RotationRow {
  id: string
  teacher_id: string
  year: number
  work: string
  profiles?: { name: string | null; email: string } | null
}

interface ScoreRow {
  teacher_id: string
  year: number
  score: number
  recent_four_year_total: number | null
}

interface ImportPreviewRow {
  teacher_id?: string
  teacherMail?: string
  year: number
  work: string
}

interface TeacherBasic {
  id: string
  name: string | null
  email: string
}

interface Props {
  initialRotations: RotationRow[]
  initialScores: ScoreRow[]
  activeTeachers: TeacherBasic[]
  scoremapWorks: string[]
}

export default function RotationsClient({ initialRotations, initialScores, activeTeachers, scoremapWorks }: Props) {
  const workOptions = groupWorks(scoremapWorks)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('工作紀錄')
  const [rotations, setRotations] = useState<RotationRow[]>(initialRotations)
  const [scores, setScores] = useState<ScoreRow[]>(initialScores)

  // 工作紀錄 tab
  const [showMissing, setShowMissing] = useState(false)
  const [missingYear, setMissingYear] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editWork, setEditWork] = useState('')
  const [saving, setSaving] = useState(false)
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [filterWork, setFilterWork] = useState('')

  // 工作歷程 tab
  const [timelineTeacherId, setTimelineTeacherId] = useState('')

  // 工作編輯 tab
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [addTeacherId, setAddTeacherId] = useState('')
  const [addYear, setAddYear] = useState('')
  const [addWork, setAddWork] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)

  // 共用
  const [recalcing, setRecalcing] = useState(false)
  const [recalcResult, setRecalcResult] = useState<string | null>(null)

  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRotations(initialRotations) }, [initialRotations])
  useEffect(() => { setScores(initialScores) }, [initialScores])

  async function load() {
    const res = await fetch('/api/admin/rotations')
    if (res.ok) {
      const data = await res.json()
      setRotations(data.rotations ?? [])
      setScores(data.scores ?? [])
    }
  }

  async function handleRecalcAll() {
    setRecalcing(true)
    setRecalcResult(null)
    try {
      const res = await fetch('/api/admin/recalc', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setRecalcResult(`重算完成，共 ${data.recalculated} 位教師`)
        await load()
      } else {
        setRecalcResult(`重算失敗：${data.error}`)
      }
    } catch {
      setRecalcResult('網路錯誤')
    } finally {
      setRecalcing(false)
    }
  }

  const filtered = rotations.filter(r => {
    const name = r.profiles?.name ?? ''
    const email = r.profiles?.email ?? ''
    const matchTeacher = !filterTeacher || name.includes(filterTeacher) || email.includes(filterTeacher)
    const matchYear = !filterYear || String(r.year) === filterYear
    const matchWork = !filterWork || r.work === filterWork
    return matchTeacher && matchYear && matchWork
  })

  function getRecentTotal(teacherId: string): number | null {
    const teacherScores = scores.filter(s => s.teacher_id === teacherId)
    const withTotal = teacherScores.find(s => s.recent_four_year_total !== null)
    return withTotal?.recent_four_year_total ?? null
  }

  function getScore(teacherId: string, year: number): number | undefined {
    return scores.find(s => s.teacher_id === teacherId && s.year === year)?.score
  }

  async function deleteRow(id: string, teacherName: string, year: number) {
    if (!confirm(`確定刪除「${teacherName}」${year} 學年度的工作紀錄？`)) return
    const res = await fetch('/api/admin/rotations', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) load()
  }

  async function saveEdit(id: string) {
    setSaving(true)
    const res = await fetch('/api/admin/rotations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, work: editWork }),
    })
    setSaving(false)
    if (res.ok) { setEditingId(null); load() }
  }

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
        if (rows.length === 0) { setImportErrors(['檔案無資料']); return }

        const headers = Object.keys(rows[0])
        const yearCols = headers.filter(h => /^\d{3,}$/.test(String(h)) && Number(h) >= 100)
        const isWide = yearCols.length > 0
        const valid: ImportPreviewRow[] = []
        const errs: string[] = []

        if (isWide) {
          rows.forEach((row) => {
            const teacherMail = String(row['teacherMail'] ?? '').trim()
            if (!teacherMail.includes('@')) return
            for (const yearCol of yearCols) {
              const work = String(row[yearCol] ?? '').trim()
              if (!work || work === '無') continue
              valid.push({ teacherMail, year: Number(yearCol), work })
            }
          })
        } else {
          rows.forEach((row, i) => {
            const teacher_id = String(row['teacher_id'] ?? '').trim()
            const teacherMail = String(row['teacherMail'] ?? '').trim()
            const year = Number(row['year'])
            const work = String(row['work'] ?? '').trim()
            if (!teacher_id && !teacherMail) {
              errs.push(`第 ${i + 2} 行：需填 teacher_id 或 teacherMail`)
            } else if (!work || work === '無') {
              // 跳過
            } else if (isNaN(year) || year < 100) {
              errs.push(`第 ${i + 2} 行：year 格式錯誤（應為民國年）`)
            } else if (teacher_id) {
              valid.push({ teacher_id, year, work })
            } else {
              valid.push({ teacherMail, year, work })
            }
          })
        }
        setImportRows(valid)
        setImportErrors(errs)
      } catch {
        setImportErrors(['檔案解析失敗，請確認為正確的 .xlsx 格式'])
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    maxFiles: 1,
  })

  async function handleAddSingle(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    if (!addTeacherId || !addYear || !addWork.trim()) { setAddError('請填寫所有欄位'); return }
    setAdding(true)
    try {
      const res = await fetch('/api/admin/rotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: [{ teacher_id: addTeacherId, year: Number(addYear), work: addWork.trim() }] }),
      })
      const data = await res.json()
      if (!res.ok) { setAddError(data.error ?? '新增失敗'); return }
      setAddTeacherId('')
      setAddYear('')
      setAddWork('')
      load()
    } finally {
      setAdding(false)
    }
  }

  async function handleImport() {
    if (importRows.length === 0) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/api/admin/rotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: importRows }),
      })
      const data = await res.json()
      if (res.ok) {
        setImportResult(`成功匯入 ${data.imported} 筆，重算 ${data.recalculated} 位教師`)
        setImportRows([])
        setImportErrors([])
        load()
      } else {
        setImportResult(`匯入失敗：${data.error}`)
      }
    } finally {
      setImporting(false)
    }
  }

  const years = Array.from(new Set(rotations.map(r => r.year))).sort((a, b) => a - b)
  const works = sortWorks(Array.from(new Set(rotations.map(r => r.work))))
  const teacherIdsWithRecords = new Set(rotations.map(r => r.teacher_id))
  const neverRecordedTeachers = activeTeachers.filter(t => !teacherIdsWithRecords.has(t.id))
  const missingTeachers = missingYear
    ? activeTeachers.filter(t => {
        const prevYear = String(Number(missingYear) - 1)
        const hadLastYear = rotations.some(r => r.teacher_id === t.id && String(r.year) === prevYear)
        const hasThisYear = rotations.some(r => r.teacher_id === t.id && String(r.year) === missingYear)
        return hadLastYear && !hasThisYear
      })
    : []

  const TABS: Tab[] = ['工作紀錄', '工作歷程', '工作編輯']

  return (
    <div className="space-y-4">
      {/* 標題列 */}
      <div className="flex items-center justify-between">
        <h2 className="page-title mb-0">教師工作紀錄</h2>
        <button onClick={handleRecalcAll} disabled={recalcing} className="btn-secondary text-sm">
          {recalcing ? '重算中...' : '重新計算所有分數'}
        </button>
      </div>

      {recalcResult && (
        <div className={`text-xs px-3 py-2 border rounded-sm ${recalcResult.includes('失敗') || recalcResult.includes('錯誤') ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
          {recalcResult}
          <button onClick={() => setRecalcResult(null)} className="ml-2 opacity-50 hover:opacity-100">×</button>
        </div>
      )}

      {/* 子分頁列 */}
      <div className="flex border-b border-zinc-200">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-zinc-800 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
            }`}
          >
            {t}
            {t === '工作紀錄' && neverRecordedTeachers.length > 0 && (
              <span className="ml-1.5 text-xs text-red-500">({neverRecordedTeachers.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── 工作紀錄 ── */}
      {tab === '工作紀錄' && (
        <div className="space-y-4">
          {/* 資料完整性提醒 */}
          <div>
            <button
              onClick={() => setShowMissing(!showMissing)}
              className="text-xs text-zinc-500 hover:text-zinc-700 underline underline-offset-2"
            >
              {showMissing ? '▲ 收起完整性提醒' : `▼ 資料完整性提醒${neverRecordedTeachers.length > 0 ? `（${neverRecordedTeachers.length} 位教師無紀錄）` : ''}`}
            </button>
            {showMissing && (
              <div className="card mt-2 space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-zinc-500">從未有任何工作紀錄</p>
                  {neverRecordedTeachers.length === 0 ? (
                    <p className="text-xs text-green-600">✓ 所有在職教師均有工作紀錄</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {neverRecordedTeachers.map(t => (
                        <span key={t.id} className="text-xs px-2 py-1 bg-red-50 border border-red-200 text-red-700">
                          {t.name ?? t.email}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-zinc-100" />
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <p className="text-xs font-medium text-zinc-500">指定學年度缺少紀錄</p>
                    <select
                      value={missingYear}
                      onChange={e => setMissingYear(e.target.value)}
                      className="input w-32 text-xs py-1"
                    >
                      <option value="">選擇學年度</option>
                      {years.map(y => <option key={y} value={y}>{y} 學年度</option>)}
                    </select>
                  </div>
                  {!missingYear && <p className="text-xs text-zinc-400">選擇學年度後，顯示上一年有紀錄但本年尚未填入的教師</p>}
                  {missingYear && missingTeachers.length === 0 && <p className="text-xs text-green-600">✓ 所有在職教師均有 {missingYear} 學年度紀錄</p>}
                  {missingYear && missingTeachers.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {missingTeachers.map(t => (
                        <span key={t.id} className="text-xs px-2 py-1 bg-amber-50 border border-amber-200 text-amber-800">
                          {t.name ?? t.email}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 篩選 */}
          <div className="flex gap-3">
            <input
              value={filterTeacher}
              onChange={e => setFilterTeacher(e.target.value)}
              placeholder="依教師姓名/信箱篩選"
              className="input w-48"
            />
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="input w-32">
              <option value="">全部學年</option>
              {years.map(y => <option key={y} value={y}>{y} 學年度</option>)}
            </select>
            <select value={filterWork} onChange={e => setFilterWork(e.target.value)} className="input w-40">
              <option value="">全部職務</option>
              {works.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <span className="text-sm text-zinc-500 flex items-center">共 {filtered.length} 筆</span>
          </div>

          {/* 表格 */}
          <div className="card p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>教師姓名</th>
                  <th>學年度</th>
                  <th>工作職務</th>
                  <th className="text-right">本年積分</th>
                  <th className="text-right">近四年總分</th>
                  <th className="w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-zinc-400">無資料</td></tr>
                )}
                {filtered.map(row => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium text-zinc-900">{row.profiles?.name ?? '—'}</div>
                      <div className="text-xs text-zinc-400">{row.profiles?.email}</div>
                    </td>
                    <td>{row.year} 學年度</td>
                    <td>
                      {editingId === row.id ? (
                        <select
                          value={editWork}
                          onChange={e => setEditWork(e.target.value)}
                          className="input py-1 w-44"
                          autoFocus
                        >
                          {workOptions.map(group => (
                            <optgroup key={group.label} label={group.label}>
                              {group.works.map(item => (
                                <option key={item} value={item}>{item}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      ) : row.work}
                    </td>
                    <td className="text-right">{getScore(row.teacher_id, row.year)?.toFixed(2) ?? '—'}</td>
                    <td className="text-right">{getRecentTotal(row.teacher_id)?.toFixed(2) ?? '—'}</td>
                    <td>
                      {editingId === row.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => saveEdit(row.id)} disabled={saving} className="btn-primary py-1 px-2 text-xs">
                            {saving ? '...' : '儲存'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="btn-secondary py-1 px-2 text-xs">取消</button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingId(row.id); setEditWork(row.work) }}
                            className="btn-secondary py-1 px-2 text-xs"
                          >編輯</button>
                          <button
                            onClick={() => deleteRow(row.id, row.profiles?.name ?? row.profiles?.email ?? '—', row.year)}
                            className="py-1 px-2 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded-sm"
                          >刪除</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 工作歷程 ── */}
      {tab === '工作歷程' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={timelineTeacherId}
              onChange={e => setTimelineTeacherId(e.target.value)}
              className="input w-72"
            >
              <option value="">選擇教師</option>
              {activeTeachers
                .slice()
                .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-TW'))
                .map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name ?? t.email}（{t.email}）
                  </option>
                ))}
            </select>
          </div>

          {!timelineTeacherId && (
            <p className="text-sm text-zinc-400">選擇教師後顯示其完整工作歷程</p>
          )}

          {timelineTeacherId && (() => {
            const rots = rotations
              .filter(r => r.teacher_id === timelineTeacherId)
              .map(r => ({ year: r.year, work: r.work }))
            const segments = buildTimeline(rots)
            if (segments.length === 0) return (
              <p className="text-sm text-zinc-400">此教師尚無工作紀錄</p>
            )
            return (
              <div className="card space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  {segments.map((seg, i) => {
                    const cat = getWorkCategory(seg.work)
                    return (
                      <span key={i} className="flex items-center gap-2">
                        {i > 0 && <span className="text-zinc-400 text-sm">›</span>}
                        <span className={`inline-flex flex-col items-center px-3 py-1.5 border rounded-sm text-sm leading-snug ${CATEGORY_STYLE[cat]}`}>
                          <span className="font-semibold">{seg.work}</span>
                          <span className="text-xs opacity-70">{seg.count} 年（{seg.from}～{seg.to}）</span>
                        </span>
                      </span>
                    )
                  })}
                </div>
                <div className="flex gap-6 text-xs text-zinc-500 pt-1 border-t border-zinc-100 flex-wrap">
                  {(['中低年級', '高年級', '行政', '科任', '留停'] as const).map(cat => {
                    const total = segments.filter(s => getWorkCategory(s.work) === cat).reduce((sum, s) => sum + s.count, 0)
                    if (total === 0) return null
                    return <span key={cat}><span className="font-medium text-zinc-700">{cat}</span> {total} 年</span>
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 工作編輯 ── */}
      {tab === '工作編輯' && (
        <div className="space-y-6">
          {/* 單筆新增 */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-zinc-700">單筆新增</h3>
            <form onSubmit={handleAddSingle} className="flex gap-2 items-end flex-wrap">
              <div className="flex-[2] min-w-40">
                <label className="block text-xs text-zinc-500 mb-1">教師</label>
                <select
                  value={addTeacherId}
                  onChange={e => setAddTeacherId(e.target.value)}
                  required
                  className="input"
                >
                  <option value="">請選擇教師</option>
                  {activeTeachers
                    .slice()
                    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh-TW'))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name ?? t.email}（{t.email}）
                      </option>
                    ))}
                </select>
              </div>
              <div className="w-28">
                <label className="block text-xs text-zinc-500 mb-1">學年度（民國年）</label>
                <input
                  type="number"
                  value={addYear}
                  onChange={e => setAddYear(e.target.value)}
                  placeholder="113"
                  min={100}
                  max={150}
                  required
                  className="input"
                />
              </div>
              <div className="flex-[2] min-w-40">
                <label className="block text-xs text-zinc-500 mb-1">工作職務</label>
                <select value={addWork} onChange={e => setAddWork(e.target.value)} required className="input">
                  <option value="">請選擇職務</option>
                  {workOptions.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.works.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={adding} className="btn-primary whitespace-nowrap">
                {adding ? '新增中...' : '新增'}
              </button>
            </form>
            {addError && <p className="text-xs text-red-500">{addError}</p>}
            {(() => {
              if (!addTeacherId || !MIDLOW_WORKS.includes(addWork)) return null
              const teacherRots = rotations
                .filter(r => r.teacher_id === addTeacherId)
                .map(r => ({ year: r.year, work: r.work }))
              const consecutiveYears = getMidLowConsecutiveYears(teacherRots)
              if (consecutiveYears < MIDLOW_LIMIT) return null
              return (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
                  ⚠ 此教師已連續 {consecutiveYears} 年擔任中低年級導師（達 {MIDLOW_LIMIT} 年上限），依規定應排高年級。
                </p>
              )
            })()}
          </div>

          {/* 批次匯入 */}
          <div className="card space-y-4">
            <h3 className="text-sm font-semibold text-zinc-700">批次匯入</h3>
            <div className="flex items-center gap-3">
              <a href="/api/admin/template" className="btn-secondary text-sm">下載 Excel 模板</a>
              <p className="text-xs text-zinc-400">下載模板後填入資料再上傳</p>
            </div>
            <p className="text-xs text-zinc-400">
              填入 <code>year</code>（民國年）和 <code>work</code>（職務）後上傳。<br />
              <strong>注意：請勿修改 <code>teacher_id</code> 欄位。</strong>
              同一位教師有多個年度時，請複製該列並修改 <code>year</code> 和 <code>work</code>。
              <code>work</code> 留空或填「無」會自動略過。匯入後自動重算分數。
            </p>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-zinc-500 bg-zinc-50' : 'border-zinc-300 hover:border-zinc-400'
              }`}
            >
              <input {...getInputProps()} />
              <p className="text-sm text-zinc-500">拖放 .xlsx 檔案至此，或點擊選擇</p>
            </div>
            {importErrors.length > 0 && (
              <div className="space-y-1">
                {importErrors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            )}
            {importRows.length > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-600">已解析 <strong>{importRows.length}</strong> 筆資料</p>
                <button onClick={handleImport} disabled={importing} className="btn-primary">
                  {importing ? '匯入中...' : `確認匯入 ${importRows.length} 筆`}
                </button>
              </div>
            )}
            {importResult && (
              <div className="px-3 py-2 border border-zinc-200 bg-zinc-50 text-sm text-zinc-700 rounded-sm">
                {importResult}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
