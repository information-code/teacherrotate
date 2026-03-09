'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'

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

interface Props {
  initialRotations: RotationRow[]
  initialScores: ScoreRow[]
}

export default function RotationsClient({ initialRotations, initialScores }: Props) {
  const [rotations, setRotations] = useState<RotationRow[]>(initialRotations)
  const [scores, setScores] = useState<ScoreRow[]>(initialScores)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editWork, setEditWork] = useState('')
  const [saving, setSaving] = useState(false)
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/admin/rotations')
    if (res.ok) {
      const data = await res.json()
      setRotations(data.rotations ?? [])
      setScores(data.scores ?? [])
    }
  }

  // 過濾
  const filtered = rotations.filter(r => {
    const name = r.profiles?.name ?? ''
    const email = r.profiles?.email ?? ''
    const matchTeacher = !filterTeacher || name.includes(filterTeacher) || email.includes(filterTeacher)
    const matchYear = !filterYear || String(r.year) === filterYear
    return matchTeacher && matchYear
  })

  // 取得近四年總分
  function getRecentTotal(teacherId: string): number | null {
    const teacherScores = scores.filter(s => s.teacher_id === teacherId)
    const withTotal = teacherScores.find(s => s.recent_four_year_total !== null)
    return withTotal?.recent_four_year_total ?? null
  }

  // 取得某教師某年分數
  function getScore(teacherId: string, year: number): number | undefined {
    return scores.find(s => s.teacher_id === teacherId && s.year === year)?.score
  }

  async function saveEdit(id: string) {
    setSaving(true)
    const res = await fetch('/api/admin/rotations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, work: editWork }),
    })
    setSaving(false)
    if (res.ok) {
      setEditingId(null)
      load()
    }
  }

  // Excel 匯入解析（支援寬表：teacherMail, teacherName, 106, 107, 108...）
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
        // 偵測是否為寬表（有民國年欄位，如 106、107...）
        const yearCols = headers.filter(h => /^\d{3,}$/.test(String(h)) && Number(h) >= 100)
        const isWide = yearCols.length > 0

        const valid: ImportPreviewRow[] = []
        const errs: string[] = []

        if (isWide) {
          // 寬表模式：每欄是一個年度，每格是職務
          rows.forEach((row) => {
            const teacherMail = String(row['teacherMail'] ?? '').trim()
            if (!teacherMail.includes('@')) return
            for (const yearCol of yearCols) {
              const work = String(row[yearCol] ?? '').trim()
              if (!work || work === '無') continue  // 跳過空白和「無」
              valid.push({ teacherMail, year: Number(yearCol), work })
            }
          })
        } else {
          // 長表模式：每行是一筆紀錄（teacher_id/teacherMail, year, work）
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
        setShowImport(false)
        load()
      } else {
        setImportResult(`匯入失敗：${data.error}`)
      }
    } finally {
      setImporting(false)
    }
  }

  const years = Array.from(new Set(rotations.map(r => r.year))).sort((a, b) => a - b)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="page-title mb-0">教師工作紀錄</h2>
        <div className="flex gap-2">
          <a
            href="/api/admin/template"
            className="btn-secondary text-sm"
          >
            下載 Excel 模板
          </a>
          <button onClick={() => setShowImport(!showImport)} className="btn-secondary">
            {showImport ? '收起匯入' : '批次匯入'}
          </button>
        </div>
      </div>

      {importResult && (
        <div className="px-4 py-2 border border-zinc-200 bg-zinc-50 text-sm text-zinc-700 rounded-sm">
          {importResult}
        </div>
      )}

      {/* 匯入區 */}
      {showImport && (
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-zinc-700">批次匯入工作紀錄</h3>
          <p className="text-xs text-zinc-400">
            支援兩種格式：<br />
            ① <strong>寬表</strong>：欄位為 <code>teacherMail</code>、<code>teacherName</code>、<code>106</code>、<code>107</code>…（直接從 Google Sheet 匯出）<br />
            ② <strong>長表</strong>：欄位為 <code>teacherMail</code>、<code>year</code>、<code>work</code>（每行一筆）<br />
            「無」的格子會自動略過。匯入後自動重算分數。
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
              {importErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-600">{e}</p>
              ))}
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
        </div>
      )}

      {/* 篩選 */}
      <div className="flex gap-3">
        <input
          value={filterTeacher}
          onChange={e => setFilterTeacher(e.target.value)}
          placeholder="依教師姓名/信箱篩選"
          className="input w-48"
        />
        <select
          value={filterYear}
          onChange={e => setFilterYear(e.target.value)}
          className="input w-32"
        >
          <option value="">全部學年</option>
          {years.map(y => <option key={y} value={y}>{y} 學年度</option>)}
        </select>
        <span className="text-sm text-zinc-500 flex items-center">
          共 {filtered.length} 筆
        </span>
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
                    <input
                      value={editWork}
                      onChange={e => setEditWork(e.target.value)}
                      className="input py-1 w-40"
                      autoFocus
                    />
                  ) : (
                    row.work
                  )}
                </td>
                <td className="text-right">
                  {getScore(row.teacher_id, row.year)?.toFixed(2) ?? '—'}
                </td>
                <td className="text-right">
                  {getRecentTotal(row.teacher_id)?.toFixed(2) ?? '—'}
                </td>
                <td>
                  {editingId === row.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => saveEdit(row.id)}
                        disabled={saving}
                        className="btn-primary py-1 px-2 text-xs"
                      >
                        {saving ? '...' : '儲存'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="btn-secondary py-1 px-2 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(row.id); setEditWork(row.work) }}
                      className="btn-secondary py-1 px-2 text-xs"
                    >
                      編輯
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
