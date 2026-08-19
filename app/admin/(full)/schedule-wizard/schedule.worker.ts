// 排課引擎 Web Worker：硬限制＋權重一次跑（多種子多起點），成功條件＝未排 0 且必須級 0。
//   罰分字典序：未排（1e5/堂）→ 必須級（1e6/筆）→ 軟權重——引擎天生先求排入、再求好看，不需分兩階段。
//   每個種子跑到收斂（只差 1～2 節時多給耐心）；已有完整解後其餘種子縮短預算、只為多起點比軟分。
//   全部種子跑完仍有未排 → 診斷：以純硬模式從最佳解熱啟動探測——
//     探測排得完 → 是權重把搜尋牽住了：比對哪些規則在探測解裡多了違反 → 建議降低那些權重；
//     探測也排不完 → 非權重問題（硬限制／配課結構），列未排原因。
// 全程可中途停止並採用目前最佳解。
import { EngineRun, polishResult, type EngineInput, type EngineResult } from '../../../../lib/schedule-engine'

const CHUNK_MS = 300
const SEEDS = [42, 7, 17, 63, 3]
const BUDGET = { converge: 20000, cap: 90000 }        // 尚未有完整解：每種子收斂/上限
const BUDGET_MORE = { converge: 12000, cap: 60000 }   // 已有完整解：其餘種子只為多起點比軟分
const PROBE_MS = 20000
const RESCUE_SEEDS = [101, 202, 303]
const RESCUE_FIX = { converge: 20000, cap: 30000 }    // 從最佳解熱啟動純硬補完：實測幾秒
const RESCUE_HARD = { converge: 25000, cap: 90000 }   // 從零純硬：約半數種子 30～60s 排完
const RESCUE_SOFT = { converge: 15000, cap: 60000 }   // 從可行解出發做加權優化

let stopRequested = false

/** 純硬限制版輸入（診斷探測用）：所有權重與子規則關閉；連堂矩陣為結構設定、維持。 */
function hardOnlyInput(input: EngineInput): EngineInput {
  const b = input.weights.builtin
  return {
    ...input,
    weights: {
      builtin: {
        ...b,
        dailyMax: { ...b.dailyMax, level: 'off' },
        consecMax: { ...b.consecMax, level: 'off' },
        homeroomDailyMax: { ...b.homeroomDailyMax, level: 'off' },
        compact: 'off', classCohesion: 'off', batchType: 'off', bandAdjacent: 'off', teacherApart: 'off',
        hourlyBalance: { ...b.hourlyBalance, level: 'off' },
        walkCost: 'off', roomManagerFirst: 'off', roomHalfDay: 'off', homeroomMorning: { ...b.homeroomMorning, level: 'off' },
        avoidPeriods: 'off', timePrefer: 'off', subjectApart: 'off',
      },
      templates: input.weights.templates.map(t => ({ ...t, level: 'off' as const })),
      doubleMode: input.weights.doubleMode,
      roomUse: input.weights.roomUse,
      hardParams: { ...input.weights.hardParams, roomBlockSubjects: [] },   // 保底＝純可行性：自然／科技教室優先求解也放棄（降級的最後一層）
    },
  }
}

const mustCountOf = (r: EngineResult) => r.penalties.filter(p => p.points >= 1e6).reduce((s, p) => s + p.count, 0)
const isPerfect = (r: EngineResult) => r.unplaced.length === 0 && mustCountOf(r) === 0
/** 字典序：未排 → 必須級 → 軟分，越小越好。 */
function betterThan(a: EngineResult, b: EngineResult): boolean {
  const ka = [a.unplaced.length, mustCountOf(a), Math.round(a.softPenalty)]
  const kb = [b.unplaced.length, mustCountOf(b), Math.round(b.softPenalty)]
  for (let i = 0; i < 3; i++) { if (ka[i] !== kb[i]) return ka[i] < kb[i] }
  return false
}

async function runOne(
  input: EngineInput,
  opts: { label: string; budget: { converge: number; cap: number }; perfectExit?: boolean; initial?: { id: string; day: number; period: number }[] },
): Promise<EngineResult> {
  const run = new EngineRun(input, opts.initial)
  for (;;) {
    run.step(CHUNK_MS)
    const pg = run.progress()
    self.postMessage({ type: 'progress', label: opts.label, ...pg })
    if (stopRequested) break
    if (opts.perfectExit && pg.best === 0) break
    // 只差 1～2 節（未排／必須級合計 ≤2；軟分永遠 < 1e5）時多給一倍耐心
    const nearPerfect = pg.best < 2.1e6 && pg.best >= 1e5
    if (run.sinceImprove >= opts.budget.converge * (nearPerfect ? 2.5 : 1) || run.elapsed >= opts.budget.cap) break
    await new Promise(r => setTimeout(r, 0))
  }
  return run.finalize()
}

/** 未排診斷：純硬模式從最佳解熱啟動探測，回報該降哪些權重。 */
async function diagnose(input: EngineInput, best: EngineResult, seed: number): Promise<{ probePerfect: boolean; hints: string[] }> {
  const probe = await runOne({ ...hardOnlyInput(input), seed }, {
    label: '診斷：純硬探測', budget: { converge: PROBE_MS, cap: PROBE_MS }, perfectExit: true,
    initial: best.placed.map(p => ({ id: p.id, day: p.day, period: p.period, teacherId: p.teacherId, teacherName: p.teacherName })),
  })
  if (!isPerfect(probe)) return { probePerfect: false, hints: [] }
  // 探測解在「完整權重」下的罰分 → 與最佳解比對，哪些規則多了違反＝搜尋為了守它們而放棄排入
  const scored = new EngineRun({ ...input, seed }, probe.placed.map(p => ({ id: p.id, day: p.day, period: p.period, teacherId: p.teacherId, teacherName: p.teacherName }))).finalize()
  const before = new Map(best.penalties.map(p => [p.label, p.count]))
  const hints = scored.penalties
    .filter(p => p.points > 0 && p.points < 1e6)
    .map(p => ({ label: p.label, delta: p.count - (before.get(p.label) ?? 0) }))
    .filter(x => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)
    .map(x => `「${x.label}」（放寬後多 ${x.delta} 筆違反即可全部排入）`)
  return { probePerfect: true, hints }
}

self.onmessage = async (e: MessageEvent<{ type?: string; input?: EngineInput }>) => {
  if (e.data.type === 'stop') { stopRequested = true; return }
  if (!e.data.input) return
  stopRequested = false
  const input = e.data.input

  let best: EngineResult | null = null
  let bestSeed = SEEDS[0]
  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i]
    const havePerfect = best !== null && isPerfect(best)
    const r = await runOne({ ...input, seed }, {
      label: `種子 ${i + 1}/${SEEDS.length}${havePerfect ? '・比較中' : ''}`,
      budget: havePerfect ? BUDGET_MORE : BUDGET,
    })
    if (!best || betterThan(r, best)) { best = r; bestSeed = seed }
    if (stopRequested) break
  }
  if (!best) return

  // ── 保底：加權搜尋沒排完 ──
  // 加權最佳解通常只差一兩堂：先從它熱啟動「純硬」補完（實測幾秒），再從補完的解熱啟動加權優化
  // （優化不會弄掉課：未排／必須級一動就是天價罰分，一律拒絕）。都不行才從零純硬多試幾個種子。
  if (!isPerfect(best) && !stopRequested) {
    const polish = async (feasible: EngineResult, seed: number, label: string) => {
      const polished = await runOne({ ...input, seed }, {
        label, budget: RESCUE_SOFT,
        initial: feasible.placed.map(p => ({ id: p.id, day: p.day, period: p.period, teacherId: p.teacherId, teacherName: p.teacherName })),
      })
      const cand = isPerfect(polished) ? polished : feasible
      if (!cand.notes?.length && best?.notes?.length) cand.notes = best.notes   // 熱啟動不會重跑教室優先求解，說明沿用原種子的
      if (betterThan(cand, best!)) { best = cand; bestSeed = seed }
    }
    // ⓪ 先退一層：不做「自然／科技教室優先求解」、權重全開再試兩個種子（教室結構交給權重，這是最接近原本的降級）
    const noBlock: EngineInput = { ...input, weights: { ...input.weights, hardParams: { ...input.weights.hardParams, roomBlockSubjects: [] } } }
    for (const seed of RESCUE_SEEDS.slice(0, 2)) {
      if (isPerfect(best!) || stopRequested) break
      const r = await runOne({ ...noBlock, seed }, { label: '保底：不做教室優先求解（權重全開）', budget: BUDGET })
      if (r.notes) r.notes = [...(best.notes ?? []), '整份排不完 → 改為不做自然／科技教室優先求解，教室結構交給權重']
      else r.notes = [...(best.notes ?? []), '整份排不完 → 改為不做自然／科技教室優先求解，教室結構交給權重']
      if (betterThan(r, best)) { best = r; bestSeed = seed }
    }
    // ① 從最佳解熱啟動純硬
    const fixed = await runOne({ ...hardOnlyInput(input), seed: bestSeed }, {
      label: '保底：從最佳解補完（純硬）', budget: RESCUE_FIX, perfectExit: true,
      initial: best.placed.map(p => ({ id: p.id, day: p.day, period: p.period, teacherId: p.teacherId, teacherName: p.teacherName })),
    })
    if (isPerfect(fixed)) await polish(fixed, bestSeed, '保底：加權優化')
    // ② 仍不完整 → 從零純硬多試幾個種子
    for (let k = 0; k < RESCUE_SEEDS.length && !isPerfect(best) && !stopRequested; k++) {
      const seed = RESCUE_SEEDS[k]
      const feasible = await runOne({ ...hardOnlyInput(input), seed }, {
        label: `保底 ${k + 1}/${RESCUE_SEEDS.length}：純硬從零`, budget: RESCUE_HARD, perfectExit: true,
      })
      if (isPerfect(feasible)) await polish(feasible, seed, `保底 ${k + 1}/${RESCUE_SEEDS.length}：加權優化`)
    }
  }

  // ── 收尾榨乾：用調課鄰域（直接搬／兩角／三角）一輪輪掃到沒有更好的為止（使用者中途停止則跳過） ──
  if (isPerfect(best) && !stopRequested) {
    const t0 = Date.now()
    best = await polishResult(input, best, {
      shouldStop: () => stopRequested,
      onProgress: pg => self.postMessage({
        type: 'progress', label: `收尾榨乾 第 ${pg.round} 輪${pg.withThree ? '（含三角）' : ''}・已套用 ${pg.applied} 筆`,
        iter: 0, best: pg.soft, softBest: pg.soft, elapsed: Date.now() - t0, placed: pg.done, unplaced: 0, sinceImproveMs: 0,
      }),
    })
  }
  if (isPerfect(best) || stopRequested) {
    self.postMessage({ type: 'done', result: best, stopped: stopRequested, failed: !isPerfect(best), hints: [], probePerfect: null, meta: { seed: bestSeed } })
    return
  }
  const diag = await diagnose(input, best, bestSeed)
  self.postMessage({ type: 'done', result: best, stopped: false, failed: true, hints: diag.hints, probePerfect: diag.probePerfect, meta: { seed: bestSeed } })
}
