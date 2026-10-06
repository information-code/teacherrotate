// 設備借用教學影片的七個場景。畫面動作依旁白時間窗（phraseWindows）同步。
import React from 'react'
import { Easing, interpolate, useCurrentFrame } from 'remotion'
import { phraseWindows, type SceneId } from './timing'
import {
  Arrow,
  Bolt,
  C,
  Cart,
  CheckBox,
  Draw,
  Flash,
  FloorBand,
  Grain,
  Hand,
  INK,
  Icon,
  Lamp,
  LaptopShot,
  Note,
  Outlet,
  Overlay,
  Person,
  PhoneShot,
  Plant,
  Poster,
  Room,
  Stage,
  Window,
  scribbleEllipse,
  useBob,
  usePop,
} from './doodle'
import shotBoardRaw from './assets/shots/board.png'
import shotReserveRaw from './assets/shots/reserve.png'
import shotMyLoansRaw from './assets/shots/myloans.png'
import shotBorrowRaw from './assets/shots/borrow.png'
import shotGivebackRaw from './assets/shots/giveback.png'

// Next.js 把 *.png 宣告成 StaticImageData；Remotion 的 webpack 實際給的是網址字串
const asSrc = (m: unknown): string => m as string
const shotBoard = asSrc(shotBoardRaw)
const shotReserve = asSrc(shotReserveRaw)
const shotMyLoans = asSrc(shotMyLoansRaw)
const shotBorrow = asSrc(shotBorrowRaw)
const shotGiveback = asSrc(shotGivebackRaw)

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
/** 圈重點的顏色 */
const MARK = C.orange

/** 畫面上的文字（集中在這裡，字型預先載入時一併涵蓋） */
export const L = {
  title: '設備借用',
  subtitle: '使用說明',
  poster: '準時歸還！',
  steps: ['預約', '借用', '歸還'],
  boardTab: '借用情況',
  boardWho: '誰、借了哪幾節',
  boardGap: '空檔 → 可以預約',
  reserveTitle: '預約三步驟',
  reserveSteps: ['選日期、節次', '選設備', '按「確定」→「預約借用」'],
  borrowSteps: ['① 拍照', '② 確認檢查項目', '③ 勾選同意'],
  borrowKid: '派學生去拿？',
  borrowKid2: '車送到教室，再拍照',
  returnSteps: ['① 辦理歸還', '② 拍照', '③ 完成歸還'],
  returnKid: '先拍照，再交給學生',
  returnKid2: '推回原位、接上電源',
  spot: '原位',
  tip1: '預約了卻沒借用',
  tip1b: '累積',
  tip1c: '次',
  tip1d: '暫停預約',
  tip2: '逾期沒歸還',
  tip2b: '不能再預約',
  tip2c: '歸還後就恢復',
  outro: '有問題找資訊組',
  outro2: '教師系統 › 設備借用',
}
export const LABEL_TEXT = `${JSON.stringify(L)}喀嚓！A`

// ---------- 共用小元件 ----------

/** 牆上掛的木頭招牌 */
const Sign: React.FC<{ x: number; y: number; w: number; h: number; start: number; title: string; sub?: string; size?: number }> = ({
  x, y, w, h, start, title, sub, size = 88,
}) => {
  const p = usePop(start, 11)
  if (p <= 0.001) return null
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * -50}px) rotate(-1deg)` }}>
      <svg viewBox={`0 0 ${w} 60`} style={{ position: 'absolute', left: 0, top: -56, width: w, height: 60, overflow: 'visible' }}>
        <g filter="url(#rough)">
          <path d={`M${w * 0.14},58 L${w / 2},8 L${w * 0.86},58`} fill="none" stroke={INK} strokeWidth={3} />
          <circle cx={w / 2} cy={8} r={6} fill={INK} />
        </g>
      </svg>
      <div style={{ position: 'absolute', inset: 0, background: C.wood, border: `4px solid ${INK}`, borderRadius: 14, boxShadow: '8px 10px 0 rgba(59,50,43,0.18)', filter: 'url(#rough)' }} />
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fdf3df' }}>
        <div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        {sub && <div style={{ fontSize: 34, marginTop: 6, color: '#f7e3bd' }}>{sub}</div>}
      </div>
    </div>
  )
}

/** 漂浮的小圖示（彈出後輕輕上下飄） */
const Floating: React.FC<{ x: number; y: number; start: number; phase: number; children: React.ReactNode }> = ({ x, y, start, phase, children }) => {
  const p = usePop(start)
  const bob = useBob(8, 0.07, phase)
  if (p <= 0.001) return null
  return <div style={{ position: 'absolute', left: x, top: y + bob, transform: `scale(${p}) rotate(${Math.sin(phase) * 8}deg)` }}>{children}</div>
}

/** 一行一行彈出的步驟（[文字, 出現的幀]） */
const Steps: React.FC<{ x: number; y: number; items: [string, number][]; size?: number; gap?: number }> = ({ x, y, items, size = 48, gap = 78 }) => (
  <>
    {items.map(([text, start], i) => (
      <Hand key={text} x={x} y={y + i * gap} start={start} size={size}>{text}</Hand>
    ))}
  </>
)

/** 彈出的一行（便利貼裡用） */
const PopLine: React.FC<{ start: number; children: React.ReactNode }> = ({ start, children }) => {
  const p = usePop(start)
  return <div style={{ opacity: Math.min(1, Math.max(0, p * 1.5)), transform: `translateX(${(1 - p) * 30}px)` }}>{children}</div>
}

/** 畫正字記號（三次） */
const Tally: React.FC<{ start: number }> = ({ start }) => (
  <svg viewBox="0 0 120 70" width={120} height={70} style={{ overflow: 'visible' }}>
    <g filter="url(#rough)">
      {[18, 48, 78].map((x, i) => (
        <Draw key={x} d={`M${x},6 L${x + 4},64`} start={start + i * 10} dur={8} width={7} />
      ))}
    </g>
  </svg>
)

/** 書桌（從 y 往下） */
const Desk: React.FC<{ y: number }> = ({ y }) => (
  <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
    <g filter="url(#rough)">
      <rect x={-10} y={y} width={1940} height={1090 - y} fill={C.wood} stroke={INK} strokeWidth={3.5} />
      <path d={`M-10,${y + 20} L1930,${y + 20}`} stroke={C.woodDark} strokeWidth={3} />
      <path d={`M120,${y + 70} q200,-12 420,4 M760,${y + 120} q240,10 520,-6 M1320,${y + 64} q180,-10 420,6`} stroke={C.woodDark} strokeWidth={2.5} fill="none" opacity={0.6} />
    </g>
  </svg>
)

/** 教室門（學生從這裡進出） */
const Door: React.FC = () => (
  <Overlay>
    <rect x={1700} y={330} width={170} height={490} fill={C.wood} stroke={INK} strokeWidth={3.5} />
    <rect x={1730} y={370} width={110} height={90} fill={C.sky} stroke={INK} strokeWidth={3} />
    <circle cx={1722} cy={590} r={8} fill={C.mustard} stroke={INK} strokeWidth={3} />
  </Overlay>
)

/** 地面與人物腳底的高度：字幕條在 y≈948 以下，腳要在它上面 */
const FLOOR_Y = 820
const FEET_Y = 925

/** 原位：虛線框標出車子要停的地方，車推進來就蓋住它 */
const Spot: React.FC<{ x: number; start: number }> = ({ x, start }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [start, start + 8], [0, 1], CLAMP)
  if (opacity <= 0) return null
  return (
    <>
      <Overlay>
        <rect x={x - 130} y={FEET_Y - 264} width={260} height={270} rx={16} fill="rgba(255,250,235,0.5)" stroke={INK} strokeWidth={4} strokeDasharray="16 12" opacity={opacity} />
      </Overlay>
      <Hand x={x} y={FEET_Y - 165} start={start} size={46} bold align="center">{L.spot}</Hand>
    </>
  )
}

// ---------- 開場：三步驟 ----------

const Intro: React.FC = () => {
  const [p0, p1] = phraseWindows('intro')
  return (
    <Stage>
      <Room />
      <Grain />
      <Lamp x={960} />
      <Window x={360} y={250} />
      <Poster x={1410} y={250} text={L.poster} />
      <Sign x={690} y={205} w={540} h={150} start={4} title={L.title} sub={L.subtitle} />
      <Floating x={590} y={300} start={p0.from + 2} phase={0}><Icon name="tablet" size={92} /></Floating>
      <Floating x={1262} y={262} start={p0.from + 34} phase={1.6}><Icon name="laptop" size={100} /></Floating>
      <Floating x={1276} y={392} start={p0.from + 60} phase={3.1}><Icon name="camera" size={92} /></Floating>
      {L.steps.map((step, i) => (
        <Note key={step} x={690 + i * 195} y={455} w={150} h={122} color={[C.yellowNote, C.mintNote, C.pinkNote][i]} start={p1.from + 40 + i * 24} rotate={[-3, 2, -2][i]} pad="16px 0 0">
          <div style={{ textAlign: 'center', fontSize: 30, lineHeight: 1 }}>{['①', '②', '③'][i]}</div>
          <div style={{ textAlign: 'center', fontSize: 46, fontWeight: 700, marginTop: 6 }}>{step}</div>
        </Note>
      ))}
      <Hand x={846} y={486} start={p1.from + 64} size={44}>→</Hand>
      <Hand x={1041} y={486} start={p1.from + 88} size={44}>→</Hand>
      <Person x={470} y={935} pose="phone" />
      <Cart x={1470} y={940} />
      <Plant x={1760} y={1050} scale={0.95} />
    </Stage>
  )
}

// ---------- 借用情況：看誰借了什麼 ----------

const BoardScene: React.FC = () => {
  const frame = useCurrentFrame()
  const [p0, p1, p2] = phraseWindows('board')
  return (
    <Stage>
      <Grain />
      <Person x={1640} y={965} pose="point" flip />
      <Desk y={820} />
      {/* 截圖右側是空白，只取左邊 1830px 放大；圈圈座標仍是截圖原始像素，箭頭是畫面座標 */}
      <LaptopShot
        src={shotBoard}
        x={110}
        y={96}
        width={1200}
        rotate={0}
        start={2}
        view={{ x: 0, y: 0, w: 1830 }}
        overlay={
          <>
            {frame < p2.from && <Draw d={scribbleEllipse(1092, 590, 560, 96, 2)} start={p1.from + 10} dur={22} color={MARK} width={12} />}
            <Draw d={scribbleEllipse(1178, 574, 118, 64, 5)} start={p2.from + 22} dur={16} color={MARK} width={12} />
          </>
        }
      />
      <Hand x={330} y={14} start={p0.from + 30} size={52} bold>{L.boardTab}</Hand>
      <Overlay><Arrow from={[320, 52]} to={[214, 192]} start={p0.from + 36} bend={0.3} /></Overlay>
      {frame < p2.from && (
        <>
          <Hand x={1350} y={300} start={p1.from + 26} size={48}>{L.boardWho}</Hand>
          <Overlay><Arrow from={[1338, 334]} to={[1192, 466]} start={p1.from + 32} bend={0.2} /></Overlay>
        </>
      )}
      <Hand x={1350} y={440} start={p2.from + 30} size={48}>{L.boardGap}</Hand>
      {/* 往上拱，避開張志成那條 */}
      <Overlay><Arrow from={[1338, 472]} to={[925, 445]} start={p2.from + 36} bend={0.2} /></Overlay>
    </Stage>
  )
}

// ---------- 預約 ----------

const ReserveScene: React.FC = () => {
  const [p0, p1] = phraseWindows('reserve')
  const rows: [string, number, number][] = [
    [L.reserveSteps[0], p0.from + 40, p0.from + 86],
    [L.reserveSteps[1], p0.from + 90, p0.from + 128],
    [L.reserveSteps[2], p1.from + 2, p1.from + 60],
  ]
  return (
    <Stage>
      <Grain />
      <PhoneShot
        src={shotReserve}
        x={300}
        y={70}
        height={900}
        start={2}
        overlay={<Draw d={scribbleEllipse(390, 1094, 330, 66, 3)} start={p1.from + 34} dur={18} color={MARK} width={9} />}
      />
      <Hand x={900} y={140} start={p0.from} size={66} bold>{L.reserveTitle}</Hand>
      <Overlay><Draw d="M900,236 q70,-16 140,0 t140,0 t120,0" start={p0.from + 10} dur={16} /></Overlay>
      {rows.map(([text, start, checkAt], i) => (
        <React.Fragment key={text}>
          <CheckBox x={900} y={300 + i * 130} start={start} checkAt={checkAt} />
          <Hand x={980} y={296 + i * 130} start={start} size={52}>{text}</Hand>
        </React.Fragment>
      ))}
      <Overlay><Arrow from={[890, 612]} to={[694, 640]} start={p1.from + 26} bend={0.2} /></Overlay>
      <Person x={1650} y={1010} scale={0.85} pose="phone" />
    </Stage>
  )
}

// ---------- 開始借用（含派學生代取） ----------

const BorrowScene: React.FC = () => {
  const frame = useCurrentFrame()
  const [p0, p1, p2] = phraseWindows('borrow')
  // 前兩句：車在老師旁邊；第三句：車先退場，再由學生從門口推進來
  const exitX = interpolate(frame, [p2.from, p2.from + 12], [1430, 2150], CLAMP)
  const enterX = interpolate(frame, [p2.from + 16, p2.from + 80], [2150, 1440], { ...CLAMP, easing: Easing.out(Easing.cubic) })
  const studentIn = frame >= p2.from + 14
  const cartX = studentIn ? enterX : exitX
  return (
    <Stage>
      <Grain />
      <FloorBand y={FLOOR_Y} />
      <Door />
      <PhoneShot
        src={shotMyLoans}
        next={{ src: shotBorrow, at: p1.from }}
        x={230}
        y={50}
        height={930}
        start={2}
        overlay={
          <>
            {frame < p1.from && <Draw d={scribbleEllipse(241, 538, 168, 60, 1)} start={p0.from + 52} dur={18} color={MARK} width={9} />}
            {frame >= p1.from && frame < p2.from && <Draw d={scribbleEllipse(146, 1061, 116, 104, 4)} start={p1.from + 14} dur={16} color={MARK} width={9} />}
            {frame >= p2.from && <Draw d={scribbleEllipse(340, 631, 318, 34, 6)} start={p2.from + 26} dur={18} color={MARK} width={8} />}
          </>
        }
      />
      <Steps x={760} y={300} items={[[L.borrowSteps[0], p1.from + 2], [L.borrowSteps[1], p1.from + 28], [L.borrowSteps[2], p1.from + 74]]} />
      <Person x={1180} y={FEET_Y} pose="phone" />
      <Cart x={cartX} y={FEET_Y} wheel={cartX * 1.4} />
      {studentIn && <Person x={cartX + 245} y={FEET_Y} kid pose="push" flip />}
      <Flash x={1224} y={FEET_Y - 247} start={p1.from + 6} />
      <Flash x={1224} y={FEET_Y - 247} start={p2.from + 108} />
      <Hand x={1290} y={130} start={p2.from + 4} size={58} bold>{L.borrowKid}</Hand>
      <Hand x={1290} y={214} start={p2.from + 84} size={46}>{L.borrowKid2}</Hand>
    </Stage>
  )
}

// ---------- 歸還（含派學生代還） ----------

const GivebackScene: React.FC = () => {
  const frame = useCurrentFrame()
  const [p0, p1, p2] = phraseWindows('giveback')
  const studentX = interpolate(frame, [p2.from + 8, p2.from + 72], [1235, 1460], { ...CLAMP, easing: Easing.inOut(Easing.cubic) })
  const cartX = studentX + 235
  const pushing = frame >= p2.from + 4
  return (
    <Stage>
      <Grain />
      <FloorBand y={FLOOR_Y} />
      <Outlet x={1880} y={FEET_Y - 213} from={[1812, FEET_Y - 95]} start={p2.from + 78} />
      <Spot x={1695} start={p2.from + 12} />
      <PhoneShot
        src={shotGiveback}
        x={230}
        y={50}
        height={930}
        start={2}
        overlay={
          <>
            {frame < p1.from && <Draw d={scribbleEllipse(146, 1101, 116, 104, 2)} start={p0.from + 52} dur={16} color={MARK} width={9} />}
            {frame >= p1.from && <Draw d={scribbleEllipse(390, 760, 352, 56, 7)} start={p1.from + 12} dur={20} color={MARK} width={8} />}
          </>
        }
      />
      <Steps x={760} y={300} items={[[L.returnSteps[0], p0.from + 2], [L.returnSteps[1], p0.from + 50], [L.returnSteps[2], p0.from + 86]]} />
      <Person x={1010} y={FEET_Y} pose="phone" />
      <Cart x={cartX} y={FEET_Y} wheel={cartX * 1.4} />
      <Person x={studentX} y={FEET_Y} kid pose={pushing ? 'push' : 'idle'} />
      <Flash x={1054} y={FEET_Y - 247} start={p0.from + 56} />
      <Flash x={1054} y={FEET_Y - 247} start={p1.from + 30} />
      <Bolt x={1880} y={FEET_Y - 295} start={p2.from + 98} />
      <Hand x={1180} y={130} start={p1.from + 4} size={56} bold>{L.returnKid}</Hand>
      <Hand x={1180} y={212} start={p2.from + 6} size={46}>{L.returnKid2}</Hand>
    </Stage>
  )
}

// ---------- 小提醒 ----------

const TipsScene: React.FC = () => {
  const [p0, p1] = phraseWindows('tips')
  return (
    <Stage>
      <Grain />
      <Note x={170} y={200} w={770} h={450} color={C.yellowNote} start={p0.from + 2} rotate={-2} pad="46px 50px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Icon name="clock" size={90} />
          <span style={{ fontSize: 64, fontWeight: 700 }}>{L.tip1}</span>
        </div>
        <div style={{ marginTop: 52, fontSize: 60, display: 'flex', alignItems: 'center', gap: 14 }}>
          {L.tip1b}
          <Tally start={p0.from + 72} />
          {L.tip1c}
        </div>
        <PopLine start={p0.from + 108}>
          <div style={{ marginTop: 36, fontSize: 60, display: 'flex', alignItems: 'center', gap: 16 }}>
            → <Icon name="lock" size={70} /> <b>{L.tip1d}</b>
          </div>
        </PopLine>
      </Note>
      <Note x={1000} y={230} w={740} h={430} color={C.pinkNote} start={p1.from} rotate={2} pad="46px 50px">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Icon name="alert" size={90} />
          <span style={{ fontSize: 64, fontWeight: 700 }}>{L.tip2}</span>
        </div>
        <PopLine start={p1.from + 52}>
          <div style={{ marginTop: 52, fontSize: 60, display: 'flex', alignItems: 'center', gap: 16 }}>
            → <Icon name="lock" size={70} /> <b>{L.tip2b}</b>
          </div>
        </PopLine>
        <PopLine start={p1.from + 86}>
          <div style={{ marginTop: 32, fontSize: 46, color: '#6b5a4c' }}>{L.tip2c}</div>
        </PopLine>
      </Note>
      <Person x={1830} y={1040} scale={0.8} pose="point" flip />
    </Stage>
  )
}

// ---------- 結尾 ----------

const Outro: React.FC = () => {
  const [p0] = phraseWindows('outro')
  return (
    <Stage>
      <Room />
      <Grain />
      <Lamp x={960} />
      <Window x={360} y={250} />
      <Poster x={1410} y={250} text={L.poster} />
      <Sign x={600} y={215} w={720} h={150} start={4} title={L.outro} size={76} />
      <Hand x={960} y={392} start={p0.from + 20} size={50} align="center">{L.outro2}</Hand>
      <Person x={740} y={940} pose="wave" />
      <Person x={1000} y={940} kid pose="wave" />
      <Cart x={1320} y={945} />
      <Plant x={1760} y={1050} scale={0.95} />
    </Stage>
  )
}

export const SCENES: Record<SceneId, React.FC> = {
  intro: Intro,
  board: BoardScene,
  reserve: ReserveScene,
  borrow: BorrowScene,
  giveback: GivebackScene,
  tips: TipsScene,
  outro: Outro,
}
