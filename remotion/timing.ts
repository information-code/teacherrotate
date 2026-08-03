import durations from './assets/audio/durations.json'

export const FPS = 30
/** 每景旁白開始前/結束後的緩衝（幀） */
export const PAD_START = 14
export const PAD_END = 22

export type SceneId = 's1' | 'sInstall' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's9'

export const SCENE_IDS: SceneId[] = ['s1', 'sInstall', 's2', 's3', 's4', 's5', 's6', 's7', 's9']

/** 特定場景的額外停留（幀）：安裝教學讓觀眾有時間掃 QR / 按暫停 */
const EXTRA_END: Partial<Record<SceneId, number>> = { sInstall: 110 }

/** 各景長度（幀）＝旁白長度＋前後緩衝＋額外停留 */
export const sceneFrames = (id: SceneId): number =>
  PAD_START + Math.ceil((durations as Record<string, number>)[id] * FPS) + PAD_END + (EXTRA_END[id] ?? 0)

export const TOTAL_FRAMES = SCENE_IDS.reduce((sum, id) => sum + sceneFrames(id), 0)
