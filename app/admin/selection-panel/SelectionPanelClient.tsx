'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { TARGET_BADGE_STYLE } from '@/lib/rotation-target'
import { NumberInput } from '@/components/ui/NumberInput'
import type { PanelTeacher } from './page'

interface Props {
  teachers: PanelTeacher[]
  midLowWorks: string[]
  preferenceYear: number
}

// 行政空缺：固定 4 處，每職位 1 個位置
const ADMIN_GROUPS: { 處: string; positions: string[] }[] = [
  { 處: '教務處', positions: ['教務主任', '註冊組長', '課務組長', '課發組長', '資訊組長'] },
  { 處: '學務處', positions: ['學務主任', '生教組長', '體健組長', '活動組長', '環衛組長'] },
  { 處: '總務處', positions: ['總務主任', '文書組長'] },
  { 處: '輔導處', positions: ['輔導主任', '輔導組長', '親職組長', '特教組長'] },
]

// 科任 領域（admin 輸入各領域名額）
const SUBJECT_AREAS = ['科技創新任務', '體育', '英語', '社會', '自然', '音樂', '表藝', '視藝', '生活', '其他']

// 導師空缺：六個年級各自獨立
//   一/三/五年級 = 一般導師（新一輪開始）
//   二/四/六年級 = 接棒班（接續上一位導師、把學生帶到一輪結束）
interface HomeroomSlot {
  grade: 1 | 2 | 3 | 4 | 5 | 6
  kind: 'normal' | 'relay'
  work: string         // 對應 scoremap 中的職位名
  label: string        // 顯示用：「一年級」、「二年級接棒班」…
  shortLabel: string   // 列首顯示：「一年級」、「二年級」…
}

const HOMEROOM_SLOTS: HomeroomSlot[] = [
  { grade: 1, kind: 'normal', work: '低年級導師', label: '低年級導師',  shortLabel: '一年級' },
  { grade: 2, kind: 'relay',  work: '低年級接棒班', label: '低年級接棒班', shortLabel: '二年級' },
  { grade: 3, kind: 'normal', work: '中年級導師', label: '中年級導師',  shortLabel: '三年級' },
  { grade: 4, kind: 'relay',  work: '中年級接棒班', label: '中年級接棒班', shortLabel: '四年級' },
  { grade: 5, kind: 'normal', work: '高年級導師', label: '高年級導師',  shortLabel: '五年級' },
  { grade: 6, kind: 'relay',  work: '高年級接棒班', label: '高年級接棒班', shortLabel: '六年級' },
]

// quota 輸入時的成對排版：(grade1 + grade2), (grade3 + grade4), (grade5 + grade6)
const HOMEROOM_INPUT_PAIRS: { normal: HomeroomSlot; relay: HomeroomSlot }[] = [
  { normal: HOMEROOM_SLOTS[0], relay: HOMEROOM_SLOTS[1] },
  { normal: HOMEROOM_SLOTS[2], relay: HOMEROOM_SLOTS[3] },
  { normal: HOMEROOM_SLOTS[4], relay: HOMEROOM_SLOTS[5] },
]

interface Quotas {
  subjects: Record<string, number>
  homerooms: Record<number, number>  // grade 1..6 → count
}

const DEFAULT_QUOTAS: Quotas = {
  subjects: Object.fromEntries(SUBJECT_AREAS.map(a => [a, 0])),
  homerooms: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
}

const MIDLOW_LIMIT = 8

// 科任領域顯示名稱：除「科技創新任務」與「其他」外，其餘都加「領域」
function subjectDisplayLabel(area: string): string {
  return (area === '科技創新任務' || area === '其他') ? area : `${area}領域`
}

export default function SelectionPanelClient({ teachers, midLowWorks, preferenceYear }: Props) {
  const router = useRouter()
  const midLowSet = useMemo(() => new Set(midLowWorks), [midLowWorks])
  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [quotaCollapsed, setQuotaCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [quotas, setQuotas] = useState<Quotas>(DEFAULT_QUOTAS)
  const [placements, setPlacements] = useState<Record<string, string>>({}) // teacherId → slotId
  const [hydrated, setHydrated] = useState(false)

  // ── 從 localStorage 還原 + 自動儲存（每個年度各自一份）──
  // 注意：v2 schema 把 homerooms 從 {grade: {normal, relay}} 改成 {1..6: number}，
  //       不相容 v1 → 用新 key 讓舊資料失效（使用者重新設定即可）。
  const STORAGE_KEY = `trotate-selection-panel-v2-${preferenceYear}`
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as { quotas?: Quotas; placements?: Record<string, string> }
        if (saved.quotas) setQuotas(saved.quotas)
        if (saved.placements) setPlacements(saved.placements)
      }
    } catch {}
    setHydrated(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ quotas, placements }))
    } catch {}
  }, [quotas, placements, hydrated, STORAGE_KEY])

  function resetAll() {
    if (!confirm('確定要清空所有名額設定與已分配教師？此操作無法復原。')) return
    setQuotas(DEFAULT_QUOTAS)
    setPlacements({})
    try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
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
            <span className="text-green-600">✓ 已自動儲存於此瀏覽器</span>
            <span className="ml-1">（重新整理仍在；換電腦或換瀏覽器則不會同步）</span>
          </p>
        </div>
        <button onClick={resetAll} className="btn-secondary text-xs py-1 px-2 flex-shrink-0">
          清空全部
        </button>
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
