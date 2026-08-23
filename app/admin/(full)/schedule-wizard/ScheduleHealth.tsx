'use client'

import { useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, homeroomLockSlots, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES } from '@/lib/allocation'
import type { PlacedResult } from '@/lib/schedule-engine'
import type { HomeroomRow } from './OverviewAdjust'
import type { ChainSeed } from './ChainAdjustModal'

/* ────────────────────────────────────────────────────────────────────────────
   課表體檢：把「罰分明細」翻譯成課務組看得懂的東西。

   罰分是給引擎比較用的，「同型態同日 ×23＝207 分」對人沒有意義。這裡改成三張
   熱力圖（導師／科任／鐘點）＋一份對照人工課表的體檢表，紅格子點下去直接開連鎖調課。

   全部從落點與設定即時算出來，不需要跑引擎，所以切版本立刻重畫。
   ──────────────────────────────────────────────────────────────────────────── */

/** 本校 112-1、113-1、114-1、114-2 四期人工課表的實際數字（scripts/hand-*.json 統計）。
 *  熱力圖上的紅格子到底算不算嚴重，要有尺規才知道——例如「導師連上 5 節」人工每期都有 1～2 個。 */
const HAND = {
  hrNoDay: [0, 5], hr5: [7, 15], hr6: [0, 1], hrAm: [35, 88], run4: [10, 23], run5: [0, 2],
  lonely: [11, 18], gapSlots: [85, 133], gapDays: [55, 82], half1: [44, 58],
} as const
const HAND_TERMS = '112-1、113-1、114-1、114-2 四期'

interface Props {
  placed: PlacedResult[]
  hr: Record<string, HomeroomRow>
  config: ScheduleConfig
  classCounts: Record<number, number>
  teacherNames: Record<string, string>
  hourlyTeacherIds: string[]
  /** 各班導師自己要上的科目節數：用來判斷哪些鎖課（種子班國數）是導師的課 */
  homeroomHours: Record<string, Record<string, number>>
  /** 不進引擎的固定課（本土語原班／語別場次）：老師照樣要到校上課，不算進去空堂與到校天數都會錯 */
  extraByTeacher: Map<string, { slot: string }[]>
  onOpenChain?: (seed: ChainSeed) => void
}

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const MORNING_LAST = 4

export default function ScheduleHealth({ placed, hr, config, classCounts, teacherNames, hourlyTeacherIds, homeroomHours, extraByTeacher, onOpenChain }: Props) {
  const [tab, setTab] = useState<'homeroom' | 'teacher' | 'hourly'>('homeroom')
  const nameOf = (id: string) => teacherNames[id] ?? '？'

  /* ── 導師端：每個「班日」算導師節數、上午節數、最長連上 ── */
  const homeroom = useMemo(() => {
    const cells = new Map<string, Map<string, PlacedResult>>()
    for (const p of placed) {
      const cm = cells.get(p.classKey) ?? new Map<string, PlacedResult>()
      for (const s of (p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`])) cm.set(s, p)
      cells.set(p.classKey, cm)
    }
    const hm = config.weights.builtin.homeroomDailyMax
    const rows: { ck: string; label: string; teacher: string; days: { d: number; n: number; am: number; run: number; cap: number; full: boolean }[] }[] = []
    const tally = { hrNoDay: 0, hr5: 0, hr6: 0, hrAm: 0, run4: 0, run5: 0 }
    for (const g of GRADES) for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const ck = `${g}-${i}`
      const grid = config.bands[bandOf(g)]
      const locks = config.lockCells[ck] ?? {}
      // 種子班的國語、數學鎖課本來就是導師自己上的，要算進導師節數；本土語那種才是別人的課
      const hrLocks = new Set(homeroomLockSlots(config, g, i, homeroomHours[ck]))
      const cm = cells.get(ck) ?? new Map<string, PlacedResult>()
      const days = SCHEDULE_DAYS.map(d => {
        const slots: number[] = []
        for (let p = 1; p <= grid.periodsPerDay; p++) if (grid.teachable[`${d}-${p}`]) slots.push(p)
        const mine = slots.filter(p => {
          const k = `${d}-${p}`
          if (cm.has(k)) return false                    // 科任課
          if (locks[k] && !hrLocks.has(k)) return false  // 別人的鎖課（本土語…）
          return true                                     // 空白或導師自己的鎖課
        })
        const full = slots.some(p => p > MORNING_LAST)
        const cap = bandOf(g) === 'low' && full ? Math.max(hm.hardN, hm.hardFullDayLowN) : hm.hardN
        let run = 0, best = 0, prev = -9
        for (const p of mine) { run = p === prev + 1 ? run + 1 : 1; prev = p; best = Math.max(best, run) }
        if (slots.length) {
          if (mine.length === 0) tally.hrNoDay++
          if (mine.length >= 5) tally.hr5++
          if (mine.length >= 6) tally.hr6++
          if (mine.filter(p => p <= MORNING_LAST).length < 2) tally.hrAm++
          if (best >= 4) tally.run4++
          if (best >= 5) tally.run5++
        }
        return { d, n: mine.length, am: mine.filter(p => p <= MORNING_LAST).length, run: best, cap, full }
      })
      rows.push({ ck, label: classLabel(g, i), teacher: nameOf(config.classTeacher[ck] ?? ''), days })
    }
    return { rows, tally }
  }, [placed, config, classCounts, teacherNames, homeroomHours])

  /* ── 科任端：每位老師每天的節數、零碎空堂、孤堂日、半天只上 1 節 ── */
  const teachers = useMemo(() => {
    const byT = new Map<string, Map<number, number[]>>()
    const put = (tid: string, day: number, qs: number[]) => {
      const dm = byT.get(tid) ?? new Map<number, number[]>()
      dm.set(day, [...(dm.get(day) ?? []), ...qs])
      byT.set(tid, dm)
    }
    for (const p of placed) put(p.teacherId, p.day, p.size === 2 ? [p.period, p.period + 1] : [p.period])
    // 本土語不進引擎，但老師照樣要到校上那一節。不算進來的話：空堂會多算（其實被本土語填住了）、
    // 孤堂日會多算、鐘點的到校天數會少算——而人工課表的基準線是有把本土語算進去的，不補就不是同一個標準。
    extraByTeacher.forEach((cells, tid) => {
      for (const c of cells) { const [d, q] = c.slot.split('-').map(Number); put(tid, d, [q]) }
    })
    const rows: { tid: string; name: string; total: number; days: { d: number; n: number; gap: number; lonely: boolean; half1: boolean }[] }[] = []
    const tally = { lonely: 0, gapSlots: 0, gapDays: 0, half1: 0 }
    byT.forEach((dm, tid) => {
      let total = 0
      const days = SCHEDULE_DAYS.map(d => {
        const qs = Array.from(new Set(dm.get(d) ?? [])).sort((a, b) => a - b)
        total += qs.length
        const gap = qs.length > 1 ? qs.slice(1).reduce((s, q, i) => s + (q - qs[i] - 1), 0) : 0
        const am = qs.filter(q => q <= MORNING_LAST).length, pm = qs.length - am
        const lonely = qs.length === 1
        const half1 = (am === 1 ? 1 : 0) + (pm === 1 ? 1 : 0) > 0
        if (qs.length) {
          if (lonely) tally.lonely++
          if (gap) { tally.gapSlots += gap; tally.gapDays++ }
          tally.half1 += (am === 1 ? 1 : 0) + (pm === 1 ? 1 : 0)
        }
        return { d, n: qs.length, gap, lonely, half1 }
      })
      rows.push({ tid, name: nameOf(tid), total, days })
    })
    rows.sort((a, b) => b.days.reduce((s, x) => s + x.gap, 0) - a.days.reduce((s, x) => s + x.gap, 0) || b.total - a.total)
    return { rows, tally }
  }, [placed, teacherNames, extraByTeacher])

  /* ── 鐘點：到校天數（他們在乎的是要跑幾趟，不是幾節） ── */
  const hourly = useMemo(() => {
    const set = new Set(hourlyTeacherIds)
    return teachers.rows.filter(r => set.has(r.tid))
      .map(r => ({ ...r, comeDays: r.days.filter(d => d.n > 0).length }))
      .sort((a, b) => b.comeDays - a.comeDays)
  }, [teachers, hourlyTeacherIds])

  /* ── 體檢表：跟人工課表比 ── */
  const CD = '班日', TD = '老師日'
  const checks = [
    { name: '導師整天沒課', unit: CD, v: homeroom.tally.hrNoDay, hand: HAND.hrNoDay, bad: (v: number) => v > 0 },
    { name: '導師一天 5 節以上', unit: CD, v: homeroom.tally.hr5, hand: HAND.hr5, bad: () => false },
    { name: '導師一天 6 節以上', unit: CD, v: homeroom.tally.hr6, hand: HAND.hr6, bad: () => false },
    { name: '導師上午不足 2 節', unit: CD, v: homeroom.tally.hrAm, hand: HAND.hrAm, bad: () => false },
    { name: '導師連上 4 節以上', unit: CD, v: homeroom.tally.run4, hand: HAND.run4, bad: () => false },
    { name: '導師連上 5 節以上', unit: CD, v: homeroom.tally.run5, hand: HAND.run5, bad: () => false },
    { name: '老師孤堂日（一天只 1 節）', unit: TD, v: teachers.tally.lonely, hand: HAND.lonely, bad: () => false },
    { name: '老師零碎空堂', unit: '節', v: teachers.tally.gapSlots, hand: HAND.gapSlots, bad: () => false },
    { name: '老師有零碎空堂的日數', unit: TD, v: teachers.tally.gapDays, hand: HAND.gapDays, bad: () => false },
    { name: '老師半天只上 1 節', unit: '半天', v: teachers.tally.half1, hand: HAND.half1, bad: () => false },
  ]
  const verdict = (v: number, [lo, hi]: readonly [number, number] | number[]) =>
    v < lo ? { txt: '優於人工', cls: 'text-green-700 bg-green-50 border-green-200' }
      : v <= hi ? { txt: '在人工範圍內', cls: 'text-zinc-600 bg-zinc-50 border-zinc-200' }
      : { txt: '比人工差', cls: 'text-red-700 bg-red-50 border-red-200' }

  const TAB = [
    { k: 'homeroom' as const, t: '導師', n: homeroom.rows.length },
    { k: 'teacher' as const, t: '科任老師', n: teachers.rows.length },
    { k: 'hourly' as const, t: '鐘點老師', n: hourly.length },
  ]

  return (
    <div className="space-y-3">
      {/* 體檢表 */}
      <div className="card p-3">
        <div className="text-sm font-semibold text-zinc-700 mb-1">課表體檢</div>
        <p className="text-[11px] text-zinc-400 mb-2">
          和本校 {HAND_TERMS}人工排的課表比。「在人工範圍內」代表這一版跟老師們過去幾年實際上到的課表差不多。
          <br />班日＝一個班的一天（62 班 × 5 天＝310）；老師日＝一位科任的一天。本土語（不進引擎的固定課）已計入老師的節數。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums min-w-[520px]">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-200">
                <th className="text-left font-medium py-1">項目</th>
                <th className="text-right font-medium py-1 w-20">這一版</th>
                <th className="text-right font-medium py-1 w-28">人工課表</th>
                <th className="text-left font-medium py-1 pl-3 w-28">判讀</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(c => {
                const vd = c.bad(c.v) ? { txt: '要處理', cls: 'text-red-700 bg-red-50 border-red-200' } : verdict(c.v, c.hand)
                return (
                  <tr key={c.name} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1 text-zinc-700">{c.name}</td>
                    <td className="py-1 text-right font-medium">{c.v} <span className="font-normal text-zinc-400">{c.unit}</span></td>
                    <td className="py-1 text-right text-zinc-400">{c.hand[0]}～{c.hand[1]} {c.unit}</td>
                    <td className="py-1 pl-3"><span className={`px-1.5 py-0.5 rounded-sm border text-[11px] ${vd.cls}`}>{vd.txt}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 熱力圖 */}
      <div className="card p-3">
        <div className="flex items-center gap-2 mb-2">
          {TAB.map(x => (
            <button key={x.k} onClick={() => setTab(x.k)}
              className={`text-xs px-2 py-0.5 rounded-sm border ${tab === x.k ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
              {x.t}<span className="opacity-60 ml-1">{x.n}</span>
            </button>
          ))}
          {onOpenChain && <span className="text-[11px] text-zinc-400 ml-auto">點格子可直接開「連鎖調課」</span>}
        </div>

        {tab === 'homeroom' && (
          <>
            <p className="text-[11px] text-zinc-400 mb-1.5">
              每格＝那個班那一天導師自己上幾節。
              <span className="text-red-600 mx-1">紅＝0 節或超過絕對上限</span>
              <span className="text-amber-600 mx-1">橙＝上午不足 2 節</span>
              <span className="text-violet-600 mx-1">紫底＝連上 4 節以上</span>
            </p>
            <div className="overflow-x-auto">
              <table className="text-[11px] tabular-nums border-collapse">
                <thead><tr>
                  <th className="sticky left-0 bg-white text-left font-medium text-zinc-500 px-1 py-0.5">班級</th>
                  {SCHEDULE_DAYS.map(d => <th key={d} className="font-medium text-zinc-500 px-1 py-0.5 w-9">{DAY_LABEL[d].slice(1)}</th>)}
                </tr></thead>
                <tbody>
                  {homeroom.rows.map(r => (
                    <tr key={r.ck}>
                      <td className="sticky left-0 bg-white whitespace-nowrap px-1 py-0.5 text-zinc-600">
                        {r.label}<span className="text-zinc-300 ml-1">{r.teacher}</span>
                      </td>
                      {r.days.map(d => {
                        const over = d.n > d.cap, none = d.n === 0
                        const tone = none || over ? 'bg-red-100 text-red-800 border-red-300'
                          : d.am < 2 ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-white text-zinc-500 border-zinc-200'
                        const runMark = d.run >= 4 ? ' ring-1 ring-violet-400 ring-inset' : ''
                        const why = [`導師 ${d.n} 節（上限 ${d.cap}）`, `上午 ${d.am} 節`, d.run >= 4 ? `連上 ${d.run} 節` : '']
                          .filter(Boolean).join('｜')
                        return (
                          <td key={d.d} className="p-0.5">
                            <button disabled={!onOpenChain} title={`${r.label} 週${DAY_ZH[d.d]}：${why}`}
                              onClick={() => onOpenChain?.({ kind: 'class', classKey: r.ck })}
                              className={`w-8 h-6 rounded-sm border ${tone}${runMark} ${onOpenChain ? 'hover:ring-2 hover:ring-zinc-400' : ''}`}>
                              {d.n}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'teacher' && (
          <>
            <p className="text-[11px] text-zinc-400 mb-1.5">
              每格＝那位老師那一天上幾節，依零碎空堂多的排前面。
              <span className="text-red-600 mx-1">紅＝有空堂夾在課中間</span>
              <span className="text-amber-600 mx-1">橙＝孤堂日或半天只上 1 節</span>
            </p>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="text-[11px] tabular-nums border-collapse">
                <thead><tr>
                  <th className="sticky left-0 bg-white text-left font-medium text-zinc-500 px-1 py-0.5">老師</th>
                  {SCHEDULE_DAYS.map(d => <th key={d} className="font-medium text-zinc-500 px-1 py-0.5 w-9">{DAY_LABEL[d].slice(1)}</th>)}
                  <th className="font-medium text-zinc-500 px-1 py-0.5 w-10">合計</th>
                </tr></thead>
                <tbody>
                  {teachers.rows.map(r => (
                    <tr key={r.tid}>
                      <td className="sticky left-0 bg-white whitespace-nowrap px-1 py-0.5 text-zinc-600">{r.name}</td>
                      {r.days.map(d => {
                        const tone = d.gap ? 'bg-red-100 text-red-800 border-red-300'
                          : (d.lonely || d.half1) ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : d.n ? 'bg-white text-zinc-500 border-zinc-200'
                          : 'bg-zinc-50 text-zinc-300 border-zinc-100'
                        const why = d.n === 0 ? '這天沒課'
                          : [`${d.n} 節`, d.gap ? `${d.gap} 節空堂夾在課中間` : '', d.lonely ? '整天只有 1 節' : '', d.half1 ? '有半天只上 1 節' : '']
                            .filter(Boolean).join('｜')
                        return (
                          <td key={d.d} className="p-0.5">
                            <button disabled={!onOpenChain} title={`${r.name} 週${DAY_ZH[d.d]}：${why}`}
                              onClick={() => onOpenChain?.({ kind: 'teacher', teacherId: r.tid })}
                              className={`w-8 h-6 rounded-sm border ${tone} ${onOpenChain ? 'hover:ring-2 hover:ring-zinc-400' : ''}`}>
                              {d.n || ''}
                            </button>
                          </td>
                        )
                      })}
                      <td className="px-1 text-zinc-400 text-right">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'hourly' && (
          hourly.length === 0
            ? <p className="text-xs text-zinc-400">沒有鐘點老師。</p>
            : (<>
              <p className="text-[11px] text-zinc-400 mb-1.5">鐘點老師在乎的是「要跑幾趟」，不是上幾節。到校天數越少越好。</p>
              <div className="overflow-x-auto">
                <table className="text-[11px] tabular-nums border-collapse">
                  <thead><tr>
                    <th className="text-left font-medium text-zinc-500 px-1 py-0.5">老師</th>
                    {SCHEDULE_DAYS.map(d => <th key={d} className="font-medium text-zinc-500 px-1 py-0.5 w-9">{DAY_LABEL[d].slice(1)}</th>)}
                    <th className="font-medium text-zinc-500 px-1 py-0.5 w-14">到校天數</th>
                    <th className="font-medium text-zinc-500 px-1 py-0.5 w-10">節數</th>
                  </tr></thead>
                  <tbody>
                    {hourly.map(r => (
                      <tr key={r.tid}>
                        <td className="whitespace-nowrap px-1 py-0.5 text-zinc-600">{r.name}</td>
                        {r.days.map(d => (
                          <td key={d.d} className="p-0.5">
                            <button disabled={!onOpenChain} title={`${r.name} 週${DAY_ZH[d.d]}：${d.n ? `${d.n} 節` : '不用到校'}`}
                              onClick={() => onOpenChain?.({ kind: 'teacher', teacherId: r.tid })}
                              className={`w-8 h-6 rounded-sm border ${d.n ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-zinc-50 text-zinc-300 border-zinc-100'} ${onOpenChain ? 'hover:ring-2 hover:ring-zinc-400' : ''}`}>
                              {d.n || '—'}
                            </button>
                          </td>
                        ))}
                        <td className={`px-1 text-right font-medium ${r.comeDays >= 4 ? 'text-red-600' : r.comeDays === 3 ? 'text-amber-600' : 'text-green-700'}`}>{r.comeDays}</td>
                        <td className="px-1 text-right text-zinc-400">{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>)
        )}
      </div>
    </div>
  )
}
