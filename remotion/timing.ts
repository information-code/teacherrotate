import durations from './assets/audio/durations.json'

export const FPS = 30
/** 每景旁白開始前/結束後的緩衝（幀） */
export const PAD_START = 14
export const PAD_END = 22
/** 句與句之間的停頓（幀） */
export const PHRASE_GAP = 5

export type SceneId = 's1' | 'sInstall' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's9'

export const SCENE_IDS: SceneId[] = ['s1', 'sInstall', 's2', 's3', 's4', 's5', 's6', 's7', 's9']

/** 特定場景的額外停留（幀）：安裝教學讓觀眾有時間掃 QR / 按暫停 */
const EXTRA_END: Partial<Record<SceneId, number>> = { sInstall: 110 }

export interface PhraseWindow {
  from: number
  frames: number
}

/** 各句在該景內的時間窗（依各句音檔長度累加），字幕與語音以此同步 */
export const phraseWindows = (id: SceneId): PhraseWindow[] => {
  const list = (durations as Record<string, number[]>)[id]
  let cursor = PAD_START
  return list.map(seconds => {
    const frames = Math.ceil(seconds * FPS)
    const window = { from: cursor, frames }
    cursor += frames + PHRASE_GAP
    return window
  })
}

/** 各景長度（幀） */
export const sceneFrames = (id: SceneId): number => {
  const windows = phraseWindows(id)
  const last = windows[windows.length - 1]
  return last.from + last.frames + PAD_END + (EXTRA_END[id] ?? 0)
}

export const TOTAL_FRAMES = SCENE_IDS.reduce((sum, id) => sum + sceneFrames(id), 0)
