'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import * as XLSX from 'xlsx'
import {
  EQUIPMENT_PERIODS,
  EQUIPMENT_STATUS_LABEL,
  type ChecklistItem,
  type EquipmentConfig,
} from '@/lib/equipment'

interface EquipmentRow {
  id: string
  name: string
  location: string
  asset_number: string
  peripherals: string[]
  borrow_checklist: ChecklistItem[]
  return_checklist: ChecklistItem[]
  status: string
  notes: string
  sort_order: number
}

type EditorState =
  | { mode: 'closed' }
  | { mode: 'create'; row: EquipmentRow }
  | { mode: 'edit'; row: EquipmentRow }

const EMPTY_ROW: EquipmentRow = {
  id: '',
  name: '',
  location: '',
  asset_number: '',
  peripherals: [],
  borrow_checklist: [{ label: '設備外觀無損壞', requiresPhoto: true }],
  return_checklist: [{ label: '設備已歸回原位', requiresPhoto: true }],
  status: 'available',
  notes: '',
  sort_order: 0,
}

export default function EquipmentConfigClient({
  initialEquipment,
  initialConfig,
}: {
  initialEquipment: EquipmentRow[]
  initialConfig: EquipmentConfig
}) {
  const [equipment, setEquipment] = useState<EquipmentRow[]>(initialEquipment)
  const [config, setConfig] = useState<EquipmentConfig>(initialConfig)
  const [tab, setTab] = useState<'equipment' | 'rules' | 'agreements' | 'overdue'>('equipment')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' })
  const [showImport, setShowImport] = useState(false)

  const keyword = search.trim().toLowerCase()
  const filteredEquipment = equipment.filter(row => {
    if (statusFilter && row.status !== statusFilter) return false
    if (!keyword) return true
    return [row.name, row.location, row.asset_number, row.notes, ...(row.peripherals ?? [])]
      .some(text => (text ?? '').toLowerCase().includes(keyword))
  })
  const [savingConfig, setSavingConfig] = useState(false)
  const [message, setMessage] = useState('')

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      const res = await fetch('/api/admin/equipment-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      flash(res.ok ? '設定已儲存' : `儲存失敗：${data.error}`)
    } finally {
      setSavingConfig(false)
    }
  }

  const togglePeriod = (key: string) => {
    setConfig(c => ({
      ...c,
      openPeriods: c.openPeriods.includes(key)
        ? c.openPeriods.filter(p => p !== key)
        : [...c.openPeriods, key],
    }))
  }

  const saveEquipment = async (row: EquipmentRow, isCreate: boolean) => {
    const res = await fetch('/api/admin/equipment', {
      method: isCreate ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isCreate ? { ...row, id: undefined } : row),
    })
    const data = await res.json()
    if (!res.ok) {
      flash(`儲存失敗：${data.error}`)
      return
    }
    setEquipment(list =>
      isCreate ? [...list, data] : list.map(e => (e.id === data.id ? data : e))
    )
    setEditor({ mode: 'closed' })
    flash('設備已儲存')
  }

  const deleteEquipment = async (row: EquipmentRow) => {
    if (!confirm(`確定刪除「${row.name}」？相關借用紀錄會一併刪除，若要保留歷史請改為「停用」。`)) return
    const res = await fetch(`/api/admin/equipment?id=${row.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      flash(`刪除失敗：${data.error}`)
      return
    }
    setEquipment(list => list.filter(e => e.id !== row.id))
    setEditor({ mode: 'closed' })
    flash('設備已刪除')
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">設備借用設定</h1>
        {message && <span className="text-sm text-zinc-600">{message}</span>}
      </div>

      {/* Tab 切換 */}
      <div className="flex border-b border-zinc-200">
        {([
          ['equipment', '設備庫'],
          ['rules', '節次與規則'],
          ['agreements', '同意書'],
          ['overdue', '逾期通知'],
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

      {/* 設備庫 */}
      {tab === 'equipment' && (
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-zinc-900">設備庫</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              每台設備各自維護週邊配件與借用／歸還檢查清單（可逐項設定是否需拍照）。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary" href="/api/admin/equipment-template">下載設備庫</a>
            <button className="btn-secondary" onClick={() => setShowImport(true)}>Excel 匯入</button>
            <button className="btn-primary" onClick={() => setEditor({ mode: 'create', row: { ...EMPTY_ROW } })}>
              新增設備
            </button>
          </div>
        </div>

        {/* 搜尋與篩選 */}
        <div className="flex flex-wrap gap-2">
          <input
            className="input !w-64"
            placeholder="搜尋名稱、位置、編號、週邊、備註…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="input !w-32" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">全部狀態</option>
            {Object.entries(EQUIPMENT_STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          {(keyword || statusFilter) && (
            <span className="self-center text-xs text-zinc-500">
              符合 {filteredEquipment.length}／{equipment.length} 台
            </span>
          )}
        </div>

        {equipment.length === 0 ? (
          <p className="text-sm text-zinc-500">尚未建立任何設備。</p>
        ) : filteredEquipment.length === 0 ? (
          <p className="text-sm text-zinc-500">沒有符合搜尋條件的設備。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>位置</th>
                  <th>編號</th>
                  <th>週邊</th>
                  <th>檢查項目</th>
                  <th>狀態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredEquipment.map(row => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.name}</td>
                    <td>{row.location || '—'}</td>
                    <td>{row.asset_number || '—'}</td>
                    <td>{(row.peripherals ?? []).length} 項</td>
                    <td>
                      借 {(row.borrow_checklist ?? []).length}／還 {(row.return_checklist ?? []).length}
                    </td>
                    <td>
                      <span className={row.status === 'available' ? 'badge-success' : 'badge-warn'}>
                        {EQUIPMENT_STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap space-x-1">
                      <button className="btn-secondary !px-3 !py-1" onClick={() => setEditor({ mode: 'edit', row: { ...row } })}>
                        編輯
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      )}

      {/* 開放節次與借用規則 */}
      {tab === 'rules' && (
      <div className="card space-y-4">
        <h2 className="font-medium text-zinc-900">開放節次與借用規則</h2>
        <div>
          <span className="label">開放借用的節次</span>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT_PERIODS.map(p => (
              <label
                key={p.key}
                className={`px-3 py-1.5 text-sm border rounded cursor-pointer select-none transition-colors ${
                  config.openPeriods.includes(p.key)
                    ? 'bg-zinc-800 text-white border-zinc-800'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={config.openPeriods.includes(p.key)}
                  onChange={() => togglePeriod(p.key)}
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="label">可預借天數</span>
            <input
              type="number" min={1} className="input"
              value={config.maxAdvanceDays}
              onChange={e => setConfig(c => ({ ...c, maxAdvanceDays: Number(e.target.value) || 1 }))}
            />
          </div>
          <div>
            <span className="label">續借週期（週）</span>
            <input
              type="number" min={1} className="input"
              value={config.renewalWeeks}
              onChange={e => setConfig(c => ({ ...c, renewalWeeks: Number(e.target.value) || 1 }))}
            />
          </div>
          <div>
            <span className="label">續借提前通知（天）</span>
            <input
              type="number" min={0} className="input"
              value={config.renewalNoticeDays}
              onChange={e => setConfig(c => ({ ...c, renewalNoticeDays: Number(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <span className="label">照片上限（張）</span>
            <input
              type="number" min={1} max={10} className="input"
              value={config.maxPhotos}
              onChange={e => setConfig(c => ({ ...c, maxPhotos: Number(e.target.value) || 1 }))}
            />
          </div>
        </div>
      </div>

      )}

      {/* 同意書 */}
      {tab === 'agreements' && (
      <div className="card space-y-4">
        <h2 className="font-medium text-zinc-900">同意書內容</h2>
        {([
          ['borrow', '短期借用同意書'],
          ['return', '短期歸還同意書'],
          ['longterm', '長期借用同意書'],
          ['renewal', '續借回傳同意書'],
        ] as const).map(([key, label]) => (
          <div key={key}>
            <span className="label">{label}</span>
            <textarea
              className="input min-h-[80px]"
              value={config.agreements[key]}
              onChange={e => setConfig(c => ({ ...c, agreements: { ...c.agreements, [key]: e.target.value } }))}
            />
          </div>
        ))}
      </div>

      )}

      {/* 逾期通知模板 */}
      {tab === 'overdue' && (
      <div className="card space-y-3">
        <h2 className="font-medium text-zinc-900">逾期通知訊息模板</h2>
        <p className="text-sm text-zinc-500">
          管理頁的逾期紀錄可一鍵複製此訊息貼到 LINE。可用變數：
          <code className="mx-1 px-1 bg-zinc-100 rounded">{'{老師}'}</code>
          <code className="mx-1 px-1 bg-zinc-100 rounded">{'{設備}'}</code>
          <code className="mx-1 px-1 bg-zinc-100 rounded">{'{日期}'}</code>
          <code className="mx-1 px-1 bg-zinc-100 rounded">{'{時段}'}</code>
        </p>
        <textarea
          className="input min-h-[80px]"
          value={config.overdueMessageTemplate}
          onChange={e => setConfig(c => ({ ...c, overdueMessageTemplate: e.target.value }))}
        />
      </div>
      )}

      {/* 設備庫逐筆儲存；其餘分頁共用一顆儲存設定 */}
      {tab !== 'equipment' && (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={saveConfig} disabled={savingConfig}>
            {savingConfig ? '儲存中…' : '儲存設定'}
          </button>
        </div>
      )}

      {(editor.mode === 'create' || editor.mode === 'edit') && (
        <EquipmentEditor
          row={editor.row}
          isCreate={editor.mode === 'create'}
          onSave={row => saveEquipment(row, editor.mode === 'create')}
          onDelete={editor.mode === 'edit' ? () => deleteEquipment(editor.row) : undefined}
          onClose={() => setEditor({ mode: 'closed' })}
        />
      )}
      {showImport && (
        <ImportModal
          onDone={async summary => {
            // 匯入含更新既有設備，直接重新載入整份清單
            const res = await fetch('/api/admin/equipment')
            if (res.ok) setEquipment(await res.json())
            setShowImport(false)
            flash(`匯入完成：新增 ${summary.createdCount} 台、更新 ${summary.updatedCount} 台`)
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}

/** 批次匯入 Modal：拖放/選擇 Excel → 預覽列數 → 送出匯入 */
function ImportModal({
  onDone,
  onClose,
}: {
  onDone: (summary: { createdCount: number; updatedCount: number }) => void
  onClose: () => void
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    setParseError('')
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
        if (parsed.length === 0) {
          setParseError('檔案中沒有資料列，請確認第一個工作表已填寫。')
          setRows([])
          return
        }
        if (parsed.every(r => !String(r['名稱'] ?? '').trim())) {
          setParseError('找不到「名稱」欄位資料，請使用系統提供的範本填寫。')
          setRows([])
          return
        }
        setRows(parsed)
        setFileName(file.name)
      } catch {
        setParseError('無法讀取檔案，請確認為 Excel（.xlsx）格式。')
        setRows([])
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
  })

  const submit = async () => {
    setImporting(true)
    try {
      const res = await fetch('/api/admin/equipment-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? '匯入失敗')
        return
      }
      if ((data.errors ?? []).length > 0) {
        alert(`已套用 ${data.createdCount + data.updatedCount} 列，以下列有問題被略過：\n${data.errors.join('\n')}`)
      }
      onDone(data)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 className="font-semibold text-zinc-900">Excel 匯入設備庫</h3>
        <p className="text-sm text-zinc-500">
          請先「下載設備庫」，在 Excel 中編修或新增後上傳：有 id 的列會<b>更新</b>該設備、id 留空的列會<b>新增</b>；
          檔案中沒列出的設備不受影響（刪除請在系統操作）。檢查項目結尾加「*」代表需拍照。
        </p>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded p-6 text-center text-sm cursor-pointer transition-colors ${
            isDragActive ? 'border-zinc-500 bg-zinc-50 text-zinc-700' : 'border-zinc-300 text-zinc-500 hover:bg-zinc-50'
          }`}
        >
          <input {...getInputProps()} />
          {fileName
            ? <>已選擇：<span className="font-medium text-zinc-800">{fileName}</span>（{rows.length} 列）<br />點擊或拖放可更換檔案</>
            : '點擊選擇或拖放 Excel 檔案（.xlsx）'}
        </div>

        {parseError && <p className="text-sm text-red-600">{parseError}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={importing}>取消</button>
          <button className="btn-primary" onClick={submit} disabled={rows.length === 0 || importing}>
            {importing ? '匯入中…' : `匯入 ${rows.length} 列`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 設備編輯 Modal：基本資料＋週邊＋借用/歸還檢查清單 */
function EquipmentEditor({
  row,
  isCreate,
  onSave,
  onDelete,
  onClose,
}: {
  row: EquipmentRow
  isCreate: boolean
  onSave: (row: EquipmentRow) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<EquipmentRow>(row)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof EquipmentRow>(key: K, value: EquipmentRow[K]) =>
    setDraft(d => ({ ...d, [key]: value }))

  const submit = async () => {
    if (!draft.name.trim()) {
      alert('請填寫設備名稱')
      return
    }
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="font-semibold text-zinc-900">{isCreate ? '新增設備' : `編輯設備：${row.name}`}</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="label">設備名稱 *</span>
            <input className="input" value={draft.name} onChange={e => set('name', e.target.value)} placeholder="例：單槍投影機" />
          </div>
          <div>
            <span className="label">存放位置</span>
            <input className="input" value={draft.location} onChange={e => set('location', e.target.value)} placeholder="例：教務處設備櫃" />
          </div>
          <div>
            <span className="label">編號</span>
            <input className="input" value={draft.asset_number} onChange={e => set('asset_number', e.target.value)} />
          </div>
          <div>
            <span className="label">狀態</span>
            <select className="input" value={draft.status} onChange={e => set('status', e.target.value)}>
              <option value="available">可借用</option>
              <option value="maintenance">維修中</option>
              <option value="retired">停用</option>
            </select>
          </div>
        </div>

        <div>
          <span className="label">備註</span>
          <input className="input" value={draft.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        <StringListEditor
          title="週邊配件"
          placeholder="例：電源線、遙控器、HDMI 線"
          items={draft.peripherals ?? []}
          onChange={items => set('peripherals', items)}
        />

        <ChecklistEditor
          title="借用檢查項目"
          items={draft.borrow_checklist ?? []}
          onChange={items => set('borrow_checklist', items)}
        />
        <ChecklistEditor
          title="歸還檢查項目"
          items={draft.return_checklist ?? []}
          onChange={items => set('return_checklist', items)}
        />

        <div className="flex items-center justify-between pt-2">
          <div>
            {onDelete && (
              <button className="btn-danger" onClick={onDelete}>刪除設備</button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>取消</button>
            <button className="btn-primary" onClick={submit} disabled={saving}>
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StringListEditor({
  title,
  placeholder,
  items,
  onChange,
}: {
  title: string
  placeholder: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="label !mb-0">{title}</span>
        <button className="btn-secondary !px-3 !py-1 text-xs" onClick={() => onChange([...items, ''])}>
          ＋ 新增
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-zinc-400">（無）</p>}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input flex-1"
              value={item}
              placeholder={placeholder}
              onChange={e => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <button className="btn-secondary !px-3" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              移除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChecklistEditor({
  title,
  items,
  onChange,
}: {
  title: string
  items: ChecklistItem[]
  onChange: (items: ChecklistItem[]) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="label !mb-0">{title}</span>
        <button
          className="btn-secondary !px-3 !py-1 text-xs"
          onClick={() => onChange([...items, { label: '', requiresPhoto: false }])}
        >
          ＋ 新增項目
        </button>
      </div>
      {items.length === 0 && <p className="text-sm text-zinc-400">（無檢查項目）</p>}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="input flex-1"
              value={item.label}
              placeholder="檢查項目內容"
              onChange={e => onChange(items.map((v, j) => (j === i ? { ...v, label: e.target.value } : v)))}
            />
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={item.requiresPhoto}
                onChange={e => onChange(items.map((v, j) => (j === i ? { ...v, requiresPhoto: e.target.checked } : v)))}
              />
              需拍照
            </label>
            <button className="btn-secondary !px-3" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              移除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
