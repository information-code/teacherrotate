import React from 'react'
import { Audio, Sequence } from 'remotion'
import { SCENE_IDS, phraseWindows, sceneFrames, type SceneId } from './timing'
import { TimedCaptions } from './components'
import narration from './narration.json'
import { Scene1, Scene2, Scene3, Scene4, Scene5, Scene6, Scene7, Scene9, SceneInstall } from './scenes'

import a1_0 from './assets/audio/s1_0.mp3'
import a1_1 from './assets/audio/s1_1.mp3'
import aI_0 from './assets/audio/sInstall_0.mp3'
import aI_1 from './assets/audio/sInstall_1.mp3'
import aI_2 from './assets/audio/sInstall_2.mp3'
import aI_3 from './assets/audio/sInstall_3.mp3'
import aI_4 from './assets/audio/sInstall_4.mp3'
import a2_0 from './assets/audio/s2_0.mp3'
import a3_0 from './assets/audio/s3_0.mp3'
import a3_1 from './assets/audio/s3_1.mp3'
import a3_2 from './assets/audio/s3_2.mp3'
import a4_0 from './assets/audio/s4_0.mp3'
import a4_1 from './assets/audio/s4_1.mp3'
import a4_2 from './assets/audio/s4_2.mp3'
import a5_0 from './assets/audio/s5_0.mp3'
import a5_1 from './assets/audio/s5_1.mp3'
import a6_0 from './assets/audio/s6_0.mp3'
import a6_1 from './assets/audio/s6_1.mp3'
import a7_0 from './assets/audio/s7_0.mp3'
import a7_1 from './assets/audio/s7_1.mp3'
import a9_0 from './assets/audio/s9_0.mp3'

const AUDIO: Record<SceneId, string[]> = {
  s1: [a1_0, a1_1],
  sInstall: [aI_0, aI_1, aI_2, aI_3, aI_4],
  s2: [a2_0],
  s3: [a3_0, a3_1, a3_2],
  s4: [a4_0, a4_1, a4_2],
  s5: [a5_0, a5_1],
  s6: [a6_0, a6_1],
  s7: [a7_0, a7_1],
  s9: [a9_0],
}

const PHRASES: Record<SceneId, string[]> = Object.fromEntries(
  narration.map(n => [n.id, n.phrases])
) as Record<SceneId, string[]>

const SceneComponent: React.FC<{ id: SceneId; frames: number }> = ({ id, frames }) => {
  switch (id) {
    case 's1': return <Scene1 />
    case 'sInstall': return <SceneInstall frames={frames} />
    case 's2': return <Scene2 />
    case 's3': return <Scene3 frames={frames} />
    case 's4': return <Scene4 frames={frames} />
    case 's5': return <Scene5 frames={frames} />
    case 's6': return <Scene6 frames={frames} />
    case 's7': return <Scene7 frames={frames} />
    case 's9': return <Scene9 />
  }
}

export const Main: React.FC = () => {
  let from = 0
  return (
    <>
      {SCENE_IDS.map(id => {
        const frames = sceneFrames(id)
        const windows = phraseWindows(id)
        const seq = (
          <Sequence key={id} from={from} durationInFrames={frames}>
            <SceneComponent id={id} frames={frames} />
            {windows.map((w, i) => (
              <Sequence key={i} from={w.from}>
                <Audio src={AUDIO[id][i]} />
              </Sequence>
            ))}
            <TimedCaptions phrases={PHRASES[id]} windows={windows} />
          </Sequence>
        )
        from += frames
        return seq
      })}
    </>
  )
}
