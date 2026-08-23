'use client'

import { Fragment, useMemo, useState } from 'react'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, classLabel, homeroomLockSlots, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES } from '@/lib/allocation'
import type { PlacedResult } from '@/lib/schedule-engine'
import type { HomeroomRow } from './OverviewAdjust'
import type { ChainSeed } from './ChainAdjustModal'

/* ────────────────────────────────────────────────────────────────────────────
   課表體檢：把「罰分明細」翻譯成課務組看得懂的東西。

   罰分是給引擎比較用的，「同型態同日 ×23＝207 分」對人沒有意義。這裡改成
   熱力圖（導師／科任／鐘點）＋對照人工課表的體檢表；左邊挑一列，右邊直接看整週課表，
   看完不順眼就按「調課」接到連鎖調課——判斷要看整週，不是看單一天。

   全部從落點與設定即時算出來，不需要跑引擎，所以切版本立刻重畫。
   ──────────────────────────────────────────────────────────────────────────── */

/** 本校 112-1、113-1、114-1、114-2 四期人工課表的實際數字（scripts/hand-*.json 統計）。
 *  熱力圖上的紅格子到底算不算嚴重，要有尺規才知道——例如「導師連上 5 節」人工每期都有 1～2 個。 */
const HAND = {
  hrNoDay: [0, 5], hr5: [7, 15], hr6: [0, 1], hrAm: [35, 88], run4: [10, 23], run5: [0, 2],
  lonely: [11, 18], gapSlots: [85, 133], gapDays: [55, 82], half1: [44, 58],
  crossDay: [6, 10], sub3: [0, 4], spread3: [20, 31],
} as const
/** 小下課只有十分鐘，跨年段等於跨棟。人工課表四期只有 3% 的老師日發生（每期 6～10 個），確實罕見。 */
const SHORT_BREAK_PAIRS: [number, number][] = [[1, 2], [3, 4], [5, 6]]
const HAND_TERMS = '112-1、113-1、114-1、114-2 四期'

/* 色階門檻的依據——人工課表四期的實際比例（不是我自訂的）：
 *   科任空堂：28% 的老師日有空堂（空 1 節 15%、空 2 節 10%、空 3 節以上只有 3%，最大 4 節）
 *   導師上午：上午 0 節 2%、上午 1 節 16%
 *   孤堂日 6%、半天只上 1 節 21%
 * 所以「有空堂就標紅」會染紅四分之一的格子，等於沒有訊息；紅色留給人工也罕見的情況。 */


type Extra = { slot: string; main: string; sub: string }

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
  extraByTeacher: Map<string, Extra[]>
  onOpenChain?: (seed: ChainSeed) => void
}

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const MORNING_LAST = 4
type Sel = { kind: 'class'; ck: string } | { kind: 'teacher'; tid: string }

export default function ScheduleHealth({
  placed, hr, config, classCounts, teacherNames, hourlyTeacherIds, homeroomHours, extraByTeacher, onOpenChain,
}: Props) {
  const [tab, setTab] = useState<'homeroom' | 'teacher' | 'hourly'>('homeroom')
  const [sel, setSel] = useState<Sel | null>(null)
  const nameOf = (id: string) => teacherNames[id] ?? '？'
  const spanOf = (p: PlacedResult) => p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]

  const cellsByClass = useMemo(() => {
    const m = new Map<string, Map<string, PlacedResult>>()
    for (const p of placed) {
      const cm = m.get(p.classKey) ?? new Map<string, PlacedResult>()
      for (const s of spanOf(p)) cm.set(s, p)
      m.set(p.classKey, cm)
    }
    return m
  }, [placed])

  /* ── 導師端：每個「班日」算導師節數、上午節數、最長連上 ── */
  const homeroom = useMemo(() => {
    const hm = config.weights.builtin.homeroomDailyMax
    const rows: { ck: string; label: string; teacher: string; days: { d: number; n: number; am: number; run: number; cap: number }[] }[] = []
    const tally = { hrNoDay: 0, hr5: 0, hr6: 0, hrAm: 0, run4: 0, run5: 0 }
    for (const g of GRADES) for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const ck = `${g}-${i}`
      const grid = config.bands[bandOf(g)]
      const locks = config.lockCells[ck] ?? {}
      // 種子班的國語、數學鎖課本來就是導師自己上的，要算進導師節數；本土語那種才是別人的課
      const hrLocks = new Set(homeroomLockSlots(config, g, i, homeroomHours[ck]))
      const cm = cellsByClass.get(ck) ?? new Map<string, PlacedResult>()
      const days = SCHEDULE_DAYS.map(d => {
        const slots: number[] = []
        for (let p = 1; p <= grid.periodsPerDay; p++) if (grid.teachable[`${d}-${p}`]) slots.push(p)
        const mine = slots.filter(p => {
          const k = `${d}-${p}`
          if (cm.has(k)) return false                     // 科任課
          if (locks[k] && !hrLocks.has(k)) return false   // 別人的鎖課（本土語…）
          return true                                      // 空白或導師自己的鎖課
        })
        const cap = bandOf(g) === 'low' && slots.some(p => p > MORNING_LAST) ? Math.max(hm.hardN, hm.hardFullDayLowN) : hm.hardN
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
        return { d, n: mine.length, am: mine.filter(p => p <= MORNING_LAST).length, run: best, cap }
      })
      rows.push({ ck, label: classLabel(g, i), teacher: nameOf(config.classTeacher[ck] ?? ''), days })
    }
    return { rows, tally }
  }, [cellsByClass, config, classCounts, teacherNames, homeroomHours])

  /* ── 科任端：每位老師每天的節數、零碎空堂、孤堂日、半天只上 1 節 ── */
  const teachers = useMemo(() => {
    const byT = new Map<string, Map<number, number[]>>()
    const put = (tid: string, day: number, qs: number[]) => {
      const dm = byT.get(tid) ?? new Map<number, number[]>()
      dm.set(day, [...(dm.get(day) ?? []), ...qs])
      byT.set(tid, dm)
    }
    // 老師 → 日 → 節 → 年段（判斷小下課跨年段用；本土語沒有年級資料，只計節數不計跨年段）
    const bandAt = new Map<string, string>()
    for (const p of placed) {
      const b = bandOf(Number(p.classKey.split('-')[0]))
      for (const q of (p.size === 2 ? [p.period, p.period + 1] : [p.period])) bandAt.set(`${p.teacherId}|${p.day}-${q}`, b)
    }
    for (const p of placed) put(p.teacherId, p.day, p.size === 2 ? [p.period, p.period + 1] : [p.period])
    // 本土語不進引擎，但老師照樣要到校上那一節。不算進來的話：空堂會多算（其實被本土語填住了）、
    // 孤堂日會多算、鐘點的到校天數會少算——而人工課表的基準線是有把本土語算進去的，不補就不是同一個標準。
    extraByTeacher.forEach((cells, tid) => {
      for (const c of cells) { const [d, q] = c.slot.split('-').map(Number); put(tid, d, [q]) }
    })
    // 老師 → 日 → 科目集合（一天教幾科：人工四期只有 0～4 個老師日達到 3 科，很能分辨科任的忙亂程度）
    const subjAt = new Map<string, Set<string>>()
    const addSubj = (tid: string, d: number | string, name: string) => {
      const k = `${tid}|${d}`
      const set = subjAt.get(k) ?? new Set<string>()
      set.add(name); subjAt.set(k, set)
    }
    for (const p of placed) addSubj(p.teacherId, p.day, p.subject)
    extraByTeacher.forEach((cells, tid) => { for (const c of cells) addSubj(tid, c.slot.split('-')[0], c.main) })
    const rows: { tid: string; name: string; total: number; comeDays: number; days: { d: number; n: number; gap: number; lonely: boolean; half1: boolean; cross: number; subj: number }[] }[] = []
    const tally = { lonely: 0, gapSlots: 0, gapDays: 0, half1: 0, crossDay: 0, sub3: 0, spread3: 0 }
    byT.forEach((dm, tid) => {
      let total = 0
      const days = SCHEDULE_DAYS.map(d => {
        const qs = Array.from(new Set(dm.get(d) ?? [])).sort((a, b) => a - b)
        total += qs.length
        const gap = qs.length > 1 ? qs.slice(1).reduce((s, q, i) => s + (q - qs[i] - 1), 0) : 0
        const am = qs.filter(q => q <= MORNING_LAST).length, pm = qs.length - am
        // 小下課跨年段：1-2、3-4、5-6 這三對之中，前後兩節分屬不同年段的次數
        let cross = 0
        for (const [x, y] of SHORT_BREAK_PAIRS) {
          const bx = bandAt.get(`${tid}|${d}-${x}`), by = bandAt.get(`${tid}|${d}-${y}`)
          if (bx && by && bx !== by) cross++
        }
        if (qs.length) {
          if (qs.length === 1) tally.lonely++
          if (gap) { tally.gapSlots += gap; tally.gapDays++ }
          if (cross) tally.crossDay++
          tally.half1 += (am === 1 ? 1 : 0) + (pm === 1 ? 1 : 0)
        }
        const subj = subjAt.get(`${tid}|${d}`)?.size ?? 0
        if (qs.length && subj >= 3) tally.sub3++
        return { d, n: qs.length, gap, lonely: qs.length === 1, half1: (am === 1 || pm === 1), cross, subj }
      })
      const active = days.filter(x => x.n > 0)
      if (active.length && Math.max(...active.map(x => x.n)) - Math.min(...active.map(x => x.n)) >= 3) tally.spread3++
      rows.push({ tid, name: nameOf(tid), total, comeDays: active.length, days })
    })
    // 要處理的排前面：先看跨年段，再看孤堂日
    const score = (r: typeof rows[number]) => r.days.reduce((s, x) => s + x.cross * 10 + (x.lonely ? 5 : 0), 0)
    rows.sort((a, b) => score(b) - score(a) || b.total - a.total)
    return { rows, tally }
  }, [placed, teacherNames, extraByTeacher])

  /* ── 鐘點：到校天數（他們在乎的是要跑幾趟，不是幾節） ── */
  const hourly = useMemo(() => {
    const set = new Set(hourlyTeacherIds)
    return teachers.rows.filter(r => set.has(r.tid)).sort((a, b) => b.comeDays - a.comeDays)
  }, [teachers, hourlyTeacherIds])

  /* ── 體檢表 ── */
  // 鐘點老師的目標到校天數（權重設定裡的「鐘點集中」）：人工課表分不出誰是鐘點，只能拿學校自己的目標當基準
  const hourlyTarget = config.weights.builtin.hourlyBalance?.days ?? 3
  const hourlyOver = hourly.filter(r => r.comeDays > hourlyTarget).length
  const hourlyDays = hourly.reduce((a, r) => a + r.comeDays, 0)

  const CD = '班日', TD = '老師日', TN = '人'
  const checks: { g: '導師' | '科任' | '鐘點'; name: string; unit: string; v: number; hand: readonly number[] | null; note?: string }[] = [
    { g: '導師', name: '整天沒課', unit: CD, v: homeroom.tally.hrNoDay, hand: HAND.hrNoDay },
    { g: '導師', name: '一天 5 節以上', unit: CD, v: homeroom.tally.hr5, hand: HAND.hr5 },
    { g: '導師', name: '一天 6 節以上', unit: CD, v: homeroom.tally.hr6, hand: HAND.hr6 },
    { g: '導師', name: '上午不足 2 節', unit: CD, v: homeroom.tally.hrAm, hand: HAND.hrAm },
    { g: '導師', name: '連上 4 節以上', unit: CD, v: homeroom.tally.run4, hand: HAND.run4 },
    { g: '導師', name: '連上 5 節以上', unit: CD, v: homeroom.tally.run5, hand: HAND.run5 },
    { g: '科任', name: '孤堂日（一天只 1 節）', unit: TD, v: teachers.tally.lonely, hand: HAND.lonely },
    { g: '科任', name: '小下課跨年段', unit: TD, v: teachers.tally.crossDay, hand: HAND.crossDay },
    { g: '科任', name: '一天要教 3 科以上', unit: TD, v: teachers.tally.sub3, hand: HAND.sub3 },
    { g: '科任', name: '每天節數落差 3 節以上', unit: TN, v: teachers.tally.spread3, hand: HAND.spread3 },
    { g: '科任', name: '零碎空堂', unit: '節', v: teachers.tally.gapSlots, hand: HAND.gapSlots },
    { g: '科任', name: '有零碎空堂的日數', unit: TD, v: teachers.tally.gapDays, hand: HAND.gapDays },
    { g: '科任', name: '半天只上 1 節', unit: '半天', v: teachers.tally.half1, hand: HAND.half1 },
    // 科任是專任、本來就天天到校，「到校幾天」只對鐘點有意義（他們在乎跑幾趟）
    { g: '鐘點', name: `到校超過目標（${hourlyTarget} 天）`, unit: TN, v: hourlyOver, hand: null, note: '目標取自權重設定的「鐘點集中」' },
    { g: '鐘點', name: '到校天數合計', unit: '天', v: hourlyDays, hand: null, note: '人工課表分不出誰是鐘點，沒有基準可比' },
  ]
  const verdict = (v: number, hand: readonly number[] | null, name = '') => {
    if (!hand) {
      if (!name.startsWith('到校超過目標')) return { txt: '—', cls: 'text-zinc-400 bg-white border-zinc-200' }
      return v === 0
        ? { txt: '都在目標內', cls: 'text-green-700 bg-green-50 border-green-200' }
        : { txt: `${v} 人超過`, cls: 'text-red-700 bg-red-50 border-red-200' }
    }
    const [lo, hi] = hand
    return v < lo ? { txt: '優於人工', cls: 'text-green-700 bg-green-50 border-green-200' }
      : v <= hi ? { txt: '在人工範圍內', cls: 'text-zinc-600 bg-zinc-50 border-zinc-200' }
      : { txt: '比人工差', cls: 'text-red-700 bg-red-50 border-red-200' }
  }

  /* ── 右側：選中那一位／那一班的整週課表 ── */
  const board = useMemo(() => {
    if (!sel) return null
    const maxP = Math.max(...Object.values(config.bands).map(b => b.periodsPerDay))
    if (sel.kind === 'class') {
      const g = Number(sel.ck.split('-')[0]), i = Number(sel.ck.split('-')[1])
      const grid = config.bands[bandOf(g)]
      const locks = config.lockCells[sel.ck] ?? {}
      const lockType = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
      const hrLocks = new Set(homeroomLockSlots(config, g, i, homeroomHours[sel.ck]))
      const cm = cellsByClass.get(sel.ck) ?? new Map<string, PlacedResult>()
      const hrCells = hr[sel.ck]?.cells ?? {}
      return {
        title: `${classLabel(g, i)} 班級課表`, sub: `導師 ${nameOf(config.classTeacher[sel.ck] ?? '')}`,
        periods: grid.periodsPerDay,
        cell: (d: number, p: number) => {
          const k = `${d}-${p}`
          if (!grid.teachable[k]) return { kind: 'off' as const }
          const l = cm.get(k)
          if (l) return { kind: 'lesson' as const, main: l.subject, sub: l.teacherName }
          const lk = locks[k]
          if (lk) return { kind: hrLocks.has(k) ? 'hr' as const : 'lock' as const, main: lockType[lk]?.subject || lockType[lk]?.label || '鎖課', sub: hrLocks.has(k) ? '導師' : '' }
          if (hrCells[k]) return { kind: 'hr' as const, main: hrCells[k], sub: '導師' }
          return { kind: 'blank' as const }
        },
        seed: { kind: 'class' as const, classKey: sel.ck },
      }
    }
    const mine = new Map<string, PlacedResult>()
    for (const p of placed) if (p.teacherId === sel.tid) for (const s of spanOf(p)) mine.set(s, p)
    const ex = new Map((extraByTeacher.get(sel.tid) ?? []).map(c => [c.slot, c]))
    return {
      title: `${nameOf(sel.tid)} 教師課表`, sub: `${mine.size + ex.size} 節`,
      periods: maxP,
      cell: (d: number, p: number) => {
        const k = `${d}-${p}`
        const l = mine.get(k)
        if (l) return { kind: 'lesson' as const, main: l.subject, sub: l.classLabel }
        const e = ex.get(k)
        if (e) return { kind: 'lock' as const, main: e.main, sub: e.sub }
        return { kind: 'blank' as const }
      },
      seed: { kind: 'teacher' as const, teacherId: sel.tid },
    }
  }, [sel, placed, hr, config, homeroomHours, cellsByClass, extraByTeacher, teacherNames])

  const TAB = [
    { k: 'homeroom' as const, t: '導師', n: homeroom.rows.length },
    { k: 'teacher' as const, t: '科任老師', n: teachers.rows.length },
    { k: 'hourly' as const, t: '鐘點老師', n: hourly.length },
  ]
  const selKey = sel ? (sel.kind === 'class' ? `c:${sel.ck}` : `t:${sel.tid}`) : ''
  const rowBtn = (on: boolean) =>
    `w-full text-left whitespace-nowrap px-1.5 py-0.5 rounded-sm border ${on
      ? 'bg-zinc-700 text-white border-zinc-700'
      : 'bg-white text-zinc-600 border-transparent hover:border-zinc-300'}`

  return (
    <div className="space-y-3">
      {/* 體檢表 */}
      <div className="card p-3">
        <div className="text-sm font-semibold text-zinc-700 mb-1">課表體檢</div>
        <p className="text-[11px] text-zinc-400 mb-2">
          和本校 {HAND_TERMS}人工排的課表比。「在人工範圍內」代表這一版跟老師們過去幾年實際上到的課表差不多。
          <br />班日＝一個班的一天；老師日＝一位科任的一天。本土語（不進引擎的固定課）已計入老師的節數。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums min-w-[520px]">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-200">
                <th className="text-left font-medium py-1">項目</th>
                <th className="text-right font-medium py-1 w-24">這一版</th>
                <th className="text-right font-medium py-1 w-32">人工課表</th>
                <th className="text-left font-medium py-1 pl-3 w-28">判讀</th>
              </tr>
            </thead>
            <tbody>
              {(['導師', '科任', '鐘點'] as const).map(g => {
                const list = checks.filter(c => c.g === g)
                if (!list.length) return null
                const graded = list.filter(c => c.hand)
                const win = graded.filter(c => verdict(c.v, c.hand).txt === '優於人工').length
                const lose = graded.filter(c => verdict(c.v, c.hand).txt === '比人工差').length
                return (
                  <Fragment key={g}>
                    <tr className="bg-zinc-50">
                      <td colSpan={4} className="py-1 px-1 font-medium text-zinc-600">
                        {g}端
                        {graded.length > 0 && (
                          <span className="ml-2 font-normal text-[11px]">
                            <span className="text-green-700">優於人工 {win}</span>
                            <span className="text-zinc-300 mx-1">·</span>
                            <span className="text-zinc-500">在範圍內 {graded.length - win - lose}</span>
                            <span className="text-zinc-300 mx-1">·</span>
                            <span className={lose ? 'text-red-700 font-medium' : 'text-zinc-400'}>比人工差 {lose}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                    {list.map(c => {
                      const vd = verdict(c.v, c.hand, c.name)
                      return (
                        <tr key={c.name} className="border-b border-zinc-100">
                          <td className="py-1 pl-3 text-zinc-700">{c.name}
                            {c.note && <span className="text-[10px] text-zinc-400 ml-1">{c.note}</span>}</td>
                          <td className="py-1 text-right font-medium">{c.v} <span className="font-normal text-zinc-400">{c.unit}</span></td>
                          <td className="py-1 text-right text-zinc-400">{c.hand ? `${c.hand[0]}～${c.hand[1]} ${c.unit}` : '—'}</td>
                          <td className="py-1 pl-3"><span className={`px-1.5 py-0.5 rounded-sm border text-[11px] ${vd.cls}`}>{vd.txt}</span></td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 熱力圖 ＋ 課表 */}
      <div className="card p-3">
        <div className="flex items-center gap-2 mb-2">
          {TAB.map(x => (
            <button key={x.k} onClick={() => { setTab(x.k); setSel(null) }}
              className={`text-xs px-2 py-0.5 rounded-sm border ${tab === x.k ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
              {x.t}<span className="opacity-60 ml-1">{x.n}</span>
            </button>
          ))}
          <span className="text-[11px] text-zinc-400 ml-auto">點左邊的名字看整週課表</span>
        </div>

        <div className="flex gap-4 items-start">
          {/* 左：熱力圖（固定寬，三個分頁版面一致，不會擠到右邊的課表） */}
          <div className="flex-none w-[430px]">
            {tab === 'homeroom' && (
              <p className="text-[11px] text-zinc-400 mb-1.5">
                每格＝那天導師自己上幾節。
                <span className="px-1 rounded-sm bg-red-100 text-red-800 ml-1">紅＝0 節或超過上限</span>
                <span className="px-1 rounded-sm bg-amber-100 text-amber-900 ml-1">深橙＝上午 0 節</span>
                <span className="px-1 rounded-sm bg-violet-100 text-violet-800 ml-1">紫＝連上 4 節以上</span>
                <span className="px-1 rounded-sm bg-amber-50 text-amber-700 ml-1">淡橙＝上午 1 節</span>
                <br />門檻取自人工課表：上午 0 節僅占 2%、上午 1 節占 16%。
              </p>
            )}
            {tab === 'teacher' && (
              <p className="text-[11px] text-zinc-400 mb-1.5">
                每格＝那天上幾節，要處理的排前面。
                <span className="px-1 rounded-sm bg-red-100 text-red-800 ml-1">紅＝整天只 1 節</span>
                <span className="px-1 rounded-sm bg-amber-100 text-amber-900 ml-1">橙＝小下課（1-2／3-4／5-6）跨年段</span>
                <br />人工課表四期：孤堂日占 6%、跨年段占 3%，兩個都罕見所以值得抓。
                零碎空堂不上色——人工有 28% 的老師日本來就有空堂，標了等於沒標。
              </p>
            )}
            {tab === 'hourly' && <p className="text-[11px] text-zinc-400 mb-1.5">鐘點老師在乎的是要跑幾趟，到校天數越少越好。</p>}

            <div className="overflow-y-auto max-h-[560px] pr-1">
              <table className="text-[11px] tabular-nums border-collapse">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th className="text-left font-medium text-zinc-500 px-1 py-0.5">{tab === 'homeroom' ? '班級' : '老師'}</th>
                    {SCHEDULE_DAYS.map(d => <th key={d} className="font-medium text-zinc-500 px-1 py-0.5 w-8">{DAY_LABEL[d].slice(1)}</th>)}
                    {tab === 'hourly' && <th className="font-medium text-zinc-500 px-1 py-0.5 w-12">到校</th>}
                  </tr>
                </thead>
                <tbody>
                  {tab === 'homeroom' && homeroom.rows.map(r => (
                    <tr key={r.ck}>
                      <td className="px-0.5 py-0.5">
                        <button onClick={() => setSel({ kind: 'class', ck: r.ck })} className={rowBtn(selKey === `c:${r.ck}`)}>
                          {r.label}<span className={selKey === `c:${r.ck}` ? 'text-zinc-300 ml-1' : 'text-zinc-300 ml-1'}>{r.teacher}</span>
                        </button>
                      </td>
                      {r.days.map(d => {
                        // 一格只能有一個底色，順序取「人工課表裡越罕見的越優先」
                        const tone = d.n === 0 || d.n > d.cap ? 'bg-red-100 text-red-800 border-red-300'
                          : d.am === 0 ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : d.run >= 4 ? 'bg-violet-100 text-violet-800 border-violet-300'
                          : d.am === 1 ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-white text-zinc-500 border-zinc-200'
                        return (
                          <td key={d.d} className="p-0.5">
                            <div title={`${r.label} 週${DAY_ZH[d.d]}：導師 ${d.n} 節（上限 ${d.cap}）｜上午 ${d.am} 節${d.run >= 4 ? `｜連上 ${d.run} 節` : ''}`}
                              className={`w-7 h-5 leading-5 text-center rounded-sm border ${tone}`}>{d.n}</div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {tab === 'teacher' && teachers.rows.map(r => (
                    <tr key={r.tid}>
                      <td className="px-0.5 py-0.5">
                        <button onClick={() => setSel({ kind: 'teacher', tid: r.tid })} className={rowBtn(selKey === `t:${r.tid}`)}>
                          {r.name}<span className="text-zinc-300 ml-1">{r.total} 節・到校 {r.comeDays} 天</span>
                        </button>
                      </td>
                      {r.days.map(d => {
                        const tone = d.lonely ? 'bg-red-100 text-red-800 border-red-300'
                          : d.cross ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : d.n ? 'bg-white text-zinc-500 border-zinc-200'
                          : 'bg-zinc-50 text-zinc-300 border-zinc-100'
                        const why = d.n === 0 ? '這天沒課'
                          : [`${d.n} 節`, `${d.subj} 科`, d.lonely ? '整天只有 1 節' : '', d.cross ? `小下課跨年段 ${d.cross} 次` : '',
                             d.gap ? `${d.gap} 節空堂夾在課中間` : ''].filter(Boolean).join('｜')
                        return (
                          <td key={d.d} className="p-0.5">
                            <div title={`${r.name} 週${DAY_ZH[d.d]}：${why}`}
                              className={`w-7 h-5 leading-5 text-center rounded-sm border ${tone}`}>{d.n || ''}</div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {tab === 'hourly' && (hourly.length === 0
                    ? <tr><td colSpan={7} className="text-zinc-400 px-1 py-2">沒有鐘點老師。</td></tr>
                    : hourly.map(r => (
                      <tr key={r.tid}>
                        <td className="px-0.5 py-0.5">
                          <button onClick={() => setSel({ kind: 'teacher', tid: r.tid })} className={rowBtn(selKey === `t:${r.tid}`)}>
                            {r.name}<span className="text-zinc-300 ml-1">{r.total} 節</span>
                          </button>
                        </td>
                        {r.days.map(d => (
                          <td key={d.d} className="p-0.5">
                            <div title={`${r.name} 週${DAY_ZH[d.d]}：${d.n ? `${d.n} 節` : '不用到校'}`}
                              className={`w-7 h-5 leading-5 text-center rounded-sm border ${d.n ? 'bg-sky-50 text-sky-800 border-sky-200' : 'bg-zinc-50 text-zinc-300 border-zinc-100'}`}>{d.n || '—'}</div>
                          </td>
                        ))}
                        <td className={`px-1 text-center font-medium ${r.comeDays >= 4 ? 'text-red-600' : r.comeDays === 3 ? 'text-amber-600' : 'text-green-700'}`}>{r.comeDays}</td>
                      </tr>
                    )))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 右：整週課表 */}
          <div className="flex-1 min-w-[430px]">
            {!board ? (
              <div className="h-full min-h-[320px] flex items-center justify-center text-xs text-zinc-400 border border-dashed border-zinc-200 rounded-sm">
                點左邊的班級或老師，這裡會顯示整週課表
              </div>
            ) : (
              <div className="border border-zinc-200 rounded-sm bg-white">
                <div className="px-2 py-1.5 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-700">{board.title}</span>
                  <span className="text-[11px] text-zinc-400">{board.sub}</span>
                  {onOpenChain && (
                    <button onClick={() => onOpenChain(board.seed)}
                      className="btn btn-secondary text-xs py-0.5 ml-auto"
                      title="從這張課表開始連鎖調課；套用後會自動存成一份版本">⇄ 這張課表調課</button>
                  )}
                </div>
                <div className="p-2 overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse min-w-[420px]">
                    <thead>
                      <tr>
                        <th className="w-6" />
                        {SCHEDULE_DAYS.map(d => <th key={d} className="font-medium text-zinc-500 py-0.5">{DAY_LABEL[d]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: board.periods }, (_, i) => i + 1).map(p => (
                        <tr key={p}>
                          <td className="text-zinc-400 text-center">{p}</td>
                          {SCHEDULE_DAYS.map(d => {
                            const c = board.cell(d, p)
                            const tone = c.kind === 'off' ? 'bg-zinc-50 border-zinc-100'
                              : c.kind === 'lesson' ? 'bg-sky-50 border-sky-200 text-sky-900'
                              : c.kind === 'hr' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : c.kind === 'lock' ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : 'bg-white border-dashed border-zinc-200 text-zinc-300'
                            return (
                              <td key={d} className="p-0.5">
                                <div className={`h-10 rounded-sm border px-0.5 flex flex-col items-center justify-center leading-tight overflow-hidden ${tone}`}>
                                  {'main' in c && <span className="font-medium truncate w-full text-center">{c.main}</span>}
                                  {'sub' in c && c.sub && <span className="opacity-70 truncate w-full text-center">{c.sub}</span>}
                                  {c.kind === 'blank' && <span className="text-[10px]">導師自排</span>}
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
        </div>
      </div>
    </div>
  )
}
