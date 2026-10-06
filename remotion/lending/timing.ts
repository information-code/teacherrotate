import durations from './assets/audio/durations.json'

export const FPS = 30
/** 每景旁白開始前/結束後的緩衝（幀） */
export const PAD_START = 12
export const PAD_END = 20
/** 句與句之間的停頓（幀） */
export const PHRASE_GAP = 6

export type SceneId = 'intro' | 'board' | 'reserve' | 'borrow' | 'giveback' | 'tips' | 'outro'

export const SCENE_IDS: SceneId[] = ['intro', 'board', 'reserve', 'borrow', 'giveback', 'tips', 'outro']

/** 結尾多停一下 */
const EXTRA_END: Partial<Record<SceneId, number>> = { outro: 40 }

export interface PhraseWindow {
  from: number
  frames: number
}

/** 各句在該景內的時間窗（依各句音檔長度累加），字幕、語音、畫面動作都以此同步 */
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
