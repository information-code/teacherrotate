'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import { assembleEngineInput, type EngineResult, type PlacedResult, type RoomInfo } from '@/lib/schedule-engine'
import type { GradeSubject } from '../schedule-config/page'

interface Props {
  year: number
  scheduleConfig: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  gradeHomeroomBase: Record<number, number>
  teacherNames: Record<string, string>
  lastGeneratedAt: string | null
}

type Progress = { iter: number; best: number; softBest: number; elapsed: number; placed: number; unplaced: number; sinceImproveMs: number }
type ViewKey = 'class' | 'teacher' | 'room'

export default function ScheduleWizardClient(props: Props) {
  const { year, scheduleConfig, classCounts, gradeSubjects, gradeHomeroomBase, teacherNames } = props
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<EngineResult | null>(null)
  const [view, setView] = useState<ViewKey>('class')
  const [gradeSel, setGradeSel] = useState<number>(GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1)
  const [teacherSel, setTeacherSel] = useState('')
  const [roomSel, setRoomSel] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const workerRef = useRef<Worker | null>(null)
  useEffect(() => () => workerRef.current?.terminate(), [])

  const { input, preflight } = useMemo(
    () => assembleEngineInput({ config: scheduleConfig, classCounts, gradeSubjects, gradeHomeroomBase, teacherNames }),
    [scheduleConfig, classCounts, gradeSubjects, gradeHomeroomBase, teacherNames],
  )
  const errors = preflight.filter(p => p.level === 'error')
  const warns = preflight.filter(p => p.level === 'warn')

  function run() {
    workerRef.current?.terminate()
    setResult(null); setProgress(null); setRunning(true); setSaveStatus('idle')
    const w = new Worker(new URL('./schedule.worker.ts', import.meta.url))
    workerRef.current = w
    w.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'progress') setProgress(e.data as Progress)
      else if (e.data.type === 'done') {
        setResult(e.data.result as EngineResult)
        setRunning(false)
        w.terminate()
      }
    }
    w.postMessage({ input })
  }
  function stop() {
    // 通知 Worker 停止並回傳目前最佳解（結果由 done 訊息帶回）
    workerRef.current?.postMessage({ type: 'stop' })
  }
  async function save() {
    if (!result) return
    setSaveStatus('saving')
    try {
      const res = await fetch('/api/admin/schedule-plan', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          plan: {
            totalPenalty: result.totalPenalty,
            placed: result.placed,
            unplaced: result.unplaced,
            penalties: result.penalties.map(p => ({ key: p.key, label: p.label, count: p.count, points: p.points })),
            uncoveredMustFill: result.uncoveredMustFill,
          },
        }),
      })
      setSaveStatus(res.ok ? 'saved' : 'error')
    } catch { setSaveStatus('error') }
  }

  // ── 檢視資料索引 ──
  const teachers = useMemo(() => {
    const ids = Array.from(new Set(input.lessons.map(l => l.teacherId)))
    return ids.map(id => ({ id, name: teacherNames[id] ?? '？' })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [input, teacherNames])
  const roomList: RoomInfo[] = input.rooms

  const byClass = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const p of result?.placed ?? []) m.set(p.classKey, [...(m.get(p.classKey) ?? []), p])
    return m
  }, [result])
  const byTeacher = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const p of result?.placed ?? []) m.set(p.teacherId, [...(m.get(p.teacherId) ?? []), p])
    return m
  }, [result])
  const byRoom = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const p of result?.placed ?? []) if (p.roomId) m.set(p.roomId, [...(m.get(p.roomId) ?? []), p])
    return m
  }, [result])

  function cellsOf(list: PlacedResult[]): Map<string, PlacedResult> {
    const m = new Map<string, PlacedResult>()
    for (const p of list) {
      m.set(`${p.day}-${p.period}`, p)
      if (p.size === 2) m.set(`${p.day}-${p.period + 1}`, p)
    }
    return m
  }

  function Grid({ list, mode, classKey }: { list: PlacedResult[]; mode: ViewKey; classKey?: string }) {
    const cells = cellsOf(list)
    const locks = classKey ? (input.lockedCells[classKey] ?? {}) : {}
    const avail = classKey ? new Set(input.classSlots[classKey] ?? []) : null
    const must = classKey ? new Set(input.classMustFill[classKey] ?? []) : new Set<string>()
    return (
      <table className="w-full table-fixed border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="w-6 text-zinc-400 font-normal"></th>
            {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map(q => (
            <tr key={q}>
              <td className="text-zinc-400 text-center">{q}</td>
              {SCHEDULE_DAYS.map(d => {
                const k = `${d}-${q}`
                const p = cells.get(k)
                if (p) {
                  const bi = p.parity !== 'weekly'
                  const text = mode === 'class' ? `${p.subject}` : mode === 'teacher' ? `${p.classLabel} ${p.subject}` : `${p.classLabel}`
                  return (
                    <td key={d} className="p-0.5">
                      <div className={`h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center text-center ${bi ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>
                        <span className="truncate w-full">{text}</span>
                        {mode === 'class' && <span className="truncate w-full text-[9px] opacity-70">{p.teacherName}</span>}
                        {bi && <span className="text-[8px] opacity-70">{p.parity === 'odd' ? '單週（雙週導師）' : '雙週（單週導師）'}</span>}
                      </div>
                    </td>
                  )
                }
                if (classKey && locks[k]) {
                  return <td key={d} className="p-0.5"><div className="h-9 rounded-sm border bg-zinc-200 border-zinc-300 text-zinc-600 flex items-center justify-center truncate px-0.5">{locks[k]}</div></td>
                }
                if (classKey && avail && !avail.has(k)) {
                  return <td key={d} className="p-0.5"><div className="h-9 rounded-sm bg-zinc-100" /></td>
                }
                return (
                  <td key={d} className="p-0.5">
                    <div className={`h-9 rounded-sm border border-dashed flex items-center justify-center ${must.has(k) ? 'border-red-300 bg-red-50 text-red-400' : 'border-zinc-200 text-zinc-300'}`}>
                      {classKey ? (must.has(k) ? '需科任!' : '導師') : ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const bigPenalty = (result?.penalties ?? []).filter(p => p.points >= 1e6)

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">排課精靈 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span></h2>
          <p className="text-xs text-zinc-400">一鍵排出科任教師與科任教室課表；班級課表留白＝導師自排空間。{props.lastGeneratedAt && `上次儲存：${new Date(props.lastGeneratedAt).toLocaleString('zh-TW')}`}</p>
        </div>
        <Link href="/admin/schedule-config?tab=weight" className="btn btn-secondary text-sm py-1">⚙ 調整權重設定</Link>
      </div>

      {/* 前置檢查 */}
      {(errors.length > 0 || warns.length > 0) && (
        <div className="card p-3 space-y-1">
          <div className="text-sm font-semibold text-zinc-700">前置檢查</div>
          {errors.map((p, i) => <p key={`e${i}`} className="text-xs text-red-600">✕ {p.text}</p>)}
          {warns.map((p, i) => <p key={`w${i}`} className="text-xs text-amber-600">⚠ {p.text}</p>)}
        </div>
      )}

      {/* 執行 */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        {!running
          ? <button onClick={run} disabled={errors.length > 0 || input.lessons.length === 0} className="btn btn-primary text-sm py-1">▶ 開始排課</button>
          : <button onClick={stop} className="btn btn-secondary text-sm py-1">■ 停止並採用目前結果</button>}
        <span className="text-xs text-zinc-400">
          共 {input.lessons.length} 堂科任課待排。引擎會持續優化，連續 8 秒沒有進步就自動完成。
        </span>
        {running && progress && (
          <span className="text-xs text-zinc-500 ml-auto flex items-center gap-2">
            <span>已排 {progress.placed}/{input.lessons.length}｜軟規則罰分 {Math.round(progress.softBest)}｜迭代 {progress.iter.toLocaleString()}</span>
            <span className="text-zinc-400">
              {progress.sinceImproveMs < 1500 ? '持續進步中…' : `${Math.floor(progress.sinceImproveMs / 1000)} 秒無進步`}
            </span>
            <span className="inline-block w-20 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
              <span className="block h-full bg-zinc-600 rounded-full transition-all" style={{ width: `${Math.min(100, (progress.sinceImproveMs / 8000) * 100)}%` }} />
            </span>
          </span>
        )}
      </div>

      {result && (
        <>
          {/* 摘要 */}
          <div className="flex gap-2 flex-wrap text-xs">
            <span className="px-2 py-1 rounded-sm bg-green-50 text-green-700 border border-green-200">已排 {result.placed.length} 堂</span>
            <span className={`px-2 py-1 rounded-sm border ${result.unplaced.length ? 'bg-red-50 text-red-700 border-red-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>未排 {result.unplaced.length} 堂</span>
            <span className={`px-2 py-1 rounded-sm border ${result.uncoveredMustFill.length ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
              {result.uncoveredMustFill.length ? `導師不排課未覆蓋 ${result.uncoveredMustFill.length} 格` : '✓ 導師不排課時段全覆蓋'}
            </span>
            <span className="px-2 py-1 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200">
              軟規則罰分 {Math.round(result.softPenalty)}{bigPenalty.length > 0 && `（另有必須級違反）`}
            </span>
            <span className="ml-auto flex gap-2 items-center">
              {saveStatus === 'saved' && <span className="text-green-600">✓ 已儲存</span>}
              {saveStatus === 'error' && <span className="text-red-600">儲存失敗</span>}
              <button onClick={save} disabled={saveStatus === 'saving'} className="btn btn-primary text-xs py-1">💾 儲存課表</button>
            </span>
          </div>

          {/* 未排清單 */}
          {result.unplaced.length > 0 && (
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-red-700">未排清單 <span className="text-xs font-normal text-zinc-400 ml-1">卡住的課與原因；可調權重重排，或之後手動處理</span></div>
              <table className="table-base mt-2">
                <thead><tr><th>班級</th><th>科目</th><th>教師</th><th>型態</th><th>卡住原因</th></tr></thead>
                <tbody>
                  {result.unplaced.map((u, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{u.lesson.classLabel}</td>
                      <td className="whitespace-nowrap">{u.lesson.subject}</td>
                      <td className="whitespace-nowrap">{u.lesson.teacherName}</td>
                      <td className="whitespace-nowrap text-xs">{u.lesson.size === 2 ? '連堂' : '單節'}{u.lesson.parity !== 'weekly' && '（單雙週）'}</td>
                      <td className="text-xs text-zinc-500">{u.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 三視圖 */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {(['class', 'teacher', 'room'] as ViewKey[]).map(v => (
                <button key={v} onClick={() => setView(v)} className={`btn text-sm py-1 ${view === v ? 'btn-primary' : 'btn-secondary'}`}>
                  {v === 'class' ? '班級課表' : v === 'teacher' ? '科任教師課表' : '科任教室課表'}
                </button>
              ))}
              {view === 'class' && (
                <span className="flex gap-1 flex-wrap ml-auto">
                  {GRADES.filter(g => (classCounts[g] ?? 0) > 0).map(g => (
                    <button key={g} onClick={() => setGradeSel(g)} className={`text-xs px-2 py-1 rounded-sm border ${gradeSel === g ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200'}`}>{GRADE_LABEL[g]}</button>
                  ))}
                </span>
              )}
              {view === 'teacher' && (
                <select value={teacherSel} onChange={e => setTeacherSel(e.target.value)} className="input py-1 text-sm w-44 ml-auto">
                  <option value="">選擇教師…</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {view === 'room' && (
                <select value={roomSel} onChange={e => setRoomSel(e.target.value)} className="input py-1 text-sm w-44 ml-auto">
                  <option value="">選擇教室…</option>
                  {roomList.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              )}
            </div>
            <p className="text-[11px] text-zinc-400">
              藍格＝科任課、紫格＝視藝單雙週（另一週為導師）、深灰格＝鎖課、虛線格＝導師自排留白、紅虛線＝導師不排課但未排入科任課。
            </p>

            {view === 'class' && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {input.classes.filter(c => c.grade === gradeSel).map(c => (
                  <div key={c.classKey} className="space-y-1">
                    <div className="text-sm font-semibold text-zinc-700">{c.label}
                      <span className="text-xs font-normal text-zinc-400 ml-1">留白 {(input.classSlots[c.classKey]?.length ?? 0) - (byClass.get(c.classKey) ?? []).reduce((s, p) => s + p.size, 0)} 格</span>
                    </div>
                    <Grid list={byClass.get(c.classKey) ?? []} mode="class" classKey={c.classKey} />
                  </div>
                ))}
              </div>
            )}
            {view === 'teacher' && (teacherSel
              ? <div className="max-w-md"><Grid list={byTeacher.get(teacherSel) ?? []} mode="teacher" /></div>
              : <p className="text-sm text-zinc-400 text-center py-4">請選擇教師。</p>)}
            {view === 'room' && (roomSel
              ? <div className="max-w-md"><Grid list={byRoom.get(roomSel) ?? []} mode="room" /></div>
              : <p className="text-sm text-zinc-400 text-center py-4">{roomList.length ? '請選擇教室。' : '教室設定中沒有綁定科目的科任教室。'}</p>)}
          </div>

          {/* 罰分明細 */}
          <div className="card p-3 space-y-2">
            <div className="text-sm font-semibold text-zinc-700">罰分明細
              <span className="text-xs font-normal text-zinc-400 ml-1">每條規則違反的次數與扣分；不滿意可 <Link href="/admin/schedule-config?tab=weight" className="text-sky-600 underline">調整權重</Link> 後重排</span>
            </div>
            {result.penalties.length === 0 && <p className="text-sm text-green-600">✓ 沒有任何軟規則違反，完美！</p>}
            {result.penalties.map(p => (
              <details key={p.key} className="border border-zinc-200 rounded-md">
                <summary className={`px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 ${p.points >= 1e6 ? 'text-red-700' : 'text-zinc-700'}`}>
                  <span className="flex-1">{p.points >= 1e6 && '🚨 '}{p.label}</span>
                  <span className="text-xs text-zinc-400">{p.count} 次｜{p.points >= 1e6 ? '必須級違反' : `${Math.round(p.points)} 分`}</span>
                </summary>
                <ul className="px-4 pb-2 text-xs text-zinc-500 list-disc pl-8 space-y-0.5">
                  {p.items.map((it, i) => <li key={i}>{it}</li>)}
                  {p.count > p.items.length && <li className="list-none text-zinc-400">…等共 {p.count} 筆</li>}
                </ul>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
