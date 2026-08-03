import React from 'react'
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion'

export const FONT = '"Microsoft JhengHei", "Noto Sans TC", sans-serif'
export const PHONE_W = 390
export const PHONE_H = 844

/** 全片共用底色 */
export const Backdrop: React.FC<{ dark?: boolean }> = ({ dark }) => (
  <AbsoluteFill
    style={{
      background: dark
        ? 'linear-gradient(140deg, #18181b 0%, #27272a 60%, #3f3f46 100%)'
        : 'linear-gradient(140deg, #fafafa 0%, #f4f4f5 55%, #e4e4e7 100%)',
    }}
  />
)

/** 場景淡入容器 */
export const SceneFade: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })
  return <AbsoluteFill style={{ opacity, fontFamily: FONT }}>{children}</AbsoluteFill>
}

/** 手機殼：內容為截圖（390×844 視窗、@2x） */
export const PhoneFrame: React.FC<{
  height?: number
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ height = 900, children, style }) => {
  const innerH = height - 28
  const innerW = innerH * (PHONE_W / PHONE_H)
  return (
    <div
      style={{
        width: innerW + 28,
        height,
        background: '#18181b',
        borderRadius: 54,
        padding: 14,
        boxShadow: '0 30px 70px rgba(0,0,0,0.35)',
        position: 'relative',
        ...style,
      }}
    >
      <div style={{ width: innerW, height: innerH, borderRadius: 40, overflow: 'hidden', position: 'relative', background: '#fff' }}>
        {children}
        {/* 瀏海 */}
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', width: 110, height: 26, borderRadius: 14, background: '#18181b' }} />
      </div>
    </div>
  )
}

/** 桌機瀏覽器外框（內容為 1440×900 截圖 @2x） */
export const BrowserFrame: React.FC<{
  width?: number
  children: React.ReactNode
  style?: React.CSSProperties
}> = ({ width = 1600, children, style }) => {
  const innerH = (width - 4) * (900 / 1440)
  return (
    <div
      style={{
        width,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 30px 70px rgba(0,0,0,0.3)',
        background: '#e4e4e7',
        border: '2px solid #d4d4d8',
        ...style,
      }}
    >
      <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', background: '#f4f4f5' }}>
        {['#f87171', '#fbbf24', '#4ade80'].map(c => (
          <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
        ))}
        <div style={{ marginLeft: 14, flex: 1, maxWidth: 560, height: 28, borderRadius: 14, background: '#e4e4e7', display: 'flex', alignItems: 'center', paddingLeft: 14, fontSize: 15, color: '#71717a', fontFamily: FONT }}>
          教師系統｜設備借用管理
        </div>
      </div>
      <div style={{ width: width - 4, height: innerH, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

/**
 * 多張截圖依時間點交叉淡變（swapAt 為本景幀數時間點）。
 * 圖片以寬 100% 疊放，適用手機殼/瀏覽器框內。
 */
export const ShotSwap: React.FC<{ shots: string[]; swapAt: number[] }> = ({ shots, swapAt }) => {
  const frame = useCurrentFrame()
  return (
    <>
      {shots.map((src, i) => {
        const start = i === 0 ? -1 : swapAt[i - 1]
        const fadeIn = interpolate(frame, [start, start + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const fadeOut = i < shots.length - 1
          ? interpolate(frame, [swapAt[i], swapAt[i] + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          : 1
        const opacity = fadeIn * fadeOut
        return (
          <Img
            key={src}
            src={src}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', opacity }}
          />
        )
      })}
    </>
  )
}

/** 模擬手指點擊漣漪（cx/cy 為容器寬高的比例 0~1，at 為觸發幀） */
export const TapRipple: React.FC<{ cx: number; cy: number; at: number }> = ({ cx, cy, at }) => {
  const frame = useCurrentFrame()
  const t = frame - at
  if (t < 0 || t > 24) return null
  const scale = interpolate(t, [0, 24], [0.4, 2.4])
  const opacity = interpolate(t, [0, 4, 24], [0, 0.85, 0])
  return (
    <div
      style={{
        position: 'absolute',
        left: `${cx * 100}%`,
        top: `${cy * 100}%`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        width: 64,
        height: 64,
        borderRadius: 32,
        border: '5px solid #f59e0b',
        background: 'rgba(245,158,11,0.25)',
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}

/** 聚光燈：框住重點區域，其餘壓暗（座標為容器比例 0~1） */
export const Spotlight: React.FC<{
  x: number; y: number; w: number; h: number
  from: number; to: number
}> = ({ x, y, w, h, from, to }) => {
  const frame = useCurrentFrame()
  const opacity =
    interpolate(frame, [from, from + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
    interpolate(frame, [to - 8, to], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  if (opacity <= 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        borderRadius: 14,
        border: '4px solid #f59e0b',
        boxShadow: '0 0 0 9999px rgba(24,24,27,0.45)',
        opacity,
        pointerEvents: 'none',
      }}
    />
  )
}

/** 底部字幕列 */
export const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [6, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 44,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 1560,
        background: 'rgba(24,24,27,0.86)',
        color: '#fafafa',
        fontSize: 38,
        lineHeight: 1.45,
        padding: '16px 42px',
        borderRadius: 16,
        fontFamily: FONT,
        textAlign: 'center',
        opacity,
      }}
    >
      {text}
    </div>
  )
}

/** 右側說明欄的標題與逐點出現的重點 */
export const SidePoints: React.FC<{
  title: string
  points: { text: string; at: number }[]
  accent?: string
}> = ({ title, points, accent = '#f59e0b' }) => {
  const frame = useCurrentFrame()
  return (
    <div style={{ fontFamily: FONT, width: 640 }}>
      <div style={{ fontSize: 30, color: '#a1a1aa', letterSpacing: 6, marginBottom: 10 }}>設備借用系統</div>
      <div style={{ fontSize: 66, fontWeight: 700, color: '#18181b', marginBottom: 46 }}>{title}</div>
      {points.map((p, i) => {
        const prog = interpolate(frame, [p.at, p.at + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              marginBottom: 30,
              opacity: prog,
              transform: `translateX(${(1 - prog) * 40}px)`,
            }}
          >
            <div
              style={{
                width: 52, height: 52, borderRadius: 26, background: accent,
                color: '#fff', fontSize: 28, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <div style={{ fontSize: 40, color: '#3f3f46' }}>{p.text}</div>
          </div>
        )
      })}
    </div>
  )
}
