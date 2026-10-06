import React, { useEffect, useState } from 'react'
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender } from 'remotion'
import narration from './narration.json'
import { SCENE_IDS, phraseWindows, sceneFrames, type SceneId } from './timing'
import { C, Captions, SketchDefs } from './doodle'
import { LABEL_TEXT, SCENES } from './scenes'

import intro0 from './assets/audio/intro_0.mp3'
import intro1 from './assets/audio/intro_1.mp3'
import board0 from './assets/audio/board_0.mp3'
import board1 from './assets/audio/board_1.mp3'
import board2 from './assets/audio/board_2.mp3'
import reserve0 from './assets/audio/reserve_0.mp3'
import reserve1 from './assets/audio/reserve_1.mp3'
import borrow0 from './assets/audio/borrow_0.mp3'
import borrow1 from './assets/audio/borrow_1.mp3'
import borrow2 from './assets/audio/borrow_2.mp3'
import giveback0 from './assets/audio/giveback_0.mp3'
import giveback1 from './assets/audio/giveback_1.mp3'
import giveback2 from './assets/audio/giveback_2.mp3'
import tips0 from './assets/audio/tips_0.mp3'
import tips1 from './assets/audio/tips_1.mp3'
import outro0 from './assets/audio/outro_0.mp3'

const AUDIO: Record<SceneId, string[]> = {
  intro: [intro0, intro1],
  board: [board0, board1, board2],
  reserve: [reserve0, reserve1],
  borrow: [borrow0, borrow1, borrow2],
  giveback: [giveback0, giveback1, giveback2],
  tips: [tips0, tips1],
  outro: [outro0],
}

const PHRASES = Object.fromEntries(narration.map(s => [s.id, s.phrases])) as Record<SceneId, string[]>

/** 手寫字型（霞鶩文楷 TC）；中文字型依 unicode-range 切檔，只載入影片用到的字 */
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&display=block'
const ALL_TEXT = Array.from(new Set(narration.flatMap(s => s.phrases).join('') + LABEL_TEXT + '①②③→›')).join('')

const useHandwritingFont = () => {
  const [handle] = useState(() => delayRender('載入手寫字型', { timeoutInMilliseconds: 90000 }))
  useEffect(() => {
    const done = () => continueRender(handle)
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONT_CSS
    link.onload = () => {
      Promise.all([
        document.fonts.load('400 48px "LXGW WenKai TC"', ALL_TEXT),
        document.fonts.load('700 48px "LXGW WenKai TC"', ALL_TEXT),
      ]).then(done, done)
    }
    link.onerror = done
    document.head.appendChild(link)
  }, [handle])
}

export const Lending: React.FC = () => {
  useHandwritingFont()
  let from = 0
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <SketchDefs />
      {SCENE_IDS.map(id => {
        const frames = sceneFrames(id)
        const windows = phraseWindows(id)
        const Scene = SCENES[id]
        const start = from
        from += frames
        return (
          <Sequence key={id} from={start} durationInFrames={frames} name={id}>
            <Scene />
            <Captions phrases={PHRASES[id]} windows={windows} />
            {windows.map((w, i) => (
              <Sequence key={i} from={w.from}>
                <Audio src={AUDIO[id][i]} />
              </Sequence>
            ))}
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
