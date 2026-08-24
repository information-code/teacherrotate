'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, type BandGrid, type Band, type ScheduleConfig, type DerivedNativeSession } from '@/lib/scheduling'
import type { RoomInfo } from '@/lib/schedule-engine'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import type { TTPlaced, LockCell, NativeSessionView } from './page'

interface Props {
  year: number
  userId: string
  myClassKey: string | null
  placed: TTPlaced[]
  homeroomCells: Record<string, Record<string, string>>   // classKey → slot → 科目（導師課）
  classTeacher: Record<string, string>
  bands: Record<Band, BandGrid>
  locks: Record<string, Record<string, LockCell>>
  roomNames: Record<string, string>
  nativeSessions: NativeSessionView[]
  nativeClassCells: { classKey: string; slot: string; teacherId: string }[]
  planStatus: string
  // 下載整份課表用（匯出程式較重，按下才動態載入）
  exportArgs: {
    config: ScheduleConfig
    classCounts: Record<number, number>
    homeroomLocks: Record<string, string[]>
    rooms: RoomInfo[]
    teacherNames: Record<string, string>
    nativeSessions: DerivedNativeSession[]
    nativeRoomNames: Record<string, string>
  }
  updatedAt: string | null
}

type View = 'class' | 'teacher' | 'room'

/** 教師端課表：全員可看所有課表；預設進入看自己的（導師→自己班、科任→自己）。 */
export default function TimetableClient({ year, userId, myClassKey, placed, homeroomCells, classTeacher, bands, locks, roomNames, nativeSessions, nativeClassCells, planStatus, exportArgs, updatedAt }: Props) {
  // 導師還在填自己班的課：內容會變動，這裡看到的是進度而不是定案
  const filling = planStatus === 'published'
  const [dlOpen, setDlOpen] = useState(false)
  const [dlScope, setDlScope] = useState<'this' | 'all' | '班級' | '教師' | '教室'>('this')
  const [dlStatus, setDlStatus] = useState<string | null>(null)
  /** 畫面上這一張課表是哪一份（對應 ExportSheet 的 section＋name）。 */
  function currentSheet(): { section: '班級' | '教師' | '教室'; name: string } | null {
    if (view === 'class' && classSel) return { section: '班級', name: labelOf(classSel) }
    if (view === 'teacher' && teacherSel) {
      const n = [...teachers, ...foreignList].find(t => t.id === teacherSel)?.name
      return n ? { section: '教師', name: n } : null
    }
    if (view === 'room' && roomSel && roomNames[roomSel]) return { section: '教室', name: roomNames[roomSel] }
    return null
  }
  /** 下載課表：預設只要畫面上這一張，也可整份或某一段。 */
  async function download(kind: 'pdf' | 'doc' | 'csv') {
    setDlOpen(false); setDlStatus('準備中…')
    try {
      const ex = await import('@/lib/schedule-export')
      const all = ex.buildExportSheets({
        year, placed: placed as never, config: exportArgs.config,
        input: { rooms: exportArgs.rooms, homeroomLocks: exportArgs.homeroomLocks },
        teacherNames: exportArgs.teacherNames, classCounts: exportArgs.classCounts,
        hrCells: homeroomCells, nativeSessions: exportArgs.nativeSessions, nativeRoomNames: exportArgs.nativeRoomNames,
      })
      const cur = dlScope === 'this' ? currentSheet() : null
      if (dlScope === 'this' && !cur) { alert('目前沒有選定任何一張課表。'); return }
      const sheets = dlScope === 'all' ? all
        : cur ? all.filter(x => x.section === cur.section && x.name === cur.name)
        : all.filter(x => x.section === dlScope)
      if (!sheets.length) { alert('這個範圍沒有可匯出的課表。'); return }
      // 還在填課就下載：紙本一旦印出來就追不回來，標題直接標明未定案
      const out = filling ? sheets.map(x => ({ ...x, title: `${x.title}（未定案・${new Date().toLocaleDateString('zh-TW')} 進度）` })) : sheets
      const base = (cur ? `${year}學年度 ${cur.name} 課表` : `${year}學年度課表（${dlScope === 'all' ? '班級＋科任教師＋科任教室' : dlScope}）`)
        + (filling ? '（未定案）' : '')
      if (kind === 'csv') { ex.saveBlob(new Blob([ex.sheetsToCsv(out)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`); return }
      if (kind === 'doc') { setDlStatus('產生 Word 中…'); ex.saveBlob(await ex.sheetsToDocx(out), `${base}.docx`); return }
      ex.saveBlob(await ex.sheetsToPdf(out, m => setDlStatus(m)), `${base}.pdf`)
    } catch (e) {
      alert(`下載失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally { setDlStatus(null) }
  }
  const iTeach = useMemo(() => placed.some(p => p.teacherId === userId || p.coTeacherId === userId), [placed, userId])
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
  // 外師（協同）：另列一群
  const foreignList = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of placed) if (p.coTeacherId) m.set(p.coTeacherId, p.coTeacherName ?? '外師')
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [placed])
  const roomIds = useMemo(() => Array.from(new Set([
    ...placed.filter(p => p.roomId).map(p => p.roomId as string),
    ...nativeSessions.map(s => s.roomId),
  ])).sort((a, b) => (roomNames[a] ?? '').localeCompare(roomNames[b] ?? '', 'zh-Hant')), [placed, nativeSessions, roomNames])

  const labelOf = (ck: string) => { const [g, i] = ck.split('-').map(Number); return classLabel(g, i) }

  // 目前檢視的格子內容
  const cells = useMemo(() => {
    const m = new Map<string, { main: string; sub?: string; kind: 'subject' | 'hr' | 'lock'; bi?: string; warn?: string }>()
    const put = (day: number, period: number, v: { main: string; sub?: string; kind: 'subject' | 'hr' | 'lock'; bi?: string; warn?: string }) => m.set(`${day}-${period}`, v)
    // 單雙週課只顯示一格：單週畫在起始節、雙週畫在次節（區塊另一格＝導師填課，同科兩節）
    const putPlaced = (p: TTPlaced, v: { main: string; sub?: string; kind: 'subject'; bi?: string }) => {
      if (p.parity !== 'weekly') { put(p.day, p.parity === 'odd' ? p.period : p.period + 1, v); return }
      put(p.day, p.period, v)
      if (p.size === 2) put(p.day, p.period + 1, v)
    }
    if (view === 'class' && classSel) {
      // 單雙週配對格 → 導師課的週型標記（與視藝互補、整塊兩節）
      const pairTag: Record<string, string> = {}
      for (const p of placed.filter(p => p.classKey === classSel && p.parity !== 'weekly')) {
        pairTag[`${p.day}-${p.parity === 'odd' ? p.period + 1 : p.period}`] = p.parity === 'odd' ? '雙週・兩節' : '單週・兩節'
      }
      for (const p of placed.filter(p => p.classKey === classSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        putPlaced(p, { main: p.subject + (p.coTeacherId ? ' ★' : ''), sub: p.teacherName + (p.coTeacherId ? `＋${p.coTeacherName ?? '外師'}` : '') + (p.roomId ? `・${roomNames[p.roomId]}` : ''), kind: 'subject' as const, bi })
      }
      for (const [s, subj] of Object.entries(homeroomCells[classSel] ?? {})) {
        const [d, q] = s.split('-').map(Number)
        // 科任課優先：導師填的內容絕不覆蓋科任課。同格還有導師資料＝課務組改過科任課、
        // 導師那格已過期，標紅提醒而不是把科任課蓋掉
        const cur = m.get(s)
        if (cur && cur.kind === 'subject') { m.set(s, { ...cur, warn: `另有導師填的「${subj}」與此格衝突` }); continue }
        put(d, q, { main: subj, kind: 'hr', bi: pairTag[s] })
      }
      for (const [s, lc] of Object.entries(locks[classSel] ?? {})) {
        const [d, q] = s.split('-').map(Number)
        put(d, q, { main: lc.main, sub: lc.sub, kind: 'lock' })
      }
    } else if (view === 'teacher' && teacherSel) {
      for (const p of placed.filter(p => p.teacherId === teacherSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        putPlaced(p, { main: `${p.classLabel} ${p.subject}${p.coTeacherId ? ' ★' : ''}`, sub: (p.coTeacherId ? `外師 ${p.coTeacherName ?? ''}・` : '') + (p.roomId ? roomNames[p.roomId] : '原班'), kind: 'subject' as const, bi })
      }
      // 外師（協同）：掛她的課——顯示班級、科目、搭配的中師
      for (const p of placed.filter(p => p.coTeacherId === teacherSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        putPlaced(p, { main: `${p.classLabel} ${p.subject}`, sub: `搭 ${p.teacherName}` + (p.roomId ? `・${roomNames[p.roomId]}` : ''), kind: 'subject' as const, bi })
      }
      // 閩南語師：原班本土語場次
      for (const c of nativeClassCells.filter(c => c.teacherId === teacherSel)) {
        const [d, q] = c.slot.split('-').map(Number)
        put(d, q, { main: `${labelOf(c.classKey)} 本土語`, sub: '原班（閩南語）', kind: 'lock' })
      }
      // 實體語師：本土語言教室場次
      for (const s of nativeSessions.filter(s => s.teacherId === teacherSel)) {
        const [d, q] = s.slot.split('-').map(Number)
        put(d, q, { main: `本土語（${s.lang}）`, sub: s.mode === 'stream' ? `線上・${s.roomLabel}` : s.roomLabel, kind: 'lock' })
      }
      // 導師自己的課（若此老師是導師）
      const ck = Object.entries(classTeacher).find(([, tid]) => tid === teacherSel)?.[0]
      if (ck) for (const [s, subj] of Object.entries(homeroomCells[ck] ?? {})) {
        const [d, q] = s.split('-').map(Number)
        const cur = m.get(s)
        if (cur && cur.kind === 'subject') { m.set(s, { ...cur, warn: `另有導師填的「${subj}」與此格衝突` }); continue }
        put(d, q, { main: `${labelOf(ck)} ${subj}`, kind: 'hr' })
      }
    } else if (view === 'room' && roomSel) {
      for (const p of placed.filter(p => p.roomId === roomSel)) {
        const bi = p.parity === 'odd' ? '單週' : p.parity === 'even' ? '雙週' : undefined
        putPlaced(p, { main: p.classLabel, sub: `${p.subject}・${p.teacherName}`, kind: 'subject' as const, bi })
      }
      // 本土語言教室：開課場次（實體含師名、共學不具名）
      for (const s of nativeSessions.filter(s => s.roomId === roomSel)) {
        const [d, q] = s.slot.split('-').map(Number)
        put(d, q, {
          main: `本土語（${s.lang}）`,
          sub: s.mode === 'physical' ? s.teacherName : `${s.teacherName}（線上）`,
          kind: 'lock',
        })
      }
    }
    return m
  }, [view, classSel, teacherSel, roomSel, placed, homeroomCells, locks, roomNames, classTeacher, nativeSessions, nativeClassCells])

  // 班級檢視用該年段的可排格；教師/教室檢視用全 7 節
  const grid = view === 'class' && classSel ? bands[bandOf(Number(classSel.split('-')[0]))] : null
  const periods = Array.from({ length: grid?.periodsPerDay ?? 7 }, (_, i) => i + 1)

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="page-title mb-1">我的課表
          <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
          <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-sm border align-middle ${filling
            ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-green-100 text-green-700 border-green-200'}`}>
            {filling ? '尚未定案' : '全校課表'}</span>
          {updatedAt && <span className="ml-2 text-[11px] text-zinc-400 align-middle">最後更新：{new Date(updatedAt).toLocaleString('zh-TW')}</span>}
        </h2>
        {filling && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1 mb-1">
            導師正在填排自己班的課，這裡看到的是<b>目前進度</b>，還會變動。
            提供給大家先看看誰哪一節有空、方便談調課；<b>要調課請和對方談好後洽教務處</b>，不要以這一版安排正式事務。
            {myClassKey && <>　您是班級導師——這一頁是唯讀的，要填排自己班的課請到左側「<a href="/teacher/schedule-fill" className="underline font-medium">排課選填</a>」。</>}
          </p>
        )}
        <p className="text-xs text-zinc-400">
          可查看全校班級、教師與科任教室課表（唯讀），也可下載。藍格＝科任課、綠格＝導師課、深灰＝鎖課、紫格＝視藝單雙週（單週顯示於起始節、雙週於次節，各代表隔週連堂兩節）。
          如需調整請洽教務處。
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="relative">
          <button onClick={() => setDlOpen(o => !o)} disabled={dlStatus !== null} className="btn btn-secondary text-sm py-1"
            title="下載全校課表：可選整份或只要班級／教師／教室">{dlStatus ?? '⬇ 下載課表 ▾'}</button>
          {dlOpen && (
            <span className="absolute z-20 mt-1 left-0 bg-white border border-zinc-200 rounded-sm shadow-lg p-2 w-52 flex flex-col gap-2">
              <label className="text-xs text-zinc-500 flex items-center gap-1.5">範圍
                <select value={dlScope} onChange={e => setDlScope(e.target.value as typeof dlScope)} className="input py-0.5 text-xs flex-1">
                  <option value="this">只要目前這一張</option>
                  {/* 未定案階段不給整份：自己那一張要印無妨，整份流出去就收不回來了 */}
                  {!filling && <>
                    <option value="all">整份（班級＋教師＋教室）</option>
                    <option value="班級">只要班級課表</option>
                    <option value="教師">只要教師課表</option>
                    <option value="教室">只要科任教室課表</option>
                  </>}
                </select>
              </label>
              <span className="flex gap-1">
                <button onClick={() => download('pdf')} className="btn btn-primary text-xs py-0.5 flex-1">PDF</button>
                <button onClick={() => download('doc')} className="btn btn-secondary text-xs py-0.5 flex-1">Word</button>
                <button onClick={() => download('csv')} className="btn btn-secondary text-xs py-0.5 flex-1">CSV</button>
              </span>
              <span className="text-[10px] text-zinc-400">
                {dlScope === 'this'
                  ? `目前這一張：${currentSheet()?.name ?? '（尚未選定）'}`
                  : '一張課表一頁，版面同人工課表。'}
                {filling && <><br />尚未定案，檔名與標題會標明；整份下載要等定案後。</>}
              </span>
            </span>
          )}
        </span>
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
            {foreignList.length > 0 && (
              <optgroup label="外師（協同）">
                {foreignList.map(t => <option key={t.id} value={t.id}>★{t.name}{t.id === userId ? '（我）' : ''}</option>)}
              </optgroup>
            )}
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
          {/* 手機上五天塞不進一個螢幕：硬塞會把「英語主題課」截成三個字。
              給最小寬度改成橫向捲動，節次那一欄釘住，捲的時候還看得出在第幾節。 */}
          <div className="overflow-x-auto -mx-3 px-3">
          <table className="w-full table-fixed border-collapse text-[11px] min-w-[520px]">
            <thead>
              <tr>
                <th className="w-7 text-zinc-400 font-normal sticky left-0 bg-white z-10"></th>
                {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.map(q => (
                <tr key={q}>
                  <td className="text-zinc-400 text-center sticky left-0 bg-white z-10">{q}</td>
                  {SCHEDULE_DAYS.map(d => {
                    const k = `${d}-${q}`
                    if (grid && !grid.teachable[k]) return <td key={d} className="p-0.5"><div className="h-11 rounded-sm bg-zinc-50" /></td>
                    const c = cells.get(k)
                    // 填課期間班級課表的空白＝導師還沒填，不是「這一節沒課」。
                    // 想找人調課的人最需要分清楚這兩種，不標的話會看成對方有空。
                    if (!c) return (
                      <td key={d} className="p-0.5">
                        <div className={`h-11 rounded-sm border border-dashed flex items-center justify-center ${filling && view === 'class'
                          ? 'border-amber-200 bg-amber-50/50' : 'border-zinc-100'}`}>
                          {filling && view === 'class' && <span className="text-[9px] text-amber-600/80">導師未填</span>}
                        </div>
                      </td>
                    )
                    const cls = c.kind === 'lock' ? 'bg-zinc-200 border-zinc-300 text-zinc-600'
                      : c.kind === 'hr' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : c.bi ? 'bg-violet-50 border-violet-200 text-violet-800'
                      : 'bg-sky-50 border-sky-200 text-sky-900'
                    return (
                      <td key={d} className="p-0.5">
                        <div title={c.warn ?? undefined}
                          className={`relative h-11 rounded-sm border px-0.5 flex flex-col items-center justify-center text-center leading-tight overflow-hidden ${c.warn ? 'ring-1 ring-red-400' : ''} ${cls}`}>
                          {c.warn && <span className="absolute top-0 right-0 text-[9px] leading-none text-red-500" aria-label="衝突">⚠</span>}
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
        </div>
      )}
    </div>
  )
}
