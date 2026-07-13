// 排課引擎 Web Worker：兩階段執行。
// 階段一（可行性・需要）：關閉所有軟規則，多種子輪流求「未排 0＋必須級 0」的完整解；
//   全部種子都找不到 → 直接回報失敗（帶最佳嘗試供診斷），不進階段二。
// 階段二（精緻化・想要）：軟規則＋自訂規則全開，以階段一完整解「熱啟動」優化，
//   另跑一輪「冷啟動」對照，取較佳者（未排 → 必須級 → 軟分 字典序比較）。
// 全程可中途停止並採用目前最佳解。
import { EngineRun, type EngineInput, type EngineResult } from '../../../../lib/schedule-engine'

const CHUNK_MS = 300        // 每段搜尋時間，段間讓出事件圈以接收停止訊息
const P1 = { converge: 8000, cap: 45000 }   // 階段一：每種子收斂/上限
const P2 = { converge: 8000, cap: 90000 }   // 階段二：每輪收斂/上限
const P1_SEEDS = [42, 7, 17, 63, 3]

let stopRequested = false

/** 純硬限制版輸入：內建軟規則全關、自訂規則關（連堂設定為課的結構、已反映在 lessons，不受影響）。 */
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
        compact: 'off', dayBalance: 'off', walkCost: 'off', roomPrefer: 'off',
        roomManagerFirst: 'off', homeroomMorning: 'off', homeroomBalance: 'off',
      },
      templates: input.weights.templates.map(t => t.template === 'doublePeriod' ? t : { ...t, level: 'off' as const }),
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
  opts: { phase: 1 | 2; label: string; budget: { converge: number; cap: number }; perfectExit?: boolean; initial?: { id: string; day: number; period: number }[] },
): Promise<EngineResult> {
  const run = new EngineRun(input, opts.initial)
  for (;;) {
    run.step(CHUNK_MS)
    self.postMessage({ type: 'progress', phase: opts.phase, label: opts.label, ...run.progress() })
    if (stopRequested) break
    if (opts.perfectExit && run.progress().best === 0) break   // 純硬模式下 0 分＝完整解
    if (run.sinceImprove >= opts.budget.converge || run.elapsed >= opts.budget.cap) break
    await new Promise(r => setTimeout(r, 0))
  }
  return run.finalize()
}

self.onmessage = async (e: MessageEvent<{ type?: string; input?: EngineInput }>) => {
  if (e.data.type === 'stop') { stopRequested = true; return }
  if (!e.data.input) return
  stopRequested = false
  const input = e.data.input

  // ── 階段一：純硬多種子求可行解 ──
  const hard = hardOnlyInput(input)
  let p1: EngineResult | null = null
  let p1Seed = P1_SEEDS[0]
  for (let i = 0; i < P1_SEEDS.length; i++) {
    const seed = P1_SEEDS[i]
    const r = await runOne({ ...hard, seed }, {
      phase: 1, label: `種子 ${i + 1}/${P1_SEEDS.length}`, budget: P1, perfectExit: true,
    })
    if (!p1 || betterThan(r, p1)) { p1 = r; p1Seed = seed }
    if (stopRequested || isPerfect(r)) break
  }

  if (stopRequested || !p1 || !isPerfect(p1)) {
    // 中途停止 → 採用目前最佳；跑完仍不完整 → 回報階段一失敗（附最佳嘗試供診斷）
    self.postMessage({ type: 'done', result: p1, stopped: stopRequested, phase: 1, phase1Failed: !stopRequested })
    return
  }

  // ── 階段二：軟規則全開，熱啟動（自階段一解）＋冷啟動對照 ──
  const warm = await runOne({ ...input, seed: p1Seed }, {
    phase: 2, label: '熱啟動優化', budget: P2,
    initial: p1.placed.map(p => ({ id: p.id, day: p.day, period: p.period })),
  })
  let final = warm
  let winner: 'warm' | 'cold' = 'warm'
  if (!stopRequested) {
    const cold = await runOne({ ...input, seed: p1Seed + 1 }, { phase: 2, label: '冷啟動對照', budget: P2 })
    if (betterThan(cold, warm)) { final = cold; winner = 'cold' }
  }
  self.postMessage({ type: 'done', result: final, stopped: stopRequested, phase: 2, meta: { p1Seed, winner } })
}
