// 排課引擎 Web Worker：分段執行局部搜尋，收斂即自動完成；可中途停止並採用目前最佳解。
import { EngineRun, type EngineInput } from '../../../../lib/schedule-engine'

const CONVERGE_MS = 8000    // 連續無進步達此時間 → 視為收斂，自動完成
const CAP_MS = 90000        // 絕對上限（防呆）
const CHUNK_MS = 300        // 每段搜尋時間，段間讓出事件圈以接收停止訊息

let stopRequested = false

self.onmessage = async (e: MessageEvent<{ type?: string; input?: EngineInput }>) => {
  if (e.data.type === 'stop') { stopRequested = true; return }
  if (!e.data.input) return
  stopRequested = false
  const run = new EngineRun(e.data.input)
  for (;;) {
    run.step(CHUNK_MS)
    self.postMessage({ type: 'progress', ...run.progress() })
    if (stopRequested || run.sinceImprove >= CONVERGE_MS || run.elapsed >= CAP_MS) break
    await new Promise(r => setTimeout(r, 0))
  }
  self.postMessage({ type: 'done', result: run.finalize(), stopped: stopRequested })
}
