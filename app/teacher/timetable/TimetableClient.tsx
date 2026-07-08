'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, type BandGrid, type Band } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import type { TTPlaced } from './page'

interface Props {
  year: number
  userId: string
  myClassKey: string | null
  placed: TTPlaced[]
  homeroomCells: Record<string, Record<string, string>>   // classKey → slot → 科目（導師課）
  classTeacher: Record<string, string>
  bands: Record<Band, BandGrid>
  locks: Record<string, Record<string, string>>
  roomNames: Record<string, string>
  planStatus: string
}

type View = 'class' | 'teacher' | 'room'

/** 教師端課表：全員可看所有課表；預設進入看自己的（導師→自己班、科任→自己）。 */
export default function TimetableClient({ year, userId, myClassKey, placed, homeroomCells, classTeacher, bands, locks, roomNames, planStatus }: Props) {
  const iTeach = useMemo(() => placed.some(p => p.teacherId === userId), [placed, userId])
  const [view, setView] = useState<View>(myClassKey ? 'class' : 'teacher')
  const [classSel, setClassSel] = useState<string>(myClassKey ?? '')
  const [teacherSel, setTeacherSel] = useState<string>(!myClassKey && iTeach ? userId : '')
  const [roomSel, setRoomSel] = useState<string>('')

  const classKeys = useMemo(() => {
    const set = new Set<string>([...placed.map(p => p.classKey), ...Object.keys(classTeacher)])
    return Array.from(set).sort((a, b) => {
      const [ag, ai] = a.split('-').map(Number); const [bg, bi] = b.split('-').map(Number)
      return ag - bg || ai - bi
    })
  }, [placed, classTeacher])
  const teachers = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of placed) m.set(p.teacherId, p.teacherName)
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [placed])
  const roomIds = useMemo(() => Array.from(new Set(placed.filter(p => p.roomId).map(p => p.roomId as string)))
    .sort((a, b) => (roomNames[a] ?? '').localeCompare(roomNames[b] ?? '', 'zh-Hant')), [placed, roomNames])

  const labelOf = (ck: string) => { const [g, i] = ck.split('-').map(Number); return classLabel(g, i) }

  // 目前檢視的格子內容
  const cells = useMemo(() => {
    const m = new Map<string, { main: string; sub?: string; kind: 'subject' | 'hr' | 'lock'; bi?: string }>()
    const put = (day: number, period: number, v: { main: string; sub?: string; kind: 'subject' | 'hr' | 'lock'; bi?: string }) => m.set(`${day}-${period}`, v)
    if (view === 'class' && classSel) {
      for (const p of placed.filter(p => p.classKey === classSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        const v = { main: p.subject, sub: p.teacherName + (p.roomId ? `・${roomNames[p.roomId]}` : ''), kind: 'subject' as const, bi }
        put(p.day, p.period, v)
        if (p.size === 2) put(p.day, p.period + 1, v)
      }
      for (const [s, subj] of Object.entries(homeroomCells[classSel] ?? {})) {
        const [d, q] = s.split('-').map(Number)
        put(d, q, { main: subj, kind: 'hr' })
      }
      for (const [s, txt] of Object.entries(locks[classSel] ?? {})) {
        const [d, q] = s.split('-').map(Number)
        put(d, q, { main: txt, kind: 'lock' })
      }
    } else if (view === 'teacher' && teacherSel) {
      for (const p of placed.filter(p => p.teacherId === teacherSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        const v = { main: `${p.classLabel} ${p.subject}`, sub: p.roomId ? roomNames[p.roomId] : '原班', kind: 'subject' as const, bi }
        put(p.day, p.period, v)
        if (p.size === 2) put(p.day, p.period + 1, v)
      }
      // 導師自己的課（若此老師是導師）
      const ck = Object.entries(classTeacher).find(([, tid]) => tid === teacherSel)?.[0]
      if (ck) for (const [s, subj] of Object.entries(homeroomCells[ck] ?? {})) {
        const [d, q] = s.split('-').map(Number)
        put(d, q, { main: `${labelOf(ck)} ${subj}`, kind: 'hr' })
      }
    } else if (view === 'room' && roomSel) {
      for (const p of placed.filter(p => p.roomId === roomSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        const v = { main: p.classLabel, sub: `${p.subject}・${p.teacherName}`, kind: 'subject' as const, bi }
        put(p.day, p.period, v)
        if (p.size === 2) put(p.day, p.period + 1, v)
      }
    }
    return m
  }, [view, classSel, teacherSel, roomSel, placed, homeroomCells, locks, roomNames, classTeacher])

  // 班級檢視用該年段的可排格；教師/教室檢視用全 7 節
  const grid = view === 'class' && classSel ? bands[bandOf(Number(classSel.split('-')[0]))] : null
  const periods = Array.from({ length: grid?.periodsPerDay ?? 7 }, (_, i) => i + 1)

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="page-title mb-1">我的課表
          <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
          {planStatus === 'final'
            ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-sm bg-green-100 text-green-700 border border-green-200 align-middle">定案</span>
            : <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-sm bg-amber-50 text-amber-600 border border-amber-200 align-middle">初版（導師排課進行中，內容可能異動）</span>}
        </h2>
        <p className="text-xs text-zinc-400">
          可查看全校班級、教師與科任教室課表（唯讀）。藍格＝科任課、綠格＝導師課、深灰＝鎖課、紫格＝視藝單雙週。
          {planStatus === 'final'
            ? '課表已定案，如需調整請洽教務處。'
            : '初版期間，導師請至「排課選填」調整自己班級的課；其餘調整請洽教務處。'}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['class', 'teacher', 'room'] as View[]).map(v => (
          <button key={v} onClick={() => setView(v)} className={`btn text-sm py-1 ${view === v ? 'btn-primary' : 'btn-secondary'}`}>
            {v === 'class' ? '班級' : v === 'teacher' ? '教師' : '科任教室'}
          </button>
        ))}
        {view === 'class' && (
          <select value={classSel} onChange={e => setClassSel(e.target.value)} className="input py-1 text-sm w-40 ml-auto">
            <option value="">選擇班級…</option>
            {GRADES.map(g => {
              const list = classKeys.filter(ck => Number(ck.split('-')[0]) === g)
              return list.length ? (
                <optgroup key={g} label={GRADE_LABEL[g]}>
                  {list.map(ck => <option key={ck} value={ck}>{labelOf(ck)}{ck === myClassKey ? '（我的班）' : ''}</option>)}
                </optgroup>
              ) : null
            })}
          </select>
        )}
        {view === 'teacher' && (
          <select value={teacherSel} onChange={e => setTeacherSel(e.target.value)} className="input py-1 text-sm w-40 ml-auto">
            <option value="">選擇教師…</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}{t.id === userId ? '（我）' : ''}</option>)}
          </select>
        )}
        {view === 'room' && (
          <select value={roomSel} onChange={e => setRoomSel(e.target.value)} className="input py-1 text-sm w-40 ml-auto">
            <option value="">選擇教室…</option>
            {roomIds.map(id => <option key={id} value={id}>{roomNames[id] ?? id}</option>)}
          </select>
        )}
      </div>

      {((view === 'class' && !classSel) || (view === 'teacher' && !teacherSel) || (view === 'room' && !roomSel)) ? (
        <div className="card text-sm text-zinc-400 text-center py-8">請選擇要查看的{view === 'class' ? '班級' : view === 'teacher' ? '教師' : '教室'}。</div>
      ) : (
        <div className="card p-3">
          <table className="w-full table-fixed border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="w-7 text-zinc-400 font-normal"></th>
                {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.map(q => (
                <tr key={q}>
                  <td className="text-zinc-400 text-center">{q}</td>
                  {SCHEDULE_DAYS.map(d => {
                    const k = `${d}-${q}`
                    if (grid && !grid.teachable[k]) return <td key={d} className="p-0.5"><div className="h-11 rounded-sm bg-zinc-50" /></td>
                    const c = cells.get(k)
                    if (!c) return <td key={d} className="p-0.5"><div className="h-11 rounded-sm border border-dashed border-zinc-100" /></td>
                    const cls = c.kind === 'lock' ? 'bg-zinc-200 border-zinc-300 text-zinc-600'
                      : c.kind === 'hr' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : c.bi ? 'bg-violet-50 border-violet-200 text-violet-800'
                      : 'bg-sky-50 border-sky-200 text-sky-900'
                    return (
                      <td key={d} className="p-0.5">
                        <div className={`h-11 rounded-sm border px-0.5 flex flex-col items-center justify-center text-center leading-tight overflow-hidden ${cls}`}>
                          <span className="truncate w-full font-medium">{c.main}</span>
                          {c.sub && <span className="truncate w-full text-[9px] opacity-70">{c.sub}</span>}
                          {c.bi && <span className="text-[8px] opacity-70">{c.bi}</span>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
