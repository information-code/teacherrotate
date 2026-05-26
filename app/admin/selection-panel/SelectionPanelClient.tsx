'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { TARGET_BADGE_STYLE } from '@/lib/rotation-target'
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

// 導師年級
const HOMEROOM_GRADES = [1, 3, 5] as const

interface Quotas {
  subjects: Record<string, number>
  homerooms: Record<number, { normal: number; relay: number }>
}

const DEFAULT_QUOTAS: Quotas = {
  subjects: Object.fromEntries(SUBJECT_AREAS.map(a => [a, 0])),
  homerooms: {
    1: { normal: 0, relay: 0 },
    3: { normal: 0, relay: 0 },
    5: { normal: 0, relay: 0 },
  },
}

const MIDLOW_LIMIT = 8

const GRADE_LABEL: Record<number, string> = { 1: '一年級', 3: '三年級', 5: '五年級' }

export default function SelectionPanelClient({ teachers, midLowWorks, preferenceYear }: Props) {
  const router = useRouter()
  const midLowSet = useMemo(() => new Set(midLowWorks), [midLowWorks])
  useEffect(() => { router.refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [quotaCollapsed, setQuotaCollapsed] = useState(false)
  const [quotas, setQuotas] = useState<Quotas>(DEFAULT_QUOTAS)
  const [placements, setPlacements] = useState<Record<string, string>>({}) // teacherId → slotId
  const [dragTeacherId, setDragTeacherId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [blockMsg, setBlockMsg] = useState<string | null>(null)
  const [detailTeacher, setDetailTeacher] = useState<PanelTeacher | null>(null)
  const [detailPos, setDetailPos] = useState<{ x: number; y: number } | null>(null)

  function place(teacherId: string, slotId: string) {
    // 檢查目標槽位是否會違反中低年級規則（連續 ≥ 8 年中低）
    const teacher = teachers.find(t => t.id === teacherId)
    if (teacher && teacher.midLowConsecutiveYears >= MIDLOW_LIMIT) {
      // 是否為中低年級導師槽位
      let placedWork: string | null = null
      if (slotId.startsWith('grade-1-')) placedWork = '低年級導師'
      else if (slotId.startsWith('grade-3-')) placedWork = '中年級導師'
      else if (slotId.startsWith('relay-1-')) placedWork = '低年級接棒班'
      else if (slotId.startsWith('relay-3-')) placedWork = '中年級接棒班'
      if (placedWork && midLowSet.has(placedWork)) {
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
    HOMEROOM_GRADES.reduce((s, g) => s + quotas.homerooms[g].normal + quotas.homerooms[g].relay, 0)

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
      <div>
        <h2 className="page-title mb-1">選填面板 <span className="text-sm font-normal text-zinc-500 ml-2">{preferenceYear} 學年度 撕榜</span></h2>
        <p className="text-xs text-zinc-400">
          設定各領域名額後，將下方教師依序拖到對應空缺。
          <span className="ml-2 text-zinc-500">已分配 {placedCount} / 空缺總數 {totalSlots}</span>
          <span className="ml-2 text-zinc-500">· 待安排 {poolTeachers.length}</span>
        </p>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {SUBJECT_AREAS.map(area => (
                  <div key={area} className="flex items-center gap-2">
                    <span className="text-xs text-zinc-700 flex-1 truncate" title={area}>{area}</span>
                    <input
                      type="number"
                      min={0}
                      value={quotas.subjects[area] ?? 0}
                      onChange={e => setQuotas(q => ({ ...q, subjects: { ...q.subjects, [area]: Math.max(0, Number(e.target.value)) } }))}
                      className="input w-12 text-center py-0.5 text-xs flex-shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 導師名額 */}
            <div>
              <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">導師空缺數量</div>
              <div className="space-y-2">
                {HOMEROOM_GRADES.map(g => (
                  <div key={g} className="flex items-center gap-4">
                    <span className="text-xs text-zinc-700 w-16 flex-shrink-0">{GRADE_LABEL[g]}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">一般</span>
                      <input
                        type="number"
                        min={0}
                        value={quotas.homerooms[g].normal}
                        onChange={e => setQuotas(q => ({
                          ...q,
                          homerooms: { ...q.homerooms, [g]: { ...q.homerooms[g], normal: Math.max(0, Number(e.target.value)) } }
                        }))}
                        className="input w-12 text-center py-0.5 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">接棒班</span>
                      <input
                        type="number"
                        min={0}
                        value={quotas.homerooms[g].relay}
                        onChange={e => setQuotas(q => ({
                          ...q,
                          homerooms: { ...q.homerooms, [g]: { ...q.homerooms[g], relay: Math.max(0, Number(e.target.value)) } }
                        }))}
                        className="input w-12 text-center py-0.5 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
        {HOMEROOM_GRADES.every(g => quotas.homerooms[g].normal === 0 && quotas.homerooms[g].relay === 0) ? (
          <p className="text-xs text-zinc-400">尚未設定導師空缺數量（請至 Step 1 名額設定）</p>
        ) : (
          <div className="space-y-3">
            {HOMEROOM_GRADES.map(g => {
              const { normal, relay } = quotas.homerooms[g]
              if (normal === 0 && relay === 0) return null
              const normalLabel = g === 1 ? '低年級導師' : g === 3 ? '中年級導師' : '高年級導師'
              const relayLabel = g === 1 ? '低年級接棒班' : g === 3 ? '中年級接棒班' : '高年級接棒班'
              return (
                <div key={g} className="flex items-start gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-zinc-600 w-16 flex-shrink-0 pt-3">{GRADE_LABEL[g]}</div>
                  {Array.from({ length: normal }).map((_, i) =>
                    renderSlot(`grade-${g}-${i}`, normalLabel)
                  )}
                  {relay > 0 && (
                    <>
                      {normal > 0 && <div className="self-stretch w-px bg-zinc-200 mx-1" />}
                      {Array.from({ length: relay }).map((_, i) =>
                        renderSlot(`relay-${g}-${i}`, relayLabel)
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 教師清單 (pool) ── */}
      <div
        className={`card p-4 space-y-3 ${dragOver === 'pool' ? 'border-zinc-400 bg-zinc-50' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver('pool') }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null) }}
        onDrop={e => { e.preventDefault(); handleDrop('pool') }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-700">
            待安排教師 <span className="text-xs font-normal text-zinc-400 ml-1">{poolTeachers.length} 位（依分數排序）</span>
          </h3>
          {placedCount > 0 && (
            <button onClick={() => setPlacements({})} className="btn-secondary text-xs py-1 px-2">
              全部還原
            </button>
          )}
        </div>

        {poolTeachers.length === 0 ? (
          <p className="text-xs text-zinc-400">所有教師都已安排完畢</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {poolTeachers.map(t => (
              <div
                key={t.id}
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragTeacherId(t.id) }}
                onDragEnd={() => { setDragTeacherId(null); setDragOver(null) }}
                className={`flex items-center gap-1 px-2 py-1 border border-zinc-200 bg-white rounded-sm cursor-grab active:cursor-grabbing text-xs select-none ${
                  dragTeacherId === t.id ? 'opacity-40' : 'hover:border-zinc-400'
                }`}
              >
                <span className={`text-[10px] px-1 py-0 border rounded-sm ${TARGET_BADGE_STYLE[t.targetType]}`}>
                  {t.targetType}
                </span>
                {t.midLowConsecutiveYears >= MIDLOW_LIMIT && (
                  <span className="text-[10px] text-red-500 font-bold" title={`連續${t.midLowConsecutiveYears}年中低年級`}>🚫</span>
                )}
                <span className="font-medium">{t.name}</span>
                <span className="text-[10px] text-zinc-400">{t.score.toFixed(2)}</span>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); showDetail(t, e) }}
                  className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full border border-zinc-300 text-[10px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-700"
                >i</button>
              </div>
            ))}
          </div>
        )}
      </div>

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
