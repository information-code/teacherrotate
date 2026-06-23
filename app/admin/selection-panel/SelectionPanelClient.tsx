'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { TARGET_BADGE_STYLE } from '@/lib/rotation-target'
import { NumberInput } from '@/components/ui/NumberInput'
import {
  ADMIN_GROUPS, SUBJECT_AREAS, HOMEROOM_SLOTS, HOMEROOM_INPUT_PAIRS,
  DEFAULT_QUOTAS, MIDLOW_LIMIT, subjectDisplayLabel, type Quotas,
} from '@/lib/selection-slots'
import type { PanelTeacher } from './page'

interface Props {
  teachers: PanelTeacher[]
  midLowWorks: string[]
  preferenceYear: number
  initialData: { quotas?: Quotas; placements?: Record<string, string> }
}

export default function SelectionPanelClient({ teachers, midLowWorks, preferenceYear, initialData }: Props) {
  const router = useRouter()
  const midLowSet = useMemo(() => new Set(midLowWorks), [midLowWorks])
  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [quotaCollapsed, setQuotaCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [quotas, setQuotas] = useState<Quotas>(initialData.quotas ?? DEFAULT_QUOTAS)
  const [placements, setPlacements] = useState<Record<string, string>>(initialData.placements ?? {}) // teacherId → slotId
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [applying, setApplying] = useState(false)

  // ── 變更後防抖儲存到後端（每年度一筆）──
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setSaveStatus('saving')
    const t = setTimeout(() => { void saveNow() }, 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotas, placements])

  async function saveNow(): Promise<boolean> {
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/admin/selection-panel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: preferenceYear, data: { quotas, placements } }),
      })
      setSaveStatus(res.ok ? 'saved' : 'idle')
      return res.ok
    } catch {
      setSaveStatus('idle')
      return false
    }
  }

  function resetAll() {
    if (!confirm('確定要清空所有名額設定與已分配教師？此操作無法復原。')) return
    setQuotas(DEFAULT_QUOTAS)
    setPlacements({})
  }

  async function applyToRotations() {
    if (!confirm(
      `套用 ${preferenceYear} 學年度撕榜結果到工作紀錄？\n\n` +
      `按下後會一次完成（並重算分數）：\n` +
      `① 已分配的撕榜教師 → 寫入 ${preferenceYear} 學年度工作（覆蓋既有）。\n` +
      `② 本輪需換工作、但這次未分配者 → 清掉其殘留的 ${preferenceYear} 紀錄。\n` +
      `③ 其餘在校老師（連任）→ 若尚無 ${preferenceYear} 紀錄，複製其原職建立（只補不覆蓋）。\n\n` +
      `※ 接棒班／留停等特殊個案複製後請至「工作紀錄」檢視微調。`
    )) return
    setApplying(true)
    try {
      await saveNow()
      const res = await fetch('/api/admin/selection-panel/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: preferenceYear }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { alert(data.error || '套用失敗，請稍後再試'); return }
      // 不 router.refresh()：寫入當年度 rotation 後 getRotationTarget 會變動、
      // 已分配教師可能被面板過濾掉，造成「配置消失」的錯覺。保留目前畫面即可，
      // 資料已寫入 DB；需要看更新後狀態可手動重新整理。
      alert(
        `已套用至 ${preferenceYear} 學年度工作紀錄，分數已重算：\n` +
        `· 撕榜寫入 ${data.applied} 位\n` +
        `· 連任補齊 ${data.filled} 位\n` +
        `· 清除殘留 ${data.removed} 位`
      )
    } finally {
      setApplying(false)
    }
  }
  const [dragTeacherId, setDragTeacherId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [blockMsg, setBlockMsg] = useState<string | null>(null)
  const [detailTeacher, setDetailTeacher] = useState<PanelTeacher | null>(null)
  const [detailPos, setDetailPos] = useState<{ x: number; y: number } | null>(null)

  function place(teacherId: string, slotId: string) {
    // 檢查目標槽位是否會違反中低年級規則（連續 ≥ 8 年中低）
    const teacher = teachers.find(t => t.id === teacherId)
    const gradeMatch = slotId.match(/^grade-(\d+)-/)
    if (teacher && teacher.midLowConsecutiveYears >= MIDLOW_LIMIT && gradeMatch) {
      const grade = Number(gradeMatch[1])
      const slot = HOMEROOM_SLOTS.find(s => s.grade === grade)
      if (slot && midLowSet.has(slot.work)) {
        setBlockMsg(`${teacher.name} 已連續 ${teacher.midLowConsecutiveYears} 年中低年級，依規定須排高年級`)
        setTimeout(() => setBlockMsg(null), 5000)
        return
      }
    }

    setPlacements(prev => {
      const next = { ...prev }
      // 把該位置原本的人踢回 pool
      for (const [tid, sid] of Object.entries(next)) {
        if (sid === slotId) delete next[tid]
      }
      next[teacherId] = slotId
      return next
    })
  }

  function unplace(teacherId: string) {
    setPlacements(prev => {
      const next = { ...prev }
      delete next[teacherId]
      return next
    })
  }

  function handleDrop(slotId: string) {
    if (!dragTeacherId) return
    if (slotId === 'pool') {
      unplace(dragTeacherId)
    } else {
      place(dragTeacherId, slotId)
    }
    setDragTeacherId(null)
    setDragOver(null)
  }

  function teacherAt(slotId: string): PanelTeacher | undefined {
    const teacherId = Object.entries(placements).find(([, sid]) => sid === slotId)?.[0]
    return teacherId ? teachers.find(t => t.id === teacherId) : undefined
  }

  function showDetail(t: PanelTeacher, e: React.MouseEvent) {
    if (detailTeacher?.id === t.id) {
      setDetailTeacher(null); setDetailPos(null); return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const popupW = 232
    const x = rect.right + 10 + popupW > window.innerWidth ? rect.left - popupW - 4 : rect.right + 10
    const y = Math.min(rect.top - 4, window.innerHeight - 240)
    setDetailTeacher(t)
    setDetailPos({ x, y })
  }

  const poolTeachers = useMemo(
    () => teachers.filter(t => !placements[t.id]),
    [teachers, placements]
  )

  const placedCount = Object.keys(placements).length
  const totalSlots =
    ADMIN_GROUPS.reduce((s, g) => s + g.positions.length, 0) +
    Object.values(quotas.subjects).reduce((s, n) => s + n, 0) +
    Object.values(quotas.homerooms).reduce((s, n) => s + (n ?? 0), 0)

  // ───── 渲染單一槽位 ─────
  function renderSlot(slotId: string, label: string) {
    const t = teacherAt(slotId)
    const isOver = dragOver === slotId
    const cellCls = isOver
      ? 'border-zinc-500 bg-zinc-50'
      : t ? 'border-zinc-300 bg-white' : 'border-dashed border-zinc-300 bg-zinc-50'

    return (
      <div
        key={slotId}
        onDragOver={e => { e.preventDefault(); setDragOver(slotId) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
        onDrop={e => { e.preventDefault(); handleDrop(slotId) }}
        className={`min-h-[44px] w-[124px] flex-shrink-0 rounded border-2 px-1.5 py-1 transition-colors ${cellCls}`}
      >
        <div className="text-[10px] text-zinc-500 leading-none mb-0.5 truncate">{label}</div>
        {t ? (
          <div
            draggable
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragTeacherId(t.id) }}
            onDragEnd={() => { setDragTeacherId(null); setDragOver(null) }}
            className={`flex items-center justify-between gap-1 px-1 py-1 bg-white border border-zinc-200 rounded-sm cursor-grab active:cursor-grabbing select-none ${
              dragTeacherId === t.id ? 'opacity-40' : ''
            }`}
          >
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {t.midLowConsecutiveYears >= MIDLOW_LIMIT && (
                <span className="text-[10px] text-red-500 font-bold flex-shrink-0" title={`連續${t.midLowConsecutiveYears}年中低年級`}>🚫</span>
              )}
              <span className="text-xs font-medium truncate">{t.name}</span>
            </div>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); showDetail(t, e) }}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-700"
            >i</button>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-400 text-center py-1.5">—</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ── 標題 ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">選填面板 <span className="text-sm font-normal text-zinc-500 ml-2">{preferenceYear} 學年度 撕榜</span></h2>
          <p className="text-xs text-zinc-400">
            設定各領域名額後，將下方教師依序拖到對應空缺。
            <span className="ml-2 text-zinc-500">已分配 {placedCount} / 空缺總數 {totalSlots}</span>
            <span className="ml-2 text-zinc-500">· 待安排 {poolTeachers.length}</span>
          </p>
          <p className="text-[11px] text-zinc-400 mt-1">
            {saveStatus === 'saving'
              ? <span className="text-zinc-500">儲存中…</span>
              : saveStatus === 'saved'
                ? <span className="text-green-600">✓ 已儲存於伺服器</span>
                : <span className="text-green-600">✓ 自動儲存於伺服器</span>}
            <span className="ml-1">（換電腦/瀏覽器皆同步；「套用到工作紀錄」後才會寫入分數）</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={applyToRotations} disabled={applying} className="btn-primary text-xs py-1 px-2">
            {applying ? '套用中…' : '套用到工作紀錄'}
          </button>
          <button onClick={resetAll} className="btn-secondary text-xs py-1 px-2">
            清空全部
          </button>
        </div>
      </div>

      {/* ── Step 1: 名額設定（可折疊）── */}
      <div className="card p-4 space-y-3">
        <button
          onClick={() => setQuotaCollapsed(v => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-sm font-semibold text-zinc-700">Step 1 — 名額設定</span>
          <span className="text-xs text-zinc-400">{quotaCollapsed ? '展開 ▾' : '收合 ▴'}</span>
        </button>

        {!quotaCollapsed && (
          <div className="space-y-4 pt-2 border-t border-zinc-100">
            {/* 科任名額 */}
            <div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">科任空缺數量（依領域）</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-2">
                {SUBJECT_AREAS.map(area => (
                  <div key={area} className="flex items-center gap-1.5">
                    <span className="text-xs text-zinc-700 whitespace-nowrap">{subjectDisplayLabel(area)}</span>
                    <NumberInput
                      min={0}
                      value={quotas.subjects[area] ?? 0}
                      onChange={n => setQuotas(q => ({ ...q, subjects: { ...q.subjects, [area]: n } }))}
                      className="input w-12 text-center py-0.5 text-xs flex-shrink-0"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 導師名額 */}
            <div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">導師空缺數量</div>
              <div className="space-y-2">
                {HOMEROOM_INPUT_PAIRS.map(({ normal, relay }) => (
                  <div key={normal.grade} className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-700 w-24 flex-shrink-0">{normal.shortLabel}一般班</span>
                      <NumberInput
                        min={0}
                        value={quotas.homerooms[normal.grade] ?? 0}
                        onChange={n => setQuotas(q => ({ ...q, homerooms: { ...q.homerooms, [normal.grade]: n } }))}
                        className="input w-12 text-center py-0.5 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-700 w-24 flex-shrink-0">{relay.shortLabel}接棒班</span>
                      <NumberInput
                        min={0}
                        value={quotas.homerooms[relay.grade] ?? 0}
                        onChange={n => setQuotas(q => ({ ...q, homerooms: { ...q.homerooms, [relay.grade]: n } }))}
                        className="input w-12 text-center py-0.5 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-zinc-400">行政空缺固定（每職位 1 個），不需設定。</p>
          </div>
        )}
      </div>

      {/* 中低年級警告訊息 */}
      {blockMsg && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 text-xs text-red-700 rounded-sm flex items-center justify-between">
          <span>🚫 {blockMsg}</span>
          <button onClick={() => setBlockMsg(null)} className="ml-2 opacity-50 hover:opacity-100">×</button>
        </div>
      )}

      {/* ── 雙欄：左側空缺表 / 右側待安排教師抽屜 ── */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-5">

      {/* ── 行政空缺 ── */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700">行政空缺</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ADMIN_GROUPS.map(group => (
            <div key={group.處} className="space-y-1">
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{group.處}</div>
              <div className="space-y-1">
                {group.positions.map(pos => renderSlot(`admin-${pos}`, pos))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 科任空缺 ── */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700">科任空缺</h3>
        {Object.values(quotas.subjects).every(n => n === 0) ? (
          <p className="text-xs text-zinc-400">尚未設定科任空缺數量（請至 Step 1 名額設定）</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {SUBJECT_AREAS.filter(a => quotas.subjects[a] > 0).map(area => (
              <div key={area} className="flex flex-col gap-1 flex-shrink-0">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide text-center w-[124px]">{area}</div>
                {Array.from({ length: quotas.subjects[area] }).map((_, i) =>
                  renderSlot(`subject-${area}-${i}`, `${area}領域科任`)
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 導師空缺 ── */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700">導師空缺</h3>
        {HOMEROOM_SLOTS.every(s => (quotas.homerooms[s.grade] ?? 0) === 0) ? (
          <p className="text-xs text-zinc-400">尚未設定導師空缺數量（請至 Step 1 名額設定）</p>
        ) : (
          <div className="space-y-3">
            {HOMEROOM_SLOTS.map(slot => {
              const count = quotas.homerooms[slot.grade] ?? 0
              if (count === 0) return null
              return (
                <div key={slot.grade} className="flex items-start gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-zinc-600 w-16 flex-shrink-0 pt-3">{slot.shortLabel}</div>
                  {Array.from({ length: count }).map((_, i) =>
                    renderSlot(`grade-${slot.grade}-${i}`, slot.label)
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

        </div>
        {/* /左側空缺表 */}

        {/* ── 右側抽屜：待安排教師 ── */}
        <aside className="flex-shrink-0 sticky top-0 self-start">
          {drawerOpen ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver('pool') }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
              onDrop={e => { e.preventDefault(); handleDrop('pool') }}
              className={`w-60 card p-3 space-y-2 max-h-[calc(100vh-2rem)] overflow-y-auto transition-colors ${
                dragOver === 'pool' ? 'border-zinc-500 bg-zinc-50' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-700">
                  待安排 <span className="text-xs font-normal text-zinc-400 ml-1">{poolTeachers.length}</span>
                </h3>
                <div className="flex items-center gap-1">
                  {placedCount > 0 && (
                    <button onClick={() => setPlacements({})} className="btn-secondary text-[11px] py-0.5 px-1.5">
                      還原
                    </button>
                  )}
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="w-5 h-5 flex items-center justify-center rounded border border-zinc-300 text-xs text-zinc-500 hover:bg-zinc-100"
                    title="收合抽屜"
                  >›</button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-400">依近四年總分排序</p>

              {poolTeachers.length === 0 ? (
                <p className="text-xs text-zinc-400 py-4 text-center">已全部安排完畢</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {poolTeachers.map(t => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragTeacherId(t.id) }}
                      onDragEnd={() => { setDragTeacherId(null); setDragOver(null) }}
                      className={`flex items-center gap-1.5 px-2 py-1.5 border border-zinc-200 bg-white rounded-sm cursor-grab active:cursor-grabbing text-xs select-none ${
                        dragTeacherId === t.id ? 'opacity-40' : 'hover:border-zinc-400'
                      }`}
                    >
                      <span className={`text-[10px] px-1 py-0 border rounded-sm flex-shrink-0 ${TARGET_BADGE_STYLE[t.targetType]}`}>
                        {t.targetType}
                      </span>
                      {t.midLowConsecutiveYears >= MIDLOW_LIMIT && (
                        <span className="text-[10px] text-red-500 font-bold flex-shrink-0" title={`連續${t.midLowConsecutiveYears}年中低年級`}>🚫</span>
                      )}
                      <span className="font-medium truncate flex-1">{t.name}</span>
                      <span className="text-[10px] text-zinc-400 flex-shrink-0 tabular-nums">{t.score.toFixed(2)}</span>
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); showDetail(t, e) }}
                        className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-700"
                      >i</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setDrawerOpen(true)}
              onDragOver={e => { e.preventDefault(); setDragOver('pool') }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => { e.preventDefault(); handleDrop('pool') }}
              className={`w-9 card p-2 flex flex-col items-center gap-2 py-3 hover:bg-zinc-50 transition-colors ${
                dragOver === 'pool' ? 'border-zinc-500 bg-zinc-50' : ''
              }`}
              title="展開待安排教師"
              style={{ writingMode: 'vertical-rl' }}
            >
              <span className="text-xs text-zinc-600 font-medium">待安排 {poolTeachers.length}</span>
              <span className="text-zinc-400 text-[10px]">‹ 展開</span>
            </button>
          )}
        </aside>
      </div>
      {/* /雙欄 */}

      {/* 浮動教師資訊卡 */}
      {detailTeacher && detailPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setDetailTeacher(null); setDetailPos(null) }} />
          <div
            className="fixed z-50 w-56 bg-white border border-zinc-200 shadow-lg rounded p-3 space-y-2 text-xs"
            style={{ left: detailPos.x, top: detailPos.y }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-sm text-zinc-800 truncate">{detailTeacher.name}</span>
              <button
                onClick={() => { setDetailTeacher(null); setDetailPos(null) }}
                className="text-zinc-400 hover:text-zinc-600 text-base leading-none"
              >×</button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-block text-[11px] px-1.5 py-0.5 border rounded-sm ${TARGET_BADGE_STYLE[detailTeacher.targetType]}`}>
                {detailTeacher.targetType}
              </span>
              {detailTeacher.prefLocked && (
                <span className="inline-block text-[11px] px-1.5 py-0.5 border rounded-sm bg-zinc-100 border-zinc-300 text-zinc-700">
                  🔒 已鎖定
                </span>
              )}
              {detailTeacher.prefGiveUp && (
                <span className="inline-block text-[11px] px-1.5 py-0.5 border rounded-sm bg-amber-50 border-amber-200 text-amber-700">
                  放棄選填
                </span>
              )}
            </div>
            <div className="space-y-1.5 text-zinc-600">
              <div className="flex justify-between">
                <span className="text-zinc-400">近四年總分</span>
                <span className="font-medium text-zinc-800">{detailTeacher.score.toFixed(2)} 分</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">年資積分</span>
                <span className="font-medium text-zinc-800">{detailTeacher.seniorityScore.toFixed(2)}
                  <span className="text-zinc-400 ml-1">
                    （關埔 {(detailTeacher.kanpuFormalYears + detailTeacher.kanpuSubstituteYears).toFixed(2)}／他校 {detailTeacher.otherSchoolYears}）
                  </span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">現任職位</span>
                <span className="font-medium text-zinc-800">{detailTeacher.currentWork ?? '—'}</span>
              </div>
              {detailTeacher.midLowConsecutiveYears > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">中低年級連續</span>
                  <span className={`font-medium ${detailTeacher.midLowConsecutiveYears >= MIDLOW_LIMIT ? 'text-red-600' : 'text-zinc-800'}`}>
                    {detailTeacher.midLowConsecutiveYears} 年
                    {detailTeacher.midLowConsecutiveYears >= MIDLOW_LIMIT && '（須排高年級）'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
