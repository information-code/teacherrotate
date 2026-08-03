import React from 'react'
import { Audio, Sequence } from 'remotion'
import { PAD_START, SCENE_IDS, sceneFrames, type SceneId } from './timing'
import { Scene1, Scene2, Scene3, Scene4, Scene5, Scene6, Scene7, Scene8, Scene9 } from './scenes'

import a1 from './assets/audio/s1.mp3'
import a2 from './assets/audio/s2.mp3'
import a3 from './assets/audio/s3.mp3'
import a4 from './assets/audio/s4.mp3'
import a5 from './assets/audio/s5.mp3'
import a6 from './assets/audio/s6.mp3'
import a7 from './assets/audio/s7.mp3'
import a8 from './assets/audio/s8.mp3'
import a9 from './assets/audio/s9.mp3'

const AUDIO: Record<SceneId, string> = { s1: a1, s2: a2, s3: a3, s4: a4, s5: a5, s6: a6, s7: a7, s8: a8, s9: a9 }

const SceneComponent: React.FC<{ id: SceneId; frames: number }> = ({ id, frames }) => {
  switch (id) {
    case 's1': return <Scene1 />
    case 's2': return <Scene2 />
    case 's3': return <Scene3 frames={frames} />
    case 's4': return <Scene4 frames={frames} />
    case 's5': return <Scene5 frames={frames} />
    case 's6': return <Scene6 frames={frames} />
    case 's7': return <Scene7 frames={frames} />
    case 's8': return <Scene8 frames={frames} />
    case 's9': return <Scene9 />
  }
}

export const Main: React.FC = () => {
  let from = 0
  return (
    <>
      {SCENE_IDS.map(id => {
        const frames = sceneFrames(id)
        const seq = (
          <Sequence key={id} from={from} durationInFrames={frames}>
            <SceneComponent id={id} frames={frames} />
            <Sequence from={PAD_START}>
              <Audio src={AUDIO[id]} />
            </Sequence>
          </Sequence>
        )
        from += frames
        return seq
      })}
    </>
  )
}
