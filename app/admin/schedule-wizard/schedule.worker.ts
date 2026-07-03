// 排課引擎 Web Worker：在瀏覽器背景執行緒跑建構＋局部搜尋，不卡 UI、不受伺服器時限。
import { runEngine, type EngineInput } from '../../../lib/schedule-engine'

self.onmessage = (e: MessageEvent<{ input: EngineInput; timeMs: number }>) => {
  const { input, timeMs } = e.data
  const result = runEngine(input, {
    timeMs,
    onProgress: p => self.postMessage({ type: 'progress', ...p }),
  })
  self.postMessage({ type: 'done', result })
}
