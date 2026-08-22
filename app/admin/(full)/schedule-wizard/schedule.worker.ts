// 排課引擎 Web Worker：硬限制＋權重一次跑，成功條件＝未排 0 且必須級 0。
//   一個種子一個種子跑（硬限制＋權重全開，不做任何「關掉權重先塞進去」的補救——那樣塞出來的位置不是權重選的），
//   跑到成功就立刻收尾榨乾、不再跑其他種子；沒跑到就換新的種子繼續
//   （前五個是固定種子、結果可重現，之後改用衍生的隨機種子），直到成功／使用者停止／安全上限（40 個種子或 30 分鐘）。
//   罰分字典序：未排（1e5/堂）→ 必須級（1e6/筆）→ 軟權重——引擎天生先求排入、再求好看，不需分兩階段。
//   每個種子跑到收斂（只差 1～2 節時多給耐心）；已有完整解後其餘種子縮短預算、只為多起點比軟分。
//   全部種子跑完仍有未排 → 診斷：以純硬模式從最佳解熱啟動探測——
//     探測排得完 → 是權重把搜尋牽住了：比對哪些規則在探測解裡多了違反 → 建議降低那些權重；
//     探測也排不完 → 非權重問題（硬限制／配課結構），列未排原因。
// 全程可中途停止並採用目前最佳解。
import { EngineRun, polishResult, type EngineInput, type EngineResult } from '../../../../lib/schedule-engine'

const CHUNK_MS = 300
const SEEDS = [42, 7, 17, 63, 3]          // 先跑這幾個固定種子（結果可重現）；不成再無限換新種子
const MAX_SEEDS = 40                      // 安全上限：真的排不出來時不要無止盡跑下去（可隨時按「停止並採用」）
const MAX_MS = 30 * 60 * 1000             // 同上，時間上限 30 分鐘
const BUDGET = { converge: 25000, cap: 120000 }       // 尚未有完整解：每種子收斂/上限（必須級條件變多後，沙盒實測成功的種子要跑滿 90s，上限放寬到 120s）
const PROBE_MS = 20000

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
        homeroomDailyMax: { ...b.homeroomDailyMax, level: 'off', hardN: 99, hardFullDayLowN: 99 },
        homeroomMorningMax: { ...b.homeroomMorningMax, level: 'off', must: false }, specialDoublesHalf: 'off', biweeklyHalfDay: 'off',
        compact: 'off', classCohesion: 'off', batchType: 'off', bandAdjacent: 'off', teacherApart: 'off',
        hourlyBalance: { ...b.hourlyBalance, level: 'off', must: false },
        lonelyDay: { level: 'off', halfLevel: 'off', partTimeMust: false },
        lowLoadConcentrate: { ...b.lowLoadConcentrate, level: 'off' },
        homeroomRun: 'off', gradeSandwich: 'off', zoneSandwich: 'off', homeroomDailyMin: { ...b.homeroomDailyMin, level: 'off', must: false },
        teacherEveryDay: { ...b.teacherEveryDay, level: 'off' }, teacherSpread: { ...b.teacherSpread, level: 'off' }, shortBreakCross: { ...b.shortBreakCross, level: 'off' },
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
  // EngineRun 的建構子會把 638 堂課整份排一次（含教室優先求解、定向修補），是同步的、要好幾秒；
  // 先送一則進度出去，畫面才不會從按下按鈕到第一次 step 之間一片空白、看起來像當機
  self.postMessage({ type: 'progress', label: `${opts.label}・建立初始課表…`, iter: 0, best: 0, softBest: 0, elapsed: 0, placed: 0, unplaced: input.lessons.length, sinceImproveMs: 0 })
  await new Promise(r => setTimeout(r, 0))
  const run = new EngineRun(input, opts.initial)
  for (;;) {
    run.step(CHUNK_MS)
    const pg = run.progress()
    self.postMessage({ type: 'progress', label: opts.label, ...pg })
    if (stopRequested) break
    if (opts.perfectExit && pg.best === 0) break
    // 只差 1～2 節（未排＋必須級合計 ≤2）時多給耐心。
    // 舊寫法 `best < 2.1e6` 太寬鬆：未排一堂 1e5，等於「差 20 堂」也算 near-perfect，白等一倍時間——改成直接數筆數
    const musts = Math.max(0, Math.floor((pg.best - pg.unplaced * 1e5) / 1e6))
    const short = pg.unplaced + musts
    const nearPerfect = short > 0 && short <= 2
    // 只差 1～2 節時不只多給耐心，上限也放寬一半：沙盒實測五個種子在 120s 都還在進步、各差 1～3 筆
    if (run.sinceImprove >= opts.budget.converge * (nearPerfect ? 2.5 : 1) || run.elapsed >= opts.budget.cap * (nearPerfect ? 1.5 : 1)) break
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
  // 卡住的若是「可勾選的必須級」（導師每日下限、鐘點天數、鐘點／代理孤堂日、導師連堂位）——純硬探測把它們關掉才排得完，
  // 那不是權重問題，是這條必須級跟其他條件打架：直接點名是哪幾班／哪幾位，讓課務組決定放寬哪一邊
  const mustItems = best.penalties.filter(p => p.points >= 1e6 && p.key !== 'unplaced')
  for (const p of mustItems) hints.push(`必須級「${p.label}」${p.count} 筆：${p.items.slice(0, 6).join('；')}${p.items.length > 6 ? '…' : ''}——可於權重頁取消該條必須級，或調整相關設定（不排課／鎖課／配課）`)
  return { probePerfect: true, hints }
}

self.onmessage = async (e: MessageEvent<{ type?: string; input?: EngineInput }>) => {
  if (e.data.type === 'stop') { stopRequested = true; return }
  if (!e.data.input) return
  stopRequested = false
  const input = e.data.input

  // ── 一個種子一個種子跑，跑到「未排 0、必須級 0」就立刻收尾，不跑完剩下的種子 ──
  // 沒跑到就換新種子繼續（固定的五個用完之後改用衍生的隨機種子），直到成功、或使用者按停止、或碰到安全上限。
  let best: EngineResult | null = null
  let bestSeed = SEEDS[0]
  const t0 = Date.now()
  for (let i = 0; i < MAX_SEEDS && !stopRequested; i++) {
    if (i > 0 && Date.now() - t0 > MAX_MS) break
    const seed = i < SEEDS.length ? SEEDS[i] : (SEEDS[0] + (i + 1) * 7919 + Math.floor(Math.random() * 5000)) % 1_000_003
    const sT0 = Date.now()
    const r = await runOne({ ...input, seed }, { label: `第 ${i + 1} 個種子`, budget: BUDGET })
    // 每顆種子的結果都回報一筆：跑二十分鐘沒人看著，回來要能一眼看出試了幾顆、差在哪
    self.postMessage({
      type: 'seed', no: i + 1, seed, ok: isPerfect(r),
      unplaced: r.unplaced.length, musts: mustCountOf(r), soft: Math.round(r.softPenalty),
      ms: Date.now() - sT0, at: Date.now(), stopped: stopRequested,
    })
    if (!best || betterThan(r, best)) { best = r; bestSeed = seed }
    if (isPerfect(r)) break
  }
  if (!best) return

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
