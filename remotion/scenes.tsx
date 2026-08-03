import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  Backdrop, BrowserFrame, Caption, FONT, PhoneFrame, SceneFade, ShotSwap, SidePoints, Spotlight, TapRipple,
} from './components'
import narration from './narration.json'

import logoRaw from '../public/icons/icon-512.png'
import qrRaw from './assets/qr.png'
import s02Raw from './assets/shots/s02-teacher-home.png'
import s03aRaw from './assets/shots/s03a-selected.png'
import s03bRaw from './assets/shots/s03b-results.png'
import s03cRaw from './assets/shots/s03c-reserved.png'
import s04aRaw from './assets/shots/s04a-agreement.png'
import s04bRaw from './assets/shots/s04b-checklist.png'
import s04cRaw from './assets/shots/s04c-borrowed.png'
import s05aRaw from './assets/shots/s05a-return.png'
import s05bRaw from './assets/shots/s05b-done.png'
import s06Raw from './assets/shots/s06-group.png'
import s07aRaw from './assets/shots/s07a-long.png'
import s07bRaw from './assets/shots/s07b-renewal.png'
import s08aRaw from './assets/shots/s08a-admin-overview.png'
import s08bRaw from './assets/shots/s08b-admin-log.png'

// Next.js 的 next-env.d.ts 把 png 匯入視為 StaticImageData，
// Remotion bundler 實際回傳字串網址——統一轉型
const asSrc = (m: unknown): string => m as string
const logo = asSrc(logoRaw)
const qr = asSrc(qrRaw)
const s02 = asSrc(s02Raw)
const s03a = asSrc(s03aRaw)
const s03b = asSrc(s03bRaw)
const s03c = asSrc(s03cRaw)
const s04a = asSrc(s04aRaw)
const s04b = asSrc(s04bRaw)
const s04c = asSrc(s04cRaw)
const s05a = asSrc(s05aRaw)
const s05b = asSrc(s05bRaw)
const s06 = asSrc(s06Raw)
const s07a = asSrc(s07aRaw)
const s07b = asSrc(s07bRaw)
const s08a = asSrc(s08aRaw)
const s08b = asSrc(s08bRaw)

const text = (id: string) => narration.find(n => n.id === id)?.text ?? ''

/** 手機置左、右側重點欄的標準版面 */
const PhoneLayout: React.FC<{ phone: React.ReactNode; side: React.ReactNode; caption: string }> = ({ phone, side, caption }) => (
  <SceneFade>
    <Backdrop />
    <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 110, paddingBottom: 60 }}>
      <div>{phone}</div>
      {side}
    </AbsoluteFill>
    <Caption text={caption} />
  </SceneFade>
)

// ---------- S1 開場 ----------
export const Scene1: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 120 } })
  const rise = interpolate(frame, [10, 28], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const fade = interpolate(frame, [10, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const sub = interpolate(frame, [26, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <SceneFade>
      <Backdrop dark />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <Img src={logo} style={{ width: 210, height: 210, borderRadius: 48, transform: `scale(${pop})`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }} />
        <div style={{ fontSize: 96, fontWeight: 700, color: '#fafafa', marginTop: 48, opacity: fade, transform: `translateY(${rise}px)` }}>
          設備借用系統
        </div>
        <div style={{ fontSize: 40, color: '#a1a1aa', marginTop: 22, opacity: sub, letterSpacing: 4 }}>
          借用・歸還・管理，一支手機完成
        </div>
      </AbsoluteFill>
      <Caption text={text('s1')} />
    </SceneFade>
  )
}

// ---------- S2 進入設備借用 ----------
export const Scene2: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const slide = spring({ frame, fps, config: { damping: 16 }, durationInFrames: 30 })
  return (
    <PhoneLayout
      caption={text('s2')}
      phone={
        <div style={{ transform: `translateY(${(1 - slide) * 120}px)` }}>
          <PhoneFrame>
            <Img src={s02} style={{ width: '100%' }} />
          </PhoneFrame>
        </div>
      }
      side={
        <SidePoints
          title="打開就能借"
          points={[
            { text: '教師系統側欄「設備借用」', at: 20 },
            { text: '短期借用・長期借用', at: 46 },
          ]}
        />
      }
    />
  )
}

// ---------- S3 四步驟預約 ----------
export const Scene3: React.FC<{ frames: number }> = ({ frames }) => {
  const swap1 = Math.round(frames * 0.42)
  const swap2 = Math.round(frames * 0.74)
  return (
    <PhoneLayout
      caption={text('s3')}
      phone={
        <PhoneFrame>
          <ShotSwap shots={[s03a, s03b, s03c]} swapAt={[swap1, swap2]} />
          <Spotlight x={0.05} y={0.2} w={0.9} h={0.22} from={14} to={swap1 - 20} />
          <TapRipple cx={0.83} cy={0.447} at={swap1 - 14} />
          <Spotlight x={0.07} y={0.55} w={0.86} h={0.14} from={swap1 + 10} to={swap2 - 18} />
          <TapRipple cx={0.5} cy={0.648} at={swap2 - 12} />
        </PhoneFrame>
      }
      side={
        <SidePoints
          title="四步驟完成預約"
          points={[
            { text: '選日期與節次', at: 16 },
            { text: '選設備，按「確定」', at: Math.round(frames * 0.3) },
            { text: '挑一台可借的編號', at: swap1 + 12 },
            { text: '點「預約借用」完成', at: swap2 + 10 },
          ]}
        />
      }
    />
  )
}

// ---------- S4 借用手續 ----------
export const Scene4: React.FC<{ frames: number }> = ({ frames }) => {
  const swap1 = Math.round(frames * 0.38)
  const swap2 = Math.round(frames * 0.76)
  return (
    <PhoneLayout
      caption={text('s4')}
      phone={
        <PhoneFrame>
          <ShotSwap shots={[s04a, s04b, s04c]} swapAt={[swap1, swap2]} />
          <TapRipple cx={0.72} cy={0.7} at={swap1 - 12} />
          <Spotlight x={0.08} y={0.36} w={0.84} h={0.34} from={swap1 + 10} to={swap2 - 16} />
        </PhoneFrame>
      }
      side={
        <SidePoints
          title="借用手續"
          points={[
            { text: '勾選借用同意書', at: 16 },
            { text: '逐項檢查＋拍照存證', at: swap1 + 12 },
            { text: '完成，設備正式借出', at: swap2 + 10 },
          ]}
        />
      }
    />
  )
}

// ---------- S5 歸還 ----------
export const Scene5: React.FC<{ frames: number }> = ({ frames }) => {
  const swap1 = Math.round(frames * 0.55)
  return (
    <PhoneLayout
      caption={text('s5')}
      phone={
        <PhoneFrame>
          <ShotSwap shots={[s05a, s05b]} swapAt={[swap1]} />
          <Spotlight x={0.08} y={0.3} w={0.84} h={0.36} from={12} to={swap1 - 16} />
        </PhoneFrame>
      }
      side={
        <SidePoints
          title="歸還"
          points={[
            { text: '歸還檢查＋拍照', at: 16 },
            { text: '歸位完成，紀錄自動保存', at: swap1 + 10 },
          ]}
        />
      }
    />
  )
}

// ---------- S6 整組借用 ----------
export const Scene6: React.FC<{ frames: number }> = ({ frames }) => {
  return (
    <PhoneLayout
      caption={text('s6')}
      phone={
        <PhoneFrame>
          <Img src={s06} style={{ width: '100%' }} />
          <Spotlight x={0.05} y={0.52} w={0.9} h={0.22} from={Math.round(frames * 0.3)} to={frames - 14} />
        </PhoneFrame>
      }
      side={
        <SidePoints
          title="整組借用"
          points={[
            { text: '整車平板一次預約', at: 16 },
            { text: '全組保留、逐台不衝突', at: Math.round(frames * 0.45) },
          ]}
        />
      }
    />
  )
}

// ---------- S7 長期借用與續借 ----------
export const Scene7: React.FC<{ frames: number }> = ({ frames }) => {
  const swap1 = Math.round(frames * 0.5)
  return (
    <PhoneLayout
      caption={text('s7')}
      phone={
        <PhoneFrame>
          <ShotSwap shots={[s07a, s07b]} swapAt={[swap1]} />
        </PhoneFrame>
      }
      side={
        <SidePoints
          title="長期借用"
          points={[
            { text: '名下設備一覽、到期提醒', at: 16 },
            { text: '拍照回傳，自動續借', at: swap1 + 10 },
          ]}
        />
      }
    />
  )
}

// ---------- S8 管理端 ----------
export const Scene8: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame()
  const swap1 = Math.round(frames * 0.55)
  const zoom = interpolate(frame, [0, frames], [1, 1.06])
  return (
    <SceneFade>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 70 }}>
        <div style={{ transform: `scale(${zoom})` }}>
          <BrowserFrame width={1600}>
            <ShotSwap shots={[s08a, s08b]} swapAt={[swap1]} />
          </BrowserFrame>
        </div>
      </AbsoluteFill>
      <Caption text={text('s8')} />
    </SceneFade>
  )
}

// ---------- S9 結尾 ----------
export const Scene9: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = spring({ frame: frame - 8, fps, config: { damping: 13 } })
  const bullets = ['手機預約，馬上借', '拍照借還，有憑有據', '紀錄自動保存']
  return (
    <SceneFade>
      <Backdrop dark />
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 140, fontFamily: FONT }}>
        <div>
          <div style={{ fontSize: 72, fontWeight: 700, color: '#fafafa', marginBottom: 54 }}>設備借用系統</div>
          {bullets.map((b, i) => {
            const at = 14 + i * 14
            const prog = interpolate(frame, [at, at + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            return (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 32, opacity: prog, transform: `translateX(${(1 - prog) * 40}px)` }}>
                <div style={{ width: 46, height: 46, borderRadius: 23, background: '#f59e0b', color: '#fff', fontSize: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
                <div style={{ fontSize: 44, color: '#e4e4e7' }}>{b}</div>
              </div>
            )
          })}
        </div>
        <div style={{ textAlign: 'center', transform: `scale(${pop})` }}>
          <div style={{ background: '#fff', padding: 26, borderRadius: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
            <Img src={qr} style={{ width: 330, height: 330, display: 'block' }} />
          </div>
          <div style={{ fontSize: 30, color: '#a1a1aa', marginTop: 26, letterSpacing: 2 }}>掃描開啟教師系統</div>
        </div>
      </AbsoluteFill>
      <Caption text={text('s9')} />
    </SceneFade>
  )
}
