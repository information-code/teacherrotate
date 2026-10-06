import React from 'react'
import { Composition } from 'remotion'
import { Lending } from './Lending'
import { FPS, TOTAL_FRAMES } from './timing'

export const Root: React.FC = () => (
  <Composition
    id="LendingGuide"
    component={Lending}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
)
