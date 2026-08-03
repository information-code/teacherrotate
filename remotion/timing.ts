import durations from './assets/audio/durations.json'

export const FPS = 30
/** 每景旁白開始前/結束後的緩衝（幀） */
export const PAD_START = 14
export const PAD_END = 22

export type SceneId = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8' | 's9'

export const SCENE_IDS: SceneId[] = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']

/** 各景長度（幀）＝旁白長度＋前後緩衝 */
export const sceneFrames = (id: SceneId): number =>
  PAD_START + Math.ceil((durations as Record<string, number>)[id] * FPS) + PAD_END

export const TOTAL_FRAMES = SCENE_IDS.reduce((sum, id) => sum + sceneFrames(id), 0)
