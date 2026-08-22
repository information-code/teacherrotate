'use client'

import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import {
  WEIGHT_LEVELS, WEIGHT_LEVEL_LABEL, defaultScheduleWeights, doubleModeOf, DOUBLE_MODE_LABEL, BANDS, BAND_LABEL, DAY_MODES, DAY_MODE_LABEL,
  ROOM_USES, ROOM_USE_LABEL, roomUseOf, type RoomUse,
  type ScheduleConfig, type ScheduleWeights, type BuiltinRules, type WeightLevel,
  type RuleTemplate, type TemplateRule, type DoubleMode, type DaySpread, type DayMode,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL, orderSubjectNames } from '@/lib/allocation'
import type { GradeSubject } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  gradeSubjects: Record<number, GradeSubject[]>
}

const SMART = '智慧探究家：科技創新任務'
const shortName = (s: string) => s === SMART ? '智慧探究' : s

/** 四段權重選鈕（關/低/中/高）。硬性要求一律列為固定硬限制，不提供「必須」。 */
function LevelPicker({ value, onChange, size = 'md' }: { value: WeightLevel; onChange: (l: WeightLevel) => void; size?: 'md' | 'sm' }) {
  return (
    <div className="flex rounded-sm border border-zinc-200 overflow-hidden flex-shrink-0">
      {WEIGHT_LEVELS.map(l => (
        <button key={l} onClick={() => onChange(l)}
          className={`${size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'} ${value === l
            ? l === 'off' ? 'bg-zinc-400 text-white' : 'bg-zinc-700 text-white'
            : 'bg-white text-zinc-500 hover:bg-zinc-50'}`}>
          {WEIGHT_LEVEL_LABEL[l]}
        </button>
      ))}
    </div>
  )
}

/** 下拉多選（顯示摘要，點開勾選）——取代 chip 牆。 */
function MultiSelect<T extends string | number>({ options, labels, selected, onChange, allLabel, width = 'w-44' }: {
  options: T[]; labels?: (v: T) => string; selected: T[]; onChange: (next: T[]) => void; allLabel: string; width?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])
  const lab = (v: T) => labels ? labels(v) : String(v)
  const summary = selected.length === 0 ? allLabel : selected.length <= 3 ? selected.map(lab).join('、') : `${selected.slice(0, 2).map(lab).join('、')}…等 ${selected.length} 項`
  return (
    <div ref={ref} className={`relative ${width}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`input py-0.5 text-xs w-full text-left truncate flex items-center justify-between gap-1 ${selected.length === 0 ? 'text-zinc-400' : ''}`}>
        <span className="truncate">{summary}</span><span className="text-zinc-400 flex-shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 bg-white border border-zinc-200 rounded-sm shadow-lg p-2 min-w-full w-56 max-h-64 overflow-y-auto">
          <button type="button" onClick={() => onChange([])} className="text-[11px] text-zinc-500 hover:text-zinc-800 mb-1">{allLabel}（清除）</button>
          <div className="grid grid-cols-2 gap-x-2">
            {options.map(o => (
              <label key={String(o)} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o)}
                  onChange={() => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])} />
                <span className="truncate">{lab(o)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 規則表：依作用對象分組；有參數／子規則者，權重非關閉時內嵌顯示 ──
type ParamKey = 'dailyMax' | 'consecMax' | 'homeroomDailyMax' | 'homeroomMorning' | 'lowLoadConcentrate' | 'teacherEveryDay' | 'teacherSpread' | 'shortBreakCross'
type MasterKey = 'avoidPeriods' | 'timePrefer' | 'subjectApart' | 'teacherApart'
type SpreadKey = 'hourlyBalance'
type SpecialKey = 'lonelyDay' | 'homeroomRun' | 'homeroomDailyMin' | 'homeroomMorningMax'   // 有自己的附屬控制項
type SimpleKey = Exclude<keyof BuiltinRules, ParamKey | MasterKey | SpreadKey | SpecialKey>
type RuleKey = SimpleKey | ParamKey | MasterKey | SpreadKey | SpecialKey
interface RuleRow { key: RuleKey; name: string; def: string; desc: string; hasN?: boolean; spread?: boolean; nHint?: string; master?: RuleTemplate; link?: { href: string; label: string } }
// 規則依「為誰而設」分組——每一條權重都是因為某個人的處境才存在，依作用對象分組比依技術面向直覺。
// 鐘點教師在引擎裡沒有專屬規則（受的是與科任、行政完全相同的那一組），故三者合併為一組。
const GROUPS: { title: string; note: string; rows: RuleRow[] }[] = [
  { title: '導師', note: '為導師而設：留白落在哪裡、每天要上幾節、會不會被切碎', rows: [
    { key: 'homeroomMorning', name: '上午導師課下限', def: '高', hasN: true, nHint: '每天上午至少 N 節導師課', desc: '保障導師每天上午（1~4 節）有 N 節自己的課可排國數。刻意是「下限」不是「越多越好」——單調版本會把科任課全擠到下午、讓上午 4 格全成導師課而撞上「導師連上上限」' },
    { key: 'homeroomDailyMax', name: '導師每日節數上限', def: '高', hasN: true, nHint: '每班每日留白 ≤ N 格', desc: '導師單日最多上 N 節（預設 4、高）。例外：低年級整天日（週二）可到右側設定的節數（預設 5）；導師個人不排課／進修合計達設定格數（預設 7）者上限 +1。另有「絕對上限」（預設 5、必須級）：不論例外都不得超過——人工課表四期整天 ≥6 節只有 3 班日' },
    { key: 'homeroomMorningMax', name: '上午導師課上限', def: '高', desc: '課務組原則：沒有鎖課的老師上午最多 3 節導師課（可以連 3）；導師自己的鎖課（種子班國數）在上午就超過 3 的，以鎖課數為準。人工課表 5 節日以 3+2／2+3 為主、4+1 偶有。視藝單雙週導師週多出的兩節不算（單雙週結構逼的，與鎖課同理）。勾「必須級」＝超過就卡成功條件並點名' },
    { key: 'homeroomDailyMin', name: '導師每日下限', def: '高', desc: '半天日至少 1 節、整天日至少 2 節導師課（權重高）。勾「必須級」＝導師整天 0 節才卡成功條件（人工課表四期 0 例外）；整天只有 1 節只扣分（人工四期有 4 班日、課務組手調 v18 有 5 班日，都是被鎖課／不排課／共同不排課扣到只剩 3 格的班日）。單雙週取較少的一週' },
    { key: 'homeroomRun', name: '導師連上上限', def: '高', desc: '班級同日連續留白不要超過 N 格（引擎用科任課／鎖課切開），導師不會整個上午連上、中間沒有一節可喘息／改作業。單雙週格兩種週型分開算（導師週的視藝格也是導師課，避免半天連四、整天連七）。原為硬限制；人工課表 5% 班日導師連四、課務組手調也踩了 4 筆 → 權重' },
    { key: 'biweeklyHalfDay', name: '單雙週區塊避開半天日', def: '高', desc: '單雙週（視藝）的兩節區塊盡量不要排在半天日：半天只有 4 節、其中兩節常是種子班鎖課（國語／數學），區塊放進另外兩節，輪到導師的那一週整個半天就是導師連上四節。114-2 人工課表四／六年級 21 組只有 2 組在半天日' },
    { key: 'specialDoublesHalf', name: '同半天兩組專科連堂', def: '高', desc: '同一班同一個半天不要同時有兩組需要專科教室的連堂（自然＋科技、科技＋視藝…）：那個半天導師只剩 0～1 格，每日下限／上午下限直接被擠爆，而專科教室磚位 100% 用滿後又搬不動。人工課表每期只有 1～3 班日' },
    { key: 'classCohesion', name: '科任課同日成塊', def: '中', desc: '同班同日（上、下午各自計）科任課與鎖課盡量連成一塊，導師課不被切碎。人工課表 9% 半天被切開、引擎 4%——引擎已比人工好，中即可' },
  ] },
  { title: '科任・行政', note: '為授課老師本人而設：一週課表的鬆緊、空堂與移動', rows: [
    { key: 'dailyMax', name: '每日節數上限', def: '高', hasN: true, nHint: '一天最多 N 節', desc: '114-2 人工課表實測最大值恰為 6、0 筆超標' },
    { key: 'consecMax', name: '連續授課上限', def: '中', hasN: true, nHint: '連上 N 節後應有空堂', desc: '另有固定硬限制「永不連 7」。人工課表 16% 人日超過 4 連、課務組手調主動做出 6 連——「連上」不如「不空堂」要緊；預設 N=6、中' },
    { key: 'walkCost', name: '走動成本', def: '低', desc: '相鄰兩堂課跨教室，距離越遠扣越多（距離只當同分時的加分）；中間有空堂或跨午休減半。人工課表 79% 相鄰兩堂換場地、課務組手調完全不在意 → 預設低', link: { href: '/admin/schedule-config?tab=room', label: '樓層與相鄰關係在「4 教室設定」' } },
    { key: 'roomManagerFirst', name: '教室固定', def: '高', desc: '沒有管理教室的老師（如借用者）盡量整週固定在同一間專科教室，本週每多用一間扣一次。管理教師「一定在自己管理的教室」是固定硬限制（見下方），不歸這條管', link: { href: '/admin/schedule-config?tab=room', label: '管理教師在「4 教室設定」' } },
    { key: 'roomHalfDay', name: '專科教室老師集中', def: '中', desc: '一間專科教室一週從週一第 1 節看到週五第 7 節，老師「交接」越少越好——一位老師連續幾天用完再換下一位（甲＝週一二、乙＝週三四五），實驗器材不用每天收。多餘的交接（超過「老師數 − 1」的部分）每次扣 1；同一天走了又回來另扣 1（自然是硬限制）；真的得交接時寧可在上午／下午之間，2／3 節之間交接扣 ½', link: { href: '/admin/schedule-config?tab=room', label: '教室與管理教師在「4 教室設定」' } },
    { key: 'bandAdjacent', name: '全單節老師相鄰同年級', def: '低', desc: '課全是一節一節的老師（音樂、英語、體育…），相鄰兩堂盡量同一個年級。人工課表 13% 跨年級、課務組手調也不在意 → 預設低；真正要擋的是下一條「夾單節」' },
    { key: 'gradeSandwich', name: '同半天年級夾單節', def: '高', desc: '同一位老師上午（1-4）或下午（5-7）內三節連續、年級 X→Y→X 且中間只夾一節別的年級（2→1→2）。2→1→1→2（去別的年級上一整塊再回來）、隔空堂、跨午休都不算。人工課表 0 筆、課務組手調 1 筆、引擎原本 11 筆' },
    { key: 'zoneSandwich', name: '同半天跨區來回', def: '高', desc: '課務組：千萬不要讓老師來回跨區。同一口徑看教室設定的「區」（幾棟合成一區）：甲區→乙區→甲區 且乙區只一節（用實際分配到的教室，沒進專科教室＝原班）。同一區內各棟之間跑班不算（A 棟↔B 棟同一區）。棟沒填「區」時自成一區。走動成本罰的是距離，這條罰的是「跑去又跑回來」', link: { href: '/admin/schedule-config?tab=room', label: '區在「4 教室設定」每一棟的第三欄' } },
    { key: 'teacherSpread', name: '科任每週平均', def: '高', hasN: true, nHint: '最重日 − 最輕日 ≤ N', desc: '課務組原則「正式／代理科任的課務要盡量平均、鐘點要集中」：總節數超過「少節數老師集中」門檻的非導師、非鐘點老師，各日課量盡量平均，最重日減最輕日超過 N 才罰（整天被個人不排課蓋住的日子不計）。人工課表 20 節老師多半是 4/4/4/4/4' },
    { key: 'shortBreakCross', name: '小下課跨區', def: '高', hasN: true, nHint: '大下課在第 N 節後', desc: '相鄰兩節在不同區、中間只有十分鐘小下課（1→2、3→4、5→6、6→7）＝一筆；大下課（第 N 節後，預設第 2 節後的 20 分鐘）、午休、隔空堂不罰——一定得跨區的老師，跨在有時間走的地方。人工課表 75 次跨區有 73% 在大下課／午休／隔空堂；v21 引擎近半在小下課', link: { href: '/admin/schedule-config?tab=room', label: '區在「4 教室設定」' } },
    { key: 'teacherEveryDay', name: '科任每天至少一節', def: '高', hasN: true, nHint: '一週 ≥ N 節的老師', desc: '課務組原則「科任不能有一天完全沒課（不含鐘點）」：一週 ≥ N 節的非導師老師，每個上課日至少 1 節；那天她教的班可排格全在她的個人不排課裡（吳秉純週三）不算。行政兼課（< N 節）由「少節數老師集中」管' },
    { key: 'teacherApart', name: '老師同日不混科目', def: '高', desc: '子規則列的幾科，同一位老師同一天只上其中一種——例如英語老師週一都國際教育、週二都英語，不穿插。114-2 人工課表 30 人日混排 2（7%），故為權重。可加多組', master: 'teacherApart' },
    { key: 'batchType', name: '同型態同日', def: '高', desc: '同一天盡量不混排連堂與單節（連堂日／單節日分開）。人工課表 14/235 組混排，且兼教連堂科目與單節科目的老師結構上無法避免，故為權重' },
    { key: 'compact', name: '減少零碎空堂', def: '高', desc: '課間空堂越少越好（「上空上空」交錯已是固定硬限制）。課務組手調 97 堂的主旋律：人工課表 77% 人日零空堂，引擎原本只有 51%' },
    { key: 'lonelyDay', name: '孤堂日', def: '高', desc: '非導師老師某天只上 1 節＝來一趟只為一節課（導師整天在自己班，不算；總共只有 1 節的人不計）。人工課表 6% 人日、引擎 11%、課務組手調後 4%。節數極少又有不排課的人、或 20 節老師的週三半天，可能真的湊不出來，所以是權重不是硬限制' },
    { key: 'lowLoadConcentrate', name: '少節數老師集中', def: '高', hasN: true, nHint: '總節數 ≤ N 的老師', desc: '行政兼課、輔導團等節數少的老師壓到最少天（3 節→1 天、5～8 節→2 天）。人工課表 ≤6 節老師平均到校 2.1 天、引擎 2.7 天。鐘點另由「鐘點每週分布」管' },
  ] },
  { title: '鐘點', note: '鐘點老師多半希望少跑幾趟學校。上面「科任・行政」那組的規則同樣作用在鐘點身上，這裡只放身分專屬的', rows: [
    { key: 'hourlyBalance', name: '鐘點每週分布', def: '高', spread: true, desc: '課務組原則「鐘點不要超過 3 天」→ 預設「集中 3 天內」、高。若某位鐘點老師只有固定幾天能到校，請改用「個人不排課時段」（硬限制）更可靠' },
  ] },
  { title: '其他', note: '不專屬於誰、對學生的學習節奏與全校都好的安排', rows: [
    { key: 'subjectApart', name: '科目互斥同日', def: '中', desc: '列出的幾科（如體育與健康、自然與社會）同班盡量不同一天出現。可加多組，各組可再調權重；勾「必須」則升為硬限制（絕不同日）——國際教育／英語在人工課表是 0／106 零例外，屬鐵律，預設已勾', master: 'subjectApart' },
    { key: 'avoidPeriods', name: '科目避開節次', def: '中', desc: '指定科目避開某些節次（如體育避午餐前後、考科避第 7 節）。可加多組，各組可再調權重；母開關關閉＝全部不計', master: 'avoidPeriods' },
    { key: 'timePrefer', name: '科目時段偏好', def: '關閉', desc: '指定科目偏好上午或下午。可加多組；母開關關閉＝全部不計', master: 'timePrefer' },
  ] },
]
const isParam = (k: RuleKey): k is ParamKey => k === 'dailyMax' || k === 'consecMax' || k === 'homeroomDailyMax' || k === 'homeroomMorning' || k === 'lowLoadConcentrate' || k === 'teacherEveryDay' || k === 'teacherSpread' || k === 'shortBreakCross'
const isSpread = (k: RuleKey): k is SpreadKey => k === 'hourlyBalance'

const MODE_CYCLE: DoubleMode[] = ['auto', 'double', 'single']
const MODE_CLS: Record<DoubleMode, string> = {
  auto: 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400',
  double: 'bg-zinc-800 text-white border-zinc-800',
  single: 'bg-white text-zinc-800 border-zinc-500',
  biweekly: 'bg-violet-100 text-violet-800 border-violet-300',
}
const MODE_SHORT: Record<DoubleMode, string> = { auto: '·', double: '連', single: '單', biweekly: '雙' }

/** 分頁九：權重設定。規則表（分組、參數內嵌）＋科目連堂矩陣＋固定硬限制（摺疊）。 */
export default function WeightTab({ config, setConfig, gradeSubjects }: Props) {
  const w = config.weights
  const [hardOpen, setHardOpen] = useState(false)
  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))
  // 連堂矩陣列：各年級有開的科目（perClass>0）；灰格＝該年級沒開這科。
  // 註：配課設定的 homeroom 旗標只表示「導師可配」，不代表科任不會教（本校全部科目皆勾），故不以此灰掉
  const matrixSubjects = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).filter(s => s.perClass > 0).map(s => s.name)))))
  const offered = (subj: string, g: number) => (gradeSubjects[g] ?? []).some(s => s.name === subj && s.perClass > 0)
  const perClassOf = (subj: string, g: number) => (gradeSubjects[g] ?? []).find(s => s.name === subj)?.perClass ?? 0

  // 有綁定科目的專科教室 → 這些科目才需要設定使用時機
  const roomSubjects = Array.from(new Set(config.roomZones.flatMap(z => z.rooms.filter(r => r.kind === 'subject' && r.subject).map(r => r.subject))))
  function setWeights(fn: (w: ScheduleWeights) => ScheduleWeights) { setConfig(c => ({ ...c, weights: fn(c.weights) })) }
  function setBuiltin(patch: Partial<BuiltinRules>) { setWeights(x => ({ ...x, builtin: { ...x.builtin, ...patch } })) }
  const levelOf = (key: RuleKey): WeightLevel =>
    isParam(key) || isSpread(key) || key === 'lonelyDay' || key === 'homeroomDailyMin' || key === 'homeroomMorningMax' ? (w.builtin[key] as { level: WeightLevel }).level : w.builtin[key] as WeightLevel
  const setLevel = (key: RuleKey, l: WeightLevel) => {
    if (isParam(key) || isSpread(key) || key === 'lonelyDay' || key === 'homeroomDailyMin' || key === 'homeroomMorningMax') setBuiltin({ [key]: { ...(w.builtin[key] as object), level: l } } as Partial<BuiltinRules>)
    else setBuiltin({ [key]: l } as Partial<BuiltinRules>)
  }
  const spreadOf = (key: SpreadKey) => w.builtin[key]
  const setSpread = (key: SpreadKey, patch: Partial<DaySpread>) =>
    setBuiltin({ [key]: { ...w.builtin[key], ...patch } } as Partial<BuiltinRules>)
  function updateTemplate(id: string, patch: Partial<TemplateRule>) {
    setWeights(x => ({ ...x, templates: x.templates.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }
  function addTemplate(template: RuleTemplate) {
    const master = w.builtin[template]
    const t: TemplateRule = {
      id: crypto.randomUUID(), template, subjects: [], grades: [], level: master === 'off' ? 'mid' : master,
      ...(template === 'avoidPeriods' ? { periods: [] } : {}),
      ...(template === 'timePrefer' ? { pref: 'morning' as const } : {}),   // subjectApart／teacherApart：只用 subjects/grades
    }
    setWeights(x => ({ ...x, templates: [...x.templates, t] }))
  }
  function removeTemplate(t: TemplateRule) {
    setWeights(x => ({ ...x, templates: x.templates.filter(p => p.id !== t.id) }))
  }
  function setMode(subj: string, g: number, mode: DoubleMode) {
    setWeights(x => {
      const dm = { ...x.doubleMode, [subj]: { ...(x.doubleMode[subj] ?? {}) } }
      if (mode === 'auto') delete dm[subj][String(g)]; else dm[subj][String(g)] = mode
      if (Object.keys(dm[subj]).length === 0) delete dm[subj]
      return { ...x, doubleMode: dm }
    })
  }
  function cycleMode(subj: string, g: number) {
    const cur = doubleModeOf(w, subj, g)
    // 視藝：都可以 → 連堂 → 不連堂 → 單雙週；其他：都可以 → 連堂 → 不連堂
    const cycle = subj === '視覺藝術' ? [...MODE_CYCLE, 'biweekly' as DoubleMode] : MODE_CYCLE
    setMode(subj, g, cycle[(cycle.indexOf(cur) + 1) % cycle.length])
  }
  function setRow(subj: string, mode: DoubleMode) { for (const g of GRADES) if (offered(subj, g)) setMode(subj, g, mode) }
  function resetAll() {
    if (!confirm('將所有權重、規則與連堂矩陣恢復為預設值？')) return
    setWeights(() => defaultScheduleWeights())
  }

  const subRows = (template: RuleTemplate) => w.templates.filter(t => t.template === template)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-zinc-400">
          引擎只排科任課，所有規則都作用在「科任課的落點」。權重四段：關閉／低／中／高，「高」一項約抵「低」九項；
          排課時硬限制與權重一次跑，成功條件＝未排 0；排不完時精靈會建議降低哪些權重。
        </p>
        <span className="flex gap-2 flex-shrink-0">
          <button onClick={resetAll} className="btn btn-secondary text-xs py-0.5">恢復預設</button>
          <Link href="/admin/schedule-wizard" className="btn btn-primary text-xs py-0.5">▶ 前往排課精靈</Link>
        </span>
      </div>

      {/* 一、規則表 */}
      {GROUPS.map(gp => (
        <div key={gp.title} className="card p-0 overflow-hidden">
          <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-zinc-700">{gp.title}</span>
            <span className="text-xs text-zinc-400">{gp.note}</span>
          </div>
          {gp.rows.map(r => {
            const lvl = levelOf(r.key)
            const on = lvl !== 'off'
            const isDefault = WEIGHT_LEVEL_LABEL[lvl] === r.def
            return (
              <div key={r.key} className="px-4 py-2.5 border-b border-zinc-100 last:border-0">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-800">{r.name}
                      <span className={`ml-2 text-[11px] ${isDefault ? 'text-zinc-400' : 'text-amber-600'}`}>預設 {r.def}{!isDefault && '（已調整）'}</span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">{r.desc}
                      {r.link && <Link href={r.link.href} className="ml-1 text-sky-700 hover:underline">{r.link.label} →</Link>}
                    </div>
                  </div>
                  {r.hasN && on && (
                    <label className="flex items-center gap-1 text-xs text-zinc-500 flex-shrink-0 self-center">
                      <span className="hidden sm:inline">{r.nHint}</span> N=
                      <input type="number" min={1} max={7} value={w.builtin[r.key as ParamKey].n}
                        onChange={e => setBuiltin({ [r.key]: { ...w.builtin[r.key as ParamKey], n: Number(e.target.value) } } as Partial<BuiltinRules>)}
                        className="input w-14 text-center py-0.5 text-xs" />
                    </label>
                  )}
                  {r.key === 'homeroomDailyMax' && on && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 flex-shrink-0 self-center flex-wrap justify-end">
                      <label className="flex items-center gap-1" title="低年級只有週二整天，每班科任 7～8 堂擺不滿；課務組接受週二 5 節">低年級整天日
                        <input type="number" min={1} max={7} value={w.builtin.homeroomDailyMax.fullDayLowN}
                          onChange={e => setBuiltin({ homeroomDailyMax: { ...w.builtin.homeroomDailyMax, fullDayLowN: Math.min(7, Math.max(1, Number(e.target.value) || 5)) } })}
                          className="input w-12 text-center py-0.5 text-xs" />節
                      </label>
                      <label className="flex items-center gap-1" title="不論低年級整天日或不排課例外，導師一天絕不超過此數（必須級）。人工課表四期整天 ≥6 節只有 3 班日">絕對上限
                        <input type="number" min={1} max={7} value={w.builtin.homeroomDailyMax.hardN}
                          onChange={e => setBuiltin({ homeroomDailyMax: { ...w.builtin.homeroomDailyMax, hardN: Math.min(7, Math.max(1, Number(e.target.value) || 5)) } })}
                          className="input w-12 text-center py-0.5 text-xs" />節（必須級）
                      </label>
                      <label className="flex items-center gap-1" title="導師個人不排課／進修合計達此格數者，其餘日子必然多上，上限放寬一節">不排課≥
                        <input type="number" min={1} max={35} value={w.builtin.homeroomDailyMax.offBonusFrom}
                          onChange={e => setBuiltin({ homeroomDailyMax: { ...w.builtin.homeroomDailyMax, offBonusFrom: Math.min(35, Math.max(1, Number(e.target.value) || 7)) } })}
                          className="input w-12 text-center py-0.5 text-xs" />格者 +1
                      </label>
                    </div>
                  )}
                  {r.key === 'homeroomMorningMax' && on && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 flex-shrink-0 self-center flex-wrap justify-end">
                      <label className="flex items-center gap-1">上午最多
                        <input type="number" min={1} max={4} value={w.builtin.homeroomMorningMax.n}
                          onChange={e => setBuiltin({ homeroomMorningMax: { ...w.builtin.homeroomMorningMax, n: Math.min(4, Math.max(1, Number(e.target.value) || 3)) } })}
                          className="input w-12 text-center py-0.5 text-xs" />節
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title="勾了＝超過算必須級；不勾＝只扣權重分">
                        <input type="checkbox" checked={w.builtin.homeroomMorningMax.must} onChange={e => setBuiltin({ homeroomMorningMax: { ...w.builtin.homeroomMorningMax, must: e.target.checked } })} />必須級
                      </label>
                    </div>
                  )}
                  {r.key === 'homeroomDailyMin' && on && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 flex-shrink-0 self-center flex-wrap justify-end">
                      <label className="flex items-center gap-1">整天≥
                        <input type="number" min={0} max={7} value={w.builtin.homeroomDailyMin.full}
                          onChange={e => setBuiltin({ homeroomDailyMin: { ...w.builtin.homeroomDailyMin, full: Math.min(7, Math.max(0, Number(e.target.value) || 0)) } })}
                          className="input w-12 text-center py-0.5 text-xs" />節
                      </label>
                      <label className="flex items-center gap-1">半天≥
                        <input type="number" min={0} max={4} value={w.builtin.homeroomDailyMin.half}
                          onChange={e => setBuiltin({ homeroomDailyMin: { ...w.builtin.homeroomDailyMin, half: Math.min(4, Math.max(0, Number(e.target.value) || 0)) } })}
                          className="input w-12 text-center py-0.5 text-xs" />節
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title="勾了＝不足算必須級：結果照樣跑得出來，但成功條件會卡住並點名；不勾＝只扣權重分">
                        <input type="checkbox" checked={w.builtin.homeroomDailyMin.must} onChange={e => setBuiltin({ homeroomDailyMin: { ...w.builtin.homeroomDailyMin, must: e.target.checked } })} />必須級
                      </label>
                    </div>
                  )}
                  {r.key === 'lonelyDay' && on && (
                    <div className="flex items-center gap-3 text-xs text-zinc-500 flex-shrink-0 self-center flex-wrap justify-end">
                      <label className="flex items-center gap-1">半天只 1 節
                        <LevelPicker size="sm" value={w.builtin.lonelyDay.halfLevel} onChange={l => setBuiltin({ lonelyDay: { ...w.builtin.lonelyDay, halfLevel: l } })} />
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer" title="鐘點／代理是專程跑一趟的人：勾了之後他們的孤堂日算必須級——結果照樣跑得出來，但成功條件會卡住並點名是誰">
                        <input type="checkbox" checked={w.builtin.lonelyDay.partTimeMust} onChange={e => setBuiltin({ lonelyDay: { ...w.builtin.lonelyDay, partTimeMust: e.target.checked } })} />
                        鐘點／代理＝必須級
                      </label>
                    </div>
                  )}
                  {r.key === 'homeroomRun' && on && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 flex-shrink-0 self-center flex-wrap justify-end">
                      <label className="flex items-center gap-1">N=
                        <input type="number" min={2} max={6} value={w.hardParams.maxRunHomeroom}
                          onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, maxRunHomeroom: Math.min(6, Math.max(2, Number(e.target.value) || 3)) } }))}
                          className="input w-14 text-center py-0.5 text-xs" />
                      </label>
                      {BANDS.map(b => (
                        <label key={b} className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={w.hardParams.homeroomRunBands.includes(b)}
                            onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams,
                              homeroomRunBands: e.target.checked ? BANDS.filter(k => k === b || x.hardParams.homeroomRunBands.includes(k)) : x.hardParams.homeroomRunBands.filter(k => k !== b) } }))} />
                          <span>{BAND_LABEL[b]}</span>
                        </label>
                      ))}
                      {w.hardParams.homeroomRunBands.length === 0 && <span className="text-amber-600">未選年段＝停用</span>}
                    </div>
                  )}
                  {isSpread(r.key) && on && (() => {
                    const sp = spreadOf(r.key)
                    return (
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 flex-shrink-0 self-center">
                        <span className="inline-flex border border-zinc-200 rounded-full overflow-hidden text-[11px]">
                          {DAY_MODES.map(m => (
                            <button key={m} onClick={() => setSpread(r.key as SpreadKey, { mode: m })}
                              className={`px-2 py-0.5 ${sp.mode === m ? 'bg-zinc-200 text-zinc-800 font-medium' : 'bg-white text-zinc-400 hover:text-zinc-600'}`}>
                              {DAY_MODE_LABEL[m]}
                            </button>
                          ))}
                        </span>
                        {sp.mode === 'concentrate' && (
                          <label className="flex items-center gap-1">壓在
                            <input type="number" min={1} max={5} value={sp.days}
                              onChange={e => setSpread(r.key as SpreadKey, { days: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })}
                              className="input w-12 text-center py-0.5 text-xs" />天內
                          </label>
                        )}
                        {sp.mode === 'concentrate' && (
                          <label className="flex items-center gap-1 cursor-pointer" title="勾了＝超過天數算必須級：結果照樣跑得出來，但成功條件會卡住並點名是誰；不勾＝只扣權重分（高＝9 分／天，引擎可能拿去換別處的分數）">
                            <input type="checkbox" checked={sp.must} onChange={e => setSpread(r.key as SpreadKey, { must: e.target.checked })} />超過＝必須級
                          </label>
                        )}
                      </div>
                    )
                  })()}
                  <div className="self-center"><LevelPicker value={lvl} onChange={l => setLevel(r.key, l)} /></div>
                </div>

                {/* 子規則（母開關非關閉時才顯示） */}
                {r.master && on && (
                  <div className="mt-2 ml-3 pl-3 border-l-2 border-zinc-200 space-y-1.5">
                    {subRows(r.master).length === 0 && <p className="text-xs text-zinc-400">尚無子規則。</p>}
                    {subRows(r.master).map(t => (
                      <div key={t.id} className="flex items-center gap-2 flex-wrap text-xs">
                        <MultiSelect options={subjectOptions} labels={shortName} selected={t.subjects} onChange={v => updateTemplate(t.id, { subjects: v })} allLabel="選科目…" width="w-44" />
                        <MultiSelect options={GRADES as unknown as number[]} labels={g => GRADE_LABEL[g]} selected={t.grades} onChange={v => updateTemplate(t.id, { grades: v.sort((a, b) => a - b) })} allLabel="全年級" width="w-28" />
                        {t.template === 'avoidPeriods' && <>
                          <MultiSelect options={[1, 2, 3, 4, 5, 6, 7]} labels={p => `第 ${p} 節`} selected={t.periods ?? []} onChange={v => updateTemplate(t.id, { periods: v.sort((a, b) => a - b) })} allLabel="選節次…" width="w-32" />
                          <label className="flex items-center gap-1 text-zinc-500 whitespace-nowrap">
                            <input type="checkbox" checked={Boolean(t.fullDayOnly)} onChange={e => updateTemplate(t.id, { fullDayOnly: e.target.checked || undefined })} /> 整天日限定
                          </label>
                        </>}
                        {t.template === 'timePrefer' && (
                          <select value={t.pref ?? 'morning'} onChange={e => updateTemplate(t.id, { pref: e.target.value as 'morning' | 'afternoon' })} className="input py-0.5 text-xs w-24">
                            <option value="morning">偏好上午</option><option value="afternoon">偏好下午</option>
                          </select>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          {t.template === 'subjectApart' && (
                            <label className="flex items-center gap-1 text-[11px] text-zinc-600 cursor-pointer" title="勾選＝硬限制：這幾科同班絕不同日（如國際教育／英語，114-2 人工課表 0／106 零例外）。不勾＝依右側權重盡量避免">
                              <input type="checkbox" checked={t.hard === true} onChange={e => updateTemplate(t.id, { hard: e.target.checked ? true : undefined })} />
                              必須
                            </label>
                          )}
                          {!(t.template === 'subjectApart' && t.hard)
                            ? <LevelPicker size="sm" value={t.level} onChange={l => updateTemplate(t.id, { level: l })} />
                            : <span className="text-[11px] px-1.5 py-0.5 rounded-sm bg-red-50 text-red-700 border border-red-200">硬限制</span>}
                          <button onClick={() => removeTemplate(t)} className="text-red-400 hover:text-red-600" title="刪除這組">✕</button>
                        </span>
                        {t.template === 'subjectApart' || t.template === 'teacherApart'
                          ? t.subjects.length < 2 && <span className="w-full text-[11px] text-amber-600">至少要選兩科</span>
                          : t.subjects.length === 0 && <span className="w-full text-[11px] text-amber-600">未選科目＝此組不作用</span>}
                      </div>
                    ))}
                    <button onClick={() => addTemplate(r.master!)} className="text-xs text-sky-700 hover:underline">＋ 新增一組</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {/* 二、科目連堂矩陣（結構設定） */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200 flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-700">科目連堂</span>
          <span className="text-xs text-zinc-400">結構設定、非權重——連堂綁定會直接影響排不排得進去。點格子循環切換；列尾一次設整列。</span>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.auto}`}>·</span>都可以（預設：單節排，同科同日相鄰兩節可自然成對）
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.double}`}>連</span>連堂（每 2 節綁一組）
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.single}`}>單</span>不連堂（單節、同科不同日）
            <span className={`px-1.5 py-0.5 rounded-sm border ${MODE_CLS.biweekly}`}>雙</span>單雙週（視藝）
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base no-hover">
            <thead>
              <tr>
                <th className="min-w-[9rem]">科目</th>
                {GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}
                <th className="text-center text-xs font-normal text-zinc-400">整列</th>
              </tr>
            </thead>
            <tbody>
              {matrixSubjects.map(subj => {
                return (
                  <tr key={subj}>
                    <td className="font-medium text-zinc-800">{shortName(subj)}</td>
                    {GRADES.map(g => {
                      const ok = offered(subj, g)
                      const mode = doubleModeOf(w, subj, g)
                      const pc = perClassOf(subj, g)
                      return (
                        <td key={g} className="text-center">
                          {ok
                            ? <button onClick={() => cycleMode(subj, g)} title={`${GRADE_LABEL[g]}${shortName(subj)} 每班 ${pc} 節：${DOUBLE_MODE_LABEL[mode]}（點擊切換）`}
                                className={`w-9 h-7 rounded-sm border text-xs font-medium ${MODE_CLS[mode]}`}>{MODE_SHORT[mode]}</button>
                            : <span className="text-zinc-300">—</span>}
                        </td>
                      )
                    })}
                    <td className="text-center">
                      <select value="" onChange={e => { if (e.target.value) setRow(subj, e.target.value as DoubleMode) }} className="input py-0.5 text-[11px] w-20">
                        <option value="">設整列…</option>
                        <option value="auto">都可以</option><option value="double">連堂</option><option value="single">不連堂</option>
                        {subj === '視覺藝術' && <option value="biweekly">單雙週</option>}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-zinc-400">
          「連堂」不跨午休（固定硬限制）；「都可以」的自然成對同樣不跨午休、且視為一組連堂計入「同型態同日」。單雙週僅視藝：占固定兩格、單週組／雙週組輪替、另一格由導師填課。
        </p>
      </div>

      {/* 二之二、專科教室使用時機矩陣（結構設定，科目 × 年級） */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2 border-b border-zinc-100">
          <span className="text-sm font-semibold text-zinc-700">專科教室使用時機</span>
          <span className="text-xs text-zinc-400 ml-2">哪些課要進專科教室。點格子循環切換：一律使用／只有連堂／不使用</span>
        </div>
        {roomSubjects.length === 0
          ? <p className="px-4 py-3 text-xs text-zinc-400">「4 教室設定」裡還沒有綁定科目的專科教室。</p>
          : <div className="overflow-x-auto">
              <table className="table-base no-hover">
                <thead><tr><th className="min-w-[7rem]">科目</th>{GRADES.map(g => <th key={g} className="text-center w-20">{GRADE_LABEL[g]}</th>)}</tr></thead>
                <tbody>
                  {roomSubjects.map(subj => (
                    <tr key={subj}>
                      <td className="font-medium whitespace-nowrap">{shortName(subj)}</td>
                      {GRADES.map(g => {
                        const u = roomUseOf(w, subj, g)
                        const nextU = ROOM_USES[(ROOM_USES.indexOf(u) + 1) % ROOM_USES.length]
                        return (
                          <td key={g} className="text-center">
                            <button
                              onClick={() => setWeights(x => {
                                const ru = { ...x.roomUse, [subj]: { ...(x.roomUse[subj] ?? {}) } }
                                if (nextU === 'always') delete ru[subj][String(g)]
                                else ru[subj][String(g)] = nextU
                                return { ...x, roomUse: ru }
                              })}
                              title={`點擊改為「${ROOM_USE_LABEL[nextU]}」`}
                              className={`w-full px-1 py-0.5 text-[11px] rounded-sm border ${
                                u === 'always' ? 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'
                                : u === 'double' ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : 'bg-zinc-100 text-zinc-600 border-zinc-300'}`}>
                              {ROOM_USE_LABEL[u]}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        <p className="px-4 py-2 text-[11px] text-zinc-400">
          「只有連堂」＝單節留在原班上，不占專科教室、也不扣「專科教室優先」的分。依 114-2 人工課表逐年級核對（零例外）：
          自然科學連堂 42 組全進自然教室、單節 42 堂全留原班；視覺藝術三年級連堂與單節全留原班、四～六年級全進手作教室；
          音樂 42 堂、表演藝術 21 堂、智慧探究家 42 組皆 100% 進專科教室。
        </p>
      </div>

      {/* 三、固定硬限制（摺疊） */}
      <div className="card p-0 overflow-hidden">
        <button onClick={() => setHardOpen(o => !o)} className="w-full px-4 py-2 flex items-center gap-2 text-left hover:bg-zinc-50">
          <span className="text-zinc-400">{hardOpen ? '▾' : '▸'}</span>
          <span className="text-sm font-semibold text-zinc-700">固定硬限制</span>
          <span className="text-xs text-zinc-400">引擎絕不違反、不可調整；排不下的課列入未排清單（依 114-2 人工課表 0 違反者訂）</span>
        </button>
        {hardOpen && (
          <ul className="text-xs text-zinc-500 list-disc pl-9 pr-4 pb-3 space-y-0.5">
            <li>同班／同師／同教室同時段只有一堂課；只用年段可排課時段；避開鎖課格</li>
            <li>不排課標記：導師被標 → 班級課表該格必排科任課；科任被標 → 該格不排其課</li>
            <li>
              <b>專科教室是排課時的資源</b>——先排科任教室再排課。依「專科教室使用時機」該進教室的課，一定要有教室：
              有管理教師的老師只用自己管理的那間（絕對優先，可把借用者換到別間）；沒有管理教室的老師用該科任一間（一間不夠就兩間）。
              該時段沒教室就改排別的時段，整週都塞不進才成為未排——<b>不會回原班</b>。管理教師在「4 教室設定」設定，一間可設多位。
            </li>
            <li><b>導師連堂位</b>——導師自己上的科目裡有連堂（自然／社會／生活）或單雙週（視藝）的班，科任課不得把留白切到連一組「同半天連續兩格」都不剩；至少留 1 組，給導師連堂的機會（要不要拆由導師自己決定）。沒留到＝必須級</li>
            <li className="flex items-center gap-2 flex-wrap">
              <span>老師連續授課絕對上限</span>
              <input type="number" min={2} max={6} value={w.hardParams.maxRunTeacher}
                onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, maxRunTeacher: Math.min(6, Math.max(2, Number(e.target.value) || 6)) } }))}
                className="input w-14 text-center py-0.5 text-xs" />
              <span>節（科任與外師；預設 6＝永不連 7）</span>
            </li>
            <li className="flex items-center gap-2 flex-wrap">
              <span><b>連堂後不緊接單節</b>（同一位老師、同半天；午休隔開不算）——連堂結束要收器材，緊接著跑班來不及；單節後接連堂可以。適用科目：</span>
              <input value={w.hardParams.noSingleAfterDouble.join('、')}
                onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, noSingleAfterDouble: e.target.value.split(/[、,，\s]+/).map(v => v.trim()).filter(Boolean) } }))}
                placeholder="自然" className="input py-0.5 text-xs w-40" />
              <span className="text-zinc-400">114-2 人工課表自然 42 組連堂 0 例外</span>
            </li>
            <li className="flex items-center gap-2 flex-wrap">
              <span><b>自然／科技教室優先排</b>——課表全空時先為這些教室做精確搜尋：每位管理者一週只占一個連續區塊、不交錯（甲＝一二三、乙＝三四五，邊界日共用）；同一位老師區塊裡年級也連續（六年級全上完才換四年級，跨天也算）。放不下會自動降級（先放寬年級連續、再放寬不交錯）並在排課結果說明；精靈也會在需要時把「自動配班」的班在同科同年級老師間對調（手動指定的不動）。鎖課永遠優先。<b>預設關閉</b>（115 實測只有一間自然教室放得進規則，且可行性變差）；要啟用請填教室科目（順序＝優先序）：</span>
              <input value={w.hardParams.roomBlockSubjects.join('、')}
                onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, roomBlockSubjects: e.target.value.split(/[、,，\s]+/).map(v => v.trim()).filter(Boolean) } }))}
                placeholder="自然、智慧探究家：科技創新任務" className="input py-0.5 text-xs w-72" />
            </li>
            <li className="flex items-center gap-2 flex-wrap">
              <span><b>專科教室老師不回頭</b>（同一間專科教室、同一天）——老師走了不能再回來（甲 1-2／乙 3-4／甲 5-6 ✗），收了實驗器材又要回來擺。適用教室科目：</span>
              <input value={w.hardParams.noReturnSubjects.join('、')}
                onChange={e => setWeights(x => ({ ...x, hardParams: { ...x.hardParams, noReturnSubjects: e.target.value.split(/[、,，\s]+/).map(v => v.trim()).filter(Boolean) } }))}
                placeholder="自然" className="input py-0.5 text-xs w-40" />
              <span className="text-zinc-400">114-1 人工課表自然教室 27 個教室日 0 次回頭；其他科目由權重「專科教室同日老師成塊」管</span>
            </li>
            <li>科任老師的課間空堂：<b>只看上午（1~4 節）</b>，最多一段——半天日「上空上空」可以，整天日「上空上空上」不行；<b>下午的空堂完全不管</b>（導師不在此限）</li>
            <li>同科同日：同班同科一天最多一次（連堂本身、「都可以」的自然成對不算）</li>
            <li>連堂 2 節成對永不拆散、且不跨午休（不由第 4 節起始）；視藝單雙週固定兩格輪替（單週組起始 1/3/5、雙週組 2/4/6）</li>
            <li>外師：同時段只在一班、不可到校時段不排、單日不連 7</li>
          </ul>
        )}
      </div>
    </div>
  )
}
