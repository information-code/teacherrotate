// 設備借用教學影片的手繪風格元件：紙張、手繪線條抖動、教室、人物、平板車、裝截圖的手機與筆電、
// 會一筆一筆畫出來的圈圈與箭頭、便利貼、字幕。
import React from 'react'
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

export const INK = '#3b322b'
export const C = {
  paper: '#ecdcbd',
  wall: '#f4ead5',
  side: '#e7d4b0',
  floor: '#d7a26d',
  floorLine: '#b98250',
  teal: '#6aa6a0',
  tealDark: '#4c8580',
  orange: '#e9814a',
  mustard: '#ebb84f',
  wood: '#ba824e',
  woodDark: '#8f6038',
  pants: '#4f5d78',
  skin: '#f1c7a0',
  hair: '#6b4a35',
  kidHair: '#3f2f26',
  card: '#fbf6ea',
  sky: '#bcd9e5',
  leaf: '#4f8f86',
  leafLight: '#73ad9f',
  pot: '#df7a45',
  yellowNote: '#f5d98b',
  pinkNote: '#f2bba5',
  mintNote: '#cfe5d6',
}
export const FONT = '"LXGW WenKai TC", "Microsoft JhengHei", serif'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const FULL: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }

// ---------- 畫材 ----------

/** 手繪線條：位移濾鏡讓線條歪歪的，每 5 格換一次種子＝手繪動畫的線條顫動 */
export const SketchDefs: React.FC = () => {
  const frame = useCurrentFrame()
  const seed = 1 + (Math.floor(frame / 5) % 3)
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency={0.032} numOctaves={2} seed={seed} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.6} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}

/** 紙張紋理：大塊的斑駁（像水彩刷過的牆）＋細顆粒，疊在背景上 */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" style={{ ...FULL, mixBlendMode: 'multiply', opacity, pointerEvents: 'none' }}>
    <filter id="grain-blot" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency={0.0042} numOctaves={3} seed={11} />
      <feColorMatrix type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.5  0 0 0 0 0.33  0 0 0 0.75 -0.22" />
    </filter>
    <filter id="grain-fine" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency={0.85} numOctaves={1} seed={5} />
      <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.34  0 0 0 0 0.25  0 0 0 0.5 -0.16" />
    </filter>
    <rect width={1920} height={1080} filter="url(#grain-blot)" />
    <rect width={1920} height={1080} filter="url(#grain-fine)" />
  </svg>
)

/** 場景外框：紙色背景＋淡入 */
export const Stage: React.FC<{ children: React.ReactNode; bg?: string }> = ({ children, bg = C.paper }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 9], [0, 1], CLAMP)
  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: INK }}>
      <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  )
}

/** 依 frame 回傳彈出進度 0→1（彈簧） */
export const usePop = (start: number, damping = 13) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - start, fps, config: { damping, stiffness: 160, mass: 0.7 } })
}

/** 輕微上下浮動 */
export const useBob = (amplitude = 6, speed = 0.08, phase = 0) => {
  const frame = useCurrentFrame()
  return Math.sin(frame * speed + phase) * amplitude
}

// ---------- 會一筆一筆畫出來的線 ----------

/** 沿著路徑畫出來（pathLength=1 的虛線位移） */
export const Draw: React.FC<{
  d: string
  start: number
  dur?: number
  color?: string
  width?: number
  fill?: string
}> = ({ d, start, dur = 18, color = INK, width = 5, fill = 'none' }) => {
  const frame = useCurrentFrame()
  const p = interpolate(frame, [start, start + dur], [0, 1], CLAMP)
  if (p <= 0) return null
  return (
    <path
      d={d}
      pathLength={1}
      strokeDasharray="1 1"
      strokeDashoffset={1 - p}
      fill={fill}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

/** 手畫的圈圈：多繞一點、略微不規則 */
export function scribbleEllipse(cx: number, cy: number, rx: number, ry: number, seed = 1): string {
  const pts: string[] = []
  const n = 72
  for (let i = 0; i <= n; i++) {
    const t = -0.4 + (i / n) * Math.PI * 2 * 1.12
    const wobble = 1 + 0.035 * Math.sin(t * 3 + seed) + 0.02 * Math.cos(t * 5 + seed * 2)
    const grow = 1 + 0.07 * (i / n)
    pts.push(`${(cx + rx * wobble * grow * Math.cos(t)).toFixed(1)},${(cy + ry * wobble * grow * Math.sin(t)).toFixed(1)}`)
  }
  return `M${pts[0]} L${pts.slice(1).join(' ')}`
}

/** 手畫箭頭：一條弧線＋箭頭兩撇（bend 正負決定往哪邊彎） */
export function arrowPaths(x1: number, y1: number, x2: number, y2: number, bend = 0.25) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const cx = mx - dy * bend
  const cy = my + dx * bend
  const angle = Math.atan2(y2 - cy, x2 - cx)
  const head = (a: number) => `${(x2 - 26 * Math.cos(angle + a)).toFixed(1)},${(y2 - 26 * Math.sin(angle + a)).toFixed(1)}`
  return {
    body: `M${x1},${y1} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2},${y2}`,
    head: `M${head(0.5)} L${x2},${y2} L${head(-0.5)}`,
  }
}

/** 全畫面的手繪疊圖層（座標 1920×1080） */
export const Overlay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg viewBox="0 0 1920 1080" style={{ ...FULL, overflow: 'visible', filter: 'url(#rough)', pointerEvents: 'none' }}>
    {children}
  </svg>
)

/** 畫一支箭頭（身體畫完再畫頭） */
export const Arrow: React.FC<{
  from: [number, number]
  to: [number, number]
  start: number
  bend?: number
  color?: string
  width?: number
}> = ({ from, to, start, bend = 0.25, color = INK, width = 5 }) => {
  const a = arrowPaths(from[0], from[1], to[0], to[1], bend)
  return (
    <>
      <Draw d={a.body} start={start} dur={16} color={color} width={width} />
      <Draw d={a.head} start={start + 14} dur={6} color={color} width={width} />
    </>
  )
}

// ---------- 文字 ----------

/** 手寫字：彈出出現 */
export const Hand: React.FC<{
  x: number
  y: number
  start: number
  size?: number
  bold?: boolean
  color?: string
  rotate?: number
  align?: 'left' | 'center'
  children: React.ReactNode
}> = ({ x, y, start, size = 48, bold, color = INK, rotate = 0, align = 'left', children }) => {
  const p = usePop(start)
  if (p <= 0.001) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        fontSize: size,
        fontWeight: bold ? 700 : 400,
        color,
        whiteSpace: 'nowrap',
        lineHeight: 1.25,
        opacity: Math.min(1, p * 1.4),
        transform: `translate(${align === 'center' ? '-50%' : '0'}, 0) rotate(${rotate}deg) scale(${0.85 + 0.15 * p})`,
        transformOrigin: align === 'center' ? 'center' : 'left center',
      }}
    >
      {children}
    </div>
  )
}

/** 字幕：紙條＋歪歪的墨線框，依旁白逐句切換 */
export const Captions: React.FC<{ phrases: string[]; windows: { from: number; frames: number }[] }> = ({ phrases, windows }) => {
  const frame = useCurrentFrame()
  const index = windows.findIndex((w, i) => frame >= w.from && frame < (windows[i + 1]?.from ?? w.from + w.frames + 18))
  if (index < 0) return null
  const w = windows[index]
  const opacity = interpolate(frame, [w.from, w.from + 5], [0, 1], CLAMP)
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 42, display: 'flex', justifyContent: 'center', opacity }}>
      <div style={{ position: 'relative', padding: '14px 36px 16px', maxWidth: 1500 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: C.card,
            border: `3.5px solid ${INK}`,
            borderRadius: 16,
            boxShadow: '6px 7px 0 rgba(59,50,43,0.18)',
            filter: 'url(#rough)',
          }}
        />
        <div style={{ position: 'relative', fontSize: 46, lineHeight: 1.3, color: INK, textAlign: 'center' }}>
          {phrases[index]}
        </div>
      </div>
    </div>
  )
}

// ---------- 教室 ----------

/** 教室：後牆、兩側牆、透視地磚（參考插畫的單點透視房間） */
export const Room: React.FC = () => {
  const back = { l: 300, r: 1620, t: 170, b: 770 }
  const vertical = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map(t => {
    const x1 = back.l + (back.r - back.l) * t
    const x2 = 1920 * t
    return `M${x1},${back.b} L${x2},1080`
  })
  const horizontal = [0.16, 0.38, 0.66].map(f => {
    const y = back.b + (1080 - back.b) * f
    const xl = back.l - back.l * f
    const xr = back.r + (1920 - back.r) * f
    return `M${xl},${y} L${xr},${y}`
  })
  return (
    <svg viewBox="0 0 1920 1080" style={{ ...FULL, filter: 'url(#rough)' }}>
      <g stroke={INK} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round">
        <polygon points={`0,0 ${back.l},${back.t} ${back.l},${back.b} 0,1080`} fill={C.side} />
        <polygon points={`1920,0 ${back.r},${back.t} ${back.r},${back.b} 1920,1080`} fill={C.side} />
        <polygon points={`${back.l},${back.t} ${back.r},${back.t} ${back.r},${back.b} ${back.l},${back.b}`} fill={C.wall} />
        <polygon points={`${back.l},${back.b} ${back.r},${back.b} 1920,1080 0,1080`} fill={C.floor} />
        <path d={[...vertical, ...horizontal].join(' ')} stroke={C.floorLine} strokeWidth={2.5} fill="none" />
      </g>
    </svg>
  )
}

/** 地板帶（沒有整間教室時用）：從 y 往下是地磚 */
export const FloorBand: React.FC<{ y?: number }> = ({ y = 860 }) => {
  const lines = Array.from({ length: 11 }, (_, i) => `M${i * 192 + 40},${y} L${i * 192 - 60},1080`).join(' ')
  return (
    <svg viewBox="0 0 1920 1080" style={{ ...FULL, filter: 'url(#rough)' }}>
      <rect x={-10} y={y} width={1940} height={1080 - y + 10} fill={C.floor} stroke={INK} strokeWidth={3} />
      <path d={`${lines} M-10,${y + 70} L1930,${y + 70}`} stroke={C.floorLine} strokeWidth={2.5} fill="none" />
    </svg>
  )
}

/** 吊燈＋暖光 */
export const Lamp: React.FC<{ x: number; drop?: number }> = ({ x, drop = 110 }) => (
  <svg viewBox="0 0 1920 1080" style={FULL}>
    <defs>
      <radialGradient id={`glow-${x}`}>
        <stop offset="0%" stopColor="#ffd77a" stopOpacity={0.55} />
        <stop offset="100%" stopColor="#ffd77a" stopOpacity={0} />
      </radialGradient>
    </defs>
    <ellipse cx={x} cy={drop + 90} rx={260} ry={190} fill={`url(#glow-${x})`} />
    <g stroke={INK} strokeWidth={3} strokeLinejoin="round" style={{ filter: 'url(#rough)' }}>
      <line x1={x} y1={0} x2={x} y2={drop} />
      <path d={`M${x - 34},${drop} L${x + 34},${drop} L${x + 62},${drop + 46} L${x - 62},${drop + 46} Z`} fill={C.mustard} />
      <ellipse cx={x} cy={drop + 52} rx={14} ry={7} fill="#fff3c4" />
    </g>
  </svg>
)

/** 牆上的窗 */
export const Window: React.FC<{ x: number; y: number; w?: number; h?: number }> = ({ x, y, w = 200, h = 160 }) => (
  <svg viewBox="0 0 1920 1080" style={{ ...FULL, filter: 'url(#rough)' }}>
    <g stroke={INK} strokeWidth={3} strokeLinejoin="round">
      <rect x={x} y={y} width={w} height={h} fill={C.sky} />
      <circle cx={x + w - 42} cy={y + h - 48} r={20} fill={C.mustard} />
      <path d={`M${x + 18},${y + h - 30} q20,-22 42,-6 q14,-16 32,0`} fill="#fff" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} />
      <rect x={x - 10} y={y + h} width={w + 20} height={12} fill={C.wood} />
    </g>
  </svg>
)

/** 盆栽 */
export const Plant: React.FC<{ x: number; y: number; scale?: number }> = ({ x, y, scale = 1 }) => {
  const sway = useBob(1.6, 0.05)
  return (
    <svg viewBox="0 0 1920 1080" style={{ ...FULL, filter: 'url(#rough)' }}>
      <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={INK} strokeWidth={3} strokeLinejoin="round">
        <g transform={`rotate(${sway} 0 -90)`}>
          {[-38, -18, 0, 18, 38].map((a, i) => (
            <g key={a} transform={`rotate(${a} 0 -90)`}>
              <path d="M0,-90 C-22,-150 -10,-230 0,-262 C10,-230 22,-150 0,-90 Z" fill={i % 2 ? C.leafLight : C.leaf} />
              <path d="M0,-96 L0,-240" fill="none" strokeWidth={2} />
            </g>
          ))}
        </g>
        <path d="M-52,-96 L52,-96 L40,0 L-40,0 Z" fill={C.pot} />
        <rect x={-58} y={-110} width={116} height={20} rx={4} fill={C.pot} />
      </g>
    </svg>
  )
}

/** 牆上的小海報（參考插畫的「ship it!」） */
export const Poster: React.FC<{ x: number; y: number; text: string }> = ({ x, y, text }) => (
  <>
    <svg viewBox="0 0 1920 1080" style={{ ...FULL, filter: 'url(#rough)' }}>
      <g stroke={INK} strokeWidth={3} strokeLinejoin="round">
        <rect x={x} y={y} width={140} height={180} fill={C.card} />
        <rect x={x + 38} y={y + 26} width={64} height={84} rx={8} fill={C.teal} />
        <rect x={x + 46} y={y + 34} width={48} height={60} rx={3} fill="#e8f3f1" />
        <path d={`M${x + 56},${y + 64} l10,10 l18,-22`} fill="none" strokeWidth={4} />
      </g>
    </svg>
    <div style={{ position: 'absolute', left: x, top: y + 122, width: 140, textAlign: 'center', fontSize: 26 }}>{text}</div>
  </>
)

// ---------- 人物 ----------

type Pose = 'idle' | 'phone' | 'wave' | 'point' | 'push'

/** 粗手臂：先畫墨色寬線當外框，再畫袖子顏色，最後畫手 */
const Arm: React.FC<{ d: string; hand: [number, number]; sleeve: string }> = ({ d, hand, sleeve }) => (
  <g>
    <path d={d} fill="none" stroke={INK} strokeWidth={25} strokeLinecap="round" strokeLinejoin="round" />
    <path d={d} fill="none" stroke={sleeve} strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={hand[0]} cy={hand[1]} r={11} fill={C.skin} stroke={INK} strokeWidth={3} />
  </g>
)

/**
 * 人物（正面，腳底在 x,y）。kid＝學生（較矮、短髮、背包）。
 * flip 讓動作朝左（推車、指向左邊）。
 */
export const Person: React.FC<{
  x: number
  y: number
  scale?: number
  kid?: boolean
  pose?: Pose
  flip?: boolean
  shirt?: string
}> = ({ x, y, scale = 1, kid = false, pose = 'idle', flip = false, shirt }) => {
  const frame = useCurrentFrame()
  const sleeve = shirt ?? (kid ? C.mustard : C.orange)
  const wave = pose === 'wave' ? Math.sin(frame * 0.28) * 14 : 0
  const legLen = kid ? 110 : 150
  const hip = -legLen
  const shoulder = hip - (kid ? 100 : 118)
  const headY = shoulder - 72
  const leftArm = { d: `M-50,${shoulder + 10} Q-66,${shoulder + 60} -60,${hip - 4}`, hand: [-60, hip - 4] as [number, number] }
  const rightArms: Record<Pose, { d: string; hand: [number, number] }> = {
    idle: { d: `M50,${shoulder + 10} Q66,${shoulder + 60} 60,${hip - 4}`, hand: [60, hip - 4] },
    phone: { d: `M50,${shoulder + 12} Q78,${shoulder + 66} 36,${shoulder + 54}`, hand: [36, shoulder + 54] },
    wave: { d: `M50,${shoulder + 10} Q96,${shoulder - 20} 104,${shoulder - 78}`, hand: [104, shoulder - 78] },
    point: { d: `M50,${shoulder + 12} Q100,${shoulder + 16} 150,${shoulder + 4}`, hand: [150, shoulder + 4] },
    push: { d: `M50,${shoulder + 16} Q92,${shoulder + 40} 132,${shoulder + 44}`, hand: [132, shoulder + 44] },
  }
  const right = rightArms[pose]
  const left = pose === 'push'
    ? { d: `M-40,${shoulder + 18} Q20,${shoulder + 52} 120,${shoulder + 54}`, hand: [120, shoulder + 54] as [number, number] }
    : leftArm
  return (
    <svg viewBox="0 0 1920 1080" style={{ ...FULL, overflow: 'visible', filter: 'url(#rough)' }}>
      <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
        {/* 腿與鞋 */}
        <path d={`M-34,${hip} L-30,-8 L-6,-8 L-4,${hip} Z`} fill={kid ? C.tealDark : C.pants} />
        <path d={`M4,${hip} L6,-8 L30,-8 L34,${hip} Z`} fill={kid ? C.tealDark : C.pants} />
        <path d="M-40,0 Q-44,-18 -20,-20 L-2,-20 L-2,0 Z" fill={INK} />
        <path d="M40,0 Q44,-18 20,-20 L2,-20 L2,0 Z" fill={INK} />
        {/* 背包（學生） */}
        {kid && <rect x={-62} y={shoulder + 18} width={124} height={90} rx={18} fill={C.teal} />}
        {/* 身體 */}
        <path d={`M-58,${hip + 4} Q-64,${shoulder + 46} -50,${shoulder + 4} Q0,${shoulder - 20} 50,${shoulder + 4} Q64,${shoulder + 46} 58,${hip + 4} Z`} fill={sleeve} />
        <path d={`M-15,${shoulder - 8} L0,${shoulder + 12} L15,${shoulder - 8}`} fill="none" />
        {kid && <path d={`M-34,${shoulder + 2} L-28,${hip + 4} M34,${shoulder + 2} L28,${hip + 4}`} fill="none" stroke={C.tealDark} strokeWidth={6} />}
        {/* 手臂（左手在後、右手在前） */}
        <Arm d={left.d} hand={left.hand} sleeve={sleeve} />
        <g transform={pose === 'wave' ? `rotate(${wave} 50 ${shoulder + 10})` : undefined}>
          <Arm d={right.d} hand={right.hand} sleeve={sleeve} />
        </g>
        {pose === 'phone' && (
          <g>
            <rect x={14} y={shoulder + 12} width={36} height={58} rx={7} fill={INK} />
            <rect x={19} y={shoulder + 18} width={26} height={44} rx={3} fill="#bfe3ea" stroke="none" />
          </g>
        )}
        {/* 頭 */}
        <rect x={-12} y={shoulder - 24} width={24} height={22} fill={C.skin} />
        <circle cx={0} cy={headY} r={kid ? 44 : 48} fill={C.skin} />
        {kid ? (
          <path d={`M-45,${headY - 2} Q-50,${headY - 54} 0,${headY - 52} Q48,${headY - 54} 45,${headY - 2} Q36,${headY - 26} 10,${headY - 24} Q-4,${headY - 34} -18,${headY - 22} Q-36,${headY - 24} -45,${headY - 2} Z`} fill={C.kidHair} />
        ) : (
          <path d={`M-49,${headY - 4} Q-52,${headY - 56} -6,${headY - 56} Q44,${headY - 58} 50,${headY - 6} Q40,${headY - 30} 14,${headY - 30} Q-14,${headY - 36} -30,${headY - 16} Q-40,${headY - 8} -49,${headY - 4} Z`} fill={C.hair} />
        )}
        <circle cx={-16} cy={headY + 4} r={4.5} fill={INK} stroke="none" />
        <circle cx={16} cy={headY + 4} r={4.5} fill={INK} stroke="none" />
        <path d={`M-12,${headY + 22} Q0,${headY + 32} 12,${headY + 22}`} fill="none" />
        <circle cx={-30} cy={headY + 18} r={7} fill="#e9967a" stroke="none" opacity={0.45} />
        <circle cx={30} cy={headY + 18} r={7} fill="#e9967a" stroke="none" opacity={0.45} />
      </g>
    </svg>
  )
}

// ---------- 道具 ----------

/** 平板充電車（腳底在 x,y）；wheel＝輪子轉角 */
export const Cart: React.FC<{ x: number; y: number; scale?: number; wheel?: number; label?: string }> = ({ x, y, scale = 1, wheel = 0, label = 'A' }) => (
  <svg viewBox="0 0 1920 1080" style={{ ...FULL, overflow: 'visible', filter: 'url(#rough)' }}>
    <g transform={`translate(${x} ${y}) scale(${scale})`} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
      <path d="M-128,-212 L-128,-252 L128,-252 L128,-212" fill="none" strokeWidth={7} />
      <rect x={-118} y={-216} width={236} height={182} rx={14} fill={C.teal} />
      <line x1={0} y1={-206} x2={0} y2={-44} />
      {[-180, -150, -120, -90, -64].map(yy => (
        <path key={yy} d={`M-100,${yy} L-18,${yy} M18,${yy} L100,${yy}`} stroke={C.tealDark} strokeWidth={3} />
      ))}
      <circle cx={-10} cy={-126} r={5} fill={INK} />
      <circle cx={10} cy={-126} r={5} fill={INK} />
      <rect x={-34} y={-246} width={68} height={30} rx={4} fill={C.card} strokeWidth={2.5} />
      {[-82, 82].map(cx => (
        <g key={cx} transform={`translate(${cx} -18) rotate(${wheel})`}>
          <circle r={17} fill={INK} />
          <line x1={-11} y1={0} x2={11} y2={0} stroke="#d8c9a7" strokeWidth={3} />
          <line x1={0} y1={-11} x2={0} y2={11} stroke="#d8c9a7" strokeWidth={3} />
        </g>
      ))}
    </g>
    <text x={x} y={y - 223 * scale} textAnchor="middle" fontSize={22 * scale} fontFamily={FONT} fill={INK}>{label}</text>
  </svg>
)

/** 牆上插座＋電源線（progress 0→1 畫出電線） */
export const Outlet: React.FC<{ x: number; y: number; from: [number, number]; start: number }> = ({ x, y, from, start }) => (
  <Overlay>
    <rect x={x - 26} y={y - 34} width={52} height={68} rx={8} fill={C.card} stroke={INK} strokeWidth={3.5} />
    <path d={`M${x - 9},${y - 12} l0,14 M${x + 9},${y - 12} l0,14`} stroke={INK} strokeWidth={4} />
    <Draw d={`M${from[0]},${from[1]} C${from[0] + 90},${from[1] + 120} ${x - 120},${y + 90} ${x},${y + 4}`} start={start} dur={22} width={5} />
  </Overlay>
)

/** 閃電（充電中） */
export const Bolt: React.FC<{ x: number; y: number; start: number }> = ({ x, y, start }) => {
  const p = usePop(start)
  if (p <= 0.001) return null
  return (
    <Overlay>
      <g transform={`translate(${x} ${y}) scale(${p})`}>
        <path d="M6,-40 L-18,6 L0,6 L-8,42 L22,-8 L4,-8 Z" fill={C.mustard} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      </g>
    </Overlay>
  )
}

/** 拍照閃光＋「喀嚓」 */
export const Flash: React.FC<{ x: number; y: number; start: number }> = ({ x, y, start }) => {
  const frame = useCurrentFrame()
  const t = frame - start
  if (t < 0 || t > 30) return null
  const p = interpolate(t, [0, 6], [0.4, 1], CLAMP)
  const fade = interpolate(t, [16, 30], [1, 0], CLAMP)
  return (
    <>
      <Overlay>
        <g transform={`translate(${x} ${y}) scale(${p})`} opacity={fade} stroke={INK} strokeWidth={5} strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
            <line key={a} x1={0} y1={-34} x2={0} y2={-62} transform={`rotate(${a})`} />
          ))}
          <circle r={18} fill="#fff7d6" />
        </g>
      </Overlay>
      <div style={{ position: 'absolute', left: x + 50, top: y - 96, fontSize: 40, fontWeight: 700, opacity: fade, transform: `scale(${p})` }}>喀嚓！</div>
    </>
  )
}

// ---------- 裝截圖的手機與筆電 ----------

const PHONE_SHOT = { w: 780, h: 1688 }
const LAPTOP_SHOT = { w: 2400, h: 1520 }

/**
 * 手繪手機，螢幕是真實系統截圖（390×844 @2x）。
 * overlay 的座標＝截圖原始像素（780×1688），用來在畫面上圈重點。
 */
export const PhoneShot: React.FC<{
  src: string
  x: number
  y: number
  height: number
  start?: number
  rotate?: number
  next?: { src: string; at: number }
  overlay?: React.ReactNode
}> = ({ src, x, y, height, start = 0, rotate = -3, next, overlay }) => {
  const frame = useCurrentFrame()
  const p = usePop(start, 15)
  const bezel = 16
  const innerH = height - bezel * 2
  const innerW = innerH * (PHONE_SHOT.w / PHONE_SHOT.h)
  const swap = next ? interpolate(frame, [next.at, next.at + 8], [0, 1], CLAMP) : 0
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: innerW + bezel * 2,
        height,
        opacity: Math.min(1, p * 1.5),
        transform: `rotate(${rotate}deg) translateY(${(1 - p) * 40}px)`,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transform: 'translate(16px, 20px)', borderRadius: 58, background: 'rgba(59,50,43,0.17)', filter: 'url(#rough)' }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: 58, background: INK, filter: 'url(#rough)' }} />
      <div style={{ position: 'absolute', left: bezel, top: bezel, width: innerW, height: innerH, borderRadius: 40, overflow: 'hidden', background: '#fff' }}>
        <Img src={src} style={{ width: innerW, height: innerH, display: 'block' }} />
        {next && swap > 0 && <Img src={next.src} style={{ position: 'absolute', inset: 0, width: innerW, height: innerH, opacity: swap }} />}
        {overlay && (
          <svg viewBox={`0 0 ${PHONE_SHOT.w} ${PHONE_SHOT.h}`} style={{ ...FULL, filter: 'url(#rough)' }}>
            {overlay}
          </svg>
        )}
      </div>
    </div>
  )
}

/**
 * 手繪筆電，螢幕是真實系統截圖（1200×760 @2x）；overlay 座標＝截圖原始像素（2400×1520）。
 * view＝只顯示截圖的一塊（左上角與寬度，原始像素），用來放大內容；高度依螢幕比例。
 */
export const LaptopShot: React.FC<{
  src: string
  x: number
  y: number
  width: number
  start?: number
  rotate?: number
  view?: { x: number; y: number; w: number }
  overlay?: React.ReactNode
}> = ({ src, x, y, width, start = 0, rotate = -1.2, view = { x: 0, y: 0, w: LAPTOP_SHOT.w }, overlay }) => {
  const p = usePop(start, 15)
  const bezel = 18
  const innerW = width - bezel * 2
  const innerH = innerW * (LAPTOP_SHOT.h / LAPTOP_SHOT.w)
  const outerH = innerH + bezel * 2
  const zoom = innerW / view.w
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height: outerH + 46,
        opacity: Math.min(1, p * 1.5),
        transform: `rotate(${rotate}deg) translateY(${(1 - p) * 40}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width, height: outerH, transform: 'translate(16px, 20px)', borderRadius: 26, background: 'rgba(59,50,43,0.17)', filter: 'url(#rough)' }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width, height: outerH, borderRadius: 26, background: INK, filter: 'url(#rough)' }} />
      <div style={{ position: 'absolute', left: bezel, top: bezel, width: innerW, height: innerH, borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
        <Img
          src={src}
          style={{ position: 'absolute', left: -view.x * zoom, top: -view.y * zoom, width: LAPTOP_SHOT.w * zoom, height: LAPTOP_SHOT.h * zoom, maxWidth: 'none', display: 'block' }}
        />
        {overlay && (
          <svg viewBox={`${view.x} ${view.y} ${view.w} ${innerH / zoom}`} style={{ ...FULL, filter: 'url(#rough)' }}>
            {overlay}
          </svg>
        )}
      </div>
      <svg viewBox={`0 0 ${width} 50`} style={{ position: 'absolute', left: 0, top: outerH - 4, width, height: 50, overflow: 'visible', filter: 'url(#rough)' }}>
        <path d={`M-40,4 L${width + 40},4 L${width + 70},40 L-70,40 Z`} fill="#d9ceb7" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d={`M${width / 2 - 70},4 L${width / 2 + 70},4 L${width / 2 + 60},14 L${width / 2 - 60},14 Z`} fill="#c8bca3" stroke={INK} strokeWidth={2.5} />
      </svg>
    </div>
  )
}

// ---------- 便利貼與小圖示 ----------

/** 便利貼（上方貼一段膠帶） */
export const Note: React.FC<{
  x: number
  y: number
  w: number
  h: number
  color: string
  start: number
  rotate?: number
  pad?: string
  children: React.ReactNode
}> = ({ x, y, w, h, color, start, rotate = 0, pad = '34px 36px', children }) => {
  const p = usePop(start)
  if (p <= 0.001) return null
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotate(${rotate}deg) scale(${0.8 + 0.2 * p})`, opacity: Math.min(1, p * 1.5) }}>
      <div style={{ position: 'absolute', inset: 0, background: color, border: `3.5px solid ${INK}`, borderRadius: 6, boxShadow: '8px 10px 0 rgba(59,50,43,0.16)', filter: 'url(#rough)' }} />
      <div style={{ position: 'absolute', left: '50%', top: -18, width: 120, height: 36, transform: 'translateX(-50%) rotate(-3deg)', background: 'rgba(250,244,226,0.82)', border: '2px solid rgba(59,50,43,0.35)', filter: 'url(#rough)' }} />
      <div style={{ position: 'relative', padding: pad, height: '100%', boxSizing: 'border-box' }}>{children}</div>
    </div>
  )
}

/** 小圖示（時鐘、警告、鎖、平板、筆電、攝影機），size 為邊長 */
export const Icon: React.FC<{ name: 'clock' | 'alert' | 'lock' | 'tablet' | 'laptop' | 'camera'; size?: number; color?: string }> = ({ name, size = 64, color }) => (
  <svg viewBox="0 0 64 64" width={size} height={size} style={{ overflow: 'visible', filter: 'url(#rough)' }}>
    <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
      {name === 'clock' && (<><circle cx={32} cy={32} r={26} fill={color ?? C.card} /><path d="M32,16 L32,33 L44,40" fill="none" /></>)}
      {name === 'alert' && (<><path d="M32,6 L60,56 L4,56 Z" fill={color ?? C.orange} /><path d="M32,24 L32,40" strokeWidth={5} /><circle cx={32} cy={48} r={2.5} fill={INK} /></>)}
      {name === 'lock' && (<><rect x={12} y={28} width={40} height={30} rx={6} fill={color ?? C.mustard} /><path d="M20,28 L20,20 A12,12 0 0 1 44,20 L44,28" fill="none" /></>)}
      {name === 'tablet' && (<><rect x={10} y={4} width={44} height={56} rx={7} fill={color ?? C.teal} /><rect x={16} y={10} width={32} height={40} rx={2} fill="#e8f3f1" /><circle cx={32} cy={55} r={2} fill={INK} /></>)}
      {name === 'laptop' && (<><rect x={10} y={12} width={44} height={30} rx={4} fill={color ?? '#9fb4c2'} /><rect x={15} y={17} width={34} height={20} fill="#eef3f6" /><path d="M2,46 L62,46 L56,54 L8,54 Z" fill="#d9ceb7" /></>)}
      {name === 'camera' && (<><rect x={6} y={18} width={52} height={36} rx={7} fill={color ?? C.orange} /><path d="M20,18 L24,10 L40,10 L44,18" fill={C.card} /><circle cx={32} cy={36} r={11} fill="#e8f3f1" /><circle cx={32} cy={36} r={5} fill={INK} /></>)}
    </g>
  </svg>
)

/** 手畫勾選框（checkAt 之後畫出勾） */
export const CheckBox: React.FC<{ x: number; y: number; start: number; checkAt: number; size?: number }> = ({ x, y, start, checkAt, size = 56 }) => {
  const p = usePop(start)
  if (p <= 0.001) return null
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} style={{ position: 'absolute', left: x, top: y, overflow: 'visible', opacity: Math.min(1, p * 1.5), filter: 'url(#rough)' }}>
      <rect x={4} y={4} width={56} height={56} rx={8} fill={C.card} stroke={INK} strokeWidth={4} />
      <Draw d="M14,34 L28,48 L58,6" start={checkAt} dur={10} color="#2f8f5b" width={7} />
    </svg>
  )
}
