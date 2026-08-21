// 排課（timetabling）共用型別與演算法。
// 輸入＝配課結果（哪位老師教哪些班的哪些科目幾節）＋排課設定（時段格、各種占用）。
// 輸出＝每班課表、每位老師課表、未能排入的清單。
// MVP 採貪婪（greedy）：硬限制＝教師同時段不衝突＋封鎖時段；軟限制＝同科盡量分散到不同天。

// ── 時間軸 ──
export const SCHEDULE_DAYS = [1, 2, 3, 4, 5] as const   // 週一~週五
export const DAY_LABEL: Record<number, string> = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' }
export const DEFAULT_PERIODS = 7                          // 每天節次上限（可於設定調整）

export type Band = 'low' | 'mid' | 'high'
export const BANDS: Band[] = ['low', 'mid', 'high']
export const BAND_LABEL: Record<Band, string> = { low: '低年級', mid: '中年級', high: '高年級' }
export const BAND_GRADES: Record<Band, number[]> = { low: [1, 2], mid: [3, 4], high: [5, 6] }
export function bandOf(grade: number): Band {
  if (grade <= 2) return 'low'
  if (grade <= 4) return 'mid'
  return 'high'
}

export interface Slot { day: number; period: number }
export function slotKey(s: Slot): string { return `${s.day}-${s.period}` }
export function parseSlotKey(k: string): Slot { const [d, p] = k.split('-').map(Number); return { day: d, period: p } }

// ── 排課設定 ──

/** 一個年段的時段格：哪些 (day,period) 是「可排課節」。 */
export interface BandGrid {
  periodsPerDay: number                 // 該年段每天節次數（上限）
  teachable: Record<string, boolean>    // key = `${day}-${period}` → 是否可排課節
}

/** 鎖課名目：名目（label）給管理者辨識、科目（subject）顯示在課表格子上。
 *  isNative＝本土語鎖課（語別場次的時段來源、班級格顯示閩南語師）——由科目＝「本土語」自動推導，無需手動勾選。
 *  byHomeroom＝這節是不是導師在上（導師規則：不連四、上午下限、每日上限、成塊要把它當導師課）。
 *    null＝自動：科目在該班導師的配課裡就算導師課（種子班國語／數學／班級活動全命中、本土語鐘點全不命中）；
 *    只有像「五年級游泳」這種科目掛班級活動、實際由教練上的特例才需要手動設「否」。 */
export interface LockType { id: string; label: string; subject: string; color: string; isNative: boolean; byHomeroom: boolean | null }

// 鎖課名目可選的低彩度色票（key 存進設定，顯示時查表）
export const LOCK_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  rose:   { bg: '#ffe4e6', text: '#9f1239', border: '#fda4af' },
  amber:  { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  lime:   { bg: '#ecfccb', text: '#3f6212', border: '#bef264' },
  teal:   { bg: '#ccfbf1', text: '#115e59', border: '#5eead4' },
  sky:    { bg: '#e0f2fe', text: '#075985', border: '#7dd3fc' },
  violet: { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },
  pink:   { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  slate:  { bg: '#e2e8f0', text: '#334155', border: '#94a3b8' },
}
export const LOCK_COLOR_KEYS = Object.keys(LOCK_COLORS)

// 個人不排課類別
export type OffCategory = 'counseling' | 'admin' | 'training' | 'other'
export const OFF_CATEGORIES: OffCategory[] = ['counseling', 'admin', 'training', 'other']
export const OFF_CATEGORY_LABEL: Record<OffCategory, string> = {
  counseling: '輔導團', admin: '行政', training: '進修', other: '其他',
}

/** 個人排課/不排課標記。
 *  mode='off'（不排課）：該時段不排該師的課（導師→班級課表該時段排科任課；科任→該時段留空）。
 *  mode='on'（排課）：該時段一定要排該師的課（導師→該格必留導師課、科任課不可放；科任→該時段必須排入其課）。 */
export interface PersonalOff {
  id: string
  teacherId: string
  category: OffCategory
  mode: 'off' | 'on'
  note: string            // 補充說明（類別為其他時建議填）
  slots: string[]         // slotKey 列表
}

// ── 教室設定 ──
// 目的：一、讓系統知道哪些教室同層同區、彼此接近（排課走動成本）；
//       二、統計科任教室數（每間需要一張科任教室課表）。
export type RoomKind = 'class' | 'subject' | 'native' | 'none'
export const ROOM_KIND_LABEL: Record<RoomKind, string> = { class: '一般教室', subject: '科任教室', native: '本土語言教室', none: '其他／未使用' }

/** 一間教室：一般教室填班級（classKey）、科任教室填名稱＋選填編號（同名多間，如自然教室一、二）
 *  ＋對應科目（排課據此計算教室衝突與走動成本；空＝不綁科目）
 *  ＋管理教師（managerIds，選填、可多位）：排課時該教室優先給管理教師的課使用
 *  ＋可排語別（langs，本土語言教室用）：非清單內的語別不可排；空＝任何語別皆可
 *  ＋不排課時段（offSlots，科任教室用）：該時段教室另有用途（收器材、收筆電、借給生活老師…），排課引擎視為教室不存在（硬限制）。 */
export interface Room { id: string; kind: RoomKind; classKey: string; name: string; no: string; subject: string; managerIds: string[]; langs: string[]; offSlots: string[]; offNote: string }

// 本土語語別（語別課程用；閩南語走班級的本土語科目）
export const NATIVE_LANGS = ['閩南語', '客語（四縣）', '客語（海陸）', '台灣手語', '原住民族語', '新住民語', '閩東語']

/** 本土語場次狀態覆寫：場次由 鎖課時段×語別課程配課 自動推導，預設全部實體（維持）。
 *  課表生成後管理者依實際情況覆寫：stream＝直播共學（不具名）、cancelled＝取消（學生回原班上閩南語）。
 *  key = `${slotKey}|${課程名}|${grade}` */
export interface NativeLangConfig {
  states: Record<string, 'stream' | 'cancelled'>   // 場次狀態（key＝`${slot}|${lang}|${grade}`；未存＝實體）
  teachers: Record<string, string>                 // 場次授課老師（同 key → teacherId）；未存＝依配課節數自動配（順序不保證）
  rooms: Record<string, string>                    // 場次教室（同 key → roomId）；未存＝自動分配（可排該語別、該時段未被占用的第一間）
}

/** 科任教室顯示名稱＝名稱＋編號。 */
export function roomLabel(r: Pick<Room, 'name' | 'no'>): string {
  return `${r.name}${r.no}`
}

/** 一個區域：同層樓一排彼此相鄰的教室。ring＝環狀（首尾也相鄰）；否則直排（首尾最遠）。 */
/** area＝棟（A～G 是建築物）；district＝區（校園分區，選填）：幾棟合成一區（A 棟與 B 棟同在一區），
 *  老師在同一區的棟之間跑班可以接受，「同半天跨區來回」以區為單位、絕不讓老師來回跨區；未填＝每棟自成一區。 */
export interface RoomZone { id: string; floor: string; area: string; district: string; ring: boolean; rooms: Room[] }

// 科任教室常用名稱（datalist 快選用）
export const SUBJECT_ROOM_PRESETS = [
  '音樂教室', '自然教室', '英語教室', '電腦教室', '科技教室', '資訊教室', '視覺藝術教室', '表演藝術教室', '律動教室', '圖書室', '活動中心',
]

// ── 權重設定 ──
// 引擎只排科任課，所有規則的作用對象都是「科任課的落點」；保護導師是部分規則的目的，不是機制。
// 權重五段：關/低/中/高/必須 → 罰分 0/1/3/9/硬限制（指數型，高一項抵低九項）。

// 權重四段：關/低/中/高。硬性要求一律列為固定硬限制（引擎絕不違反），不提供「必須」權重。
// type 仍保留 'must' 以相容舊資料，normalize 時自動降為 'high'。
export type WeightLevel = 'off' | 'low' | 'mid' | 'high' | 'must'
export const WEIGHT_LEVELS: WeightLevel[] = ['off', 'low', 'mid', 'high']
export const WEIGHT_LEVEL_LABEL: Record<WeightLevel, string> = { off: '關閉', low: '低', mid: '中', high: '高', must: '必須' }
export const WEIGHT_PENALTY: Record<WeightLevel, number> = { off: 0, low: 1, mid: 3, high: 9, must: Infinity }

/** 每週分布傾向：分散與集中是同一條軸的兩端，不是兩條互相打架的規則，
 *  故做成「傾向＋強度」而非兩個權重；每種對象（導師／科任・行政／鐘點）可以有不同傾向。
 *  spread＝各日課量盡量平均；concentrate＝盡量壓在 days 天之內；off＝不管。 */
export type DayMode = 'spread' | 'off' | 'concentrate'
export const DAY_MODES: DayMode[] = ['spread', 'off', 'concentrate']
export const DAY_MODE_LABEL: Record<DayMode, string> = { spread: '分散', off: '不拘', concentrate: '集中' }
export interface DaySpread { level: WeightLevel; mode: DayMode; days: number; must: boolean }   // days 僅在 concentrate 時使用＝目標天數；must＝超過天數升必須級（課務組：鐘點不超過 3 天是鐵律，權重高只扣 9 分咬不住）

/** 內建規則（只能調權重與參數，不能增刪）。 */
export interface BuiltinRules {
  dailyMax: { level: WeightLevel; n: number }     // 科任每日節數上限 N
  consecMax: { level: WeightLevel; n: number }    // 連續授課軟上限 N（永不連 7＝固定硬限制，絕對上限 6 連）
  compact: WeightLevel                            // 減少零碎空堂（單一空堂的多寡；「上空上空」交錯為固定硬限制）
  hourlyBalance: DaySpread                        // 鐘點的每週分布傾向（多半要「集中」——少跑幾趟學校）
  // 孤堂日：非導師老師某天只上 1 節＝來一趟只為一節課（導師整天在自己班，不算）。
  //   level＝一天只 1 節；halfLevel＝半天只 1 節（該天不只這一節才算）；partTimeMust＝鐘點／代理的孤堂日升為必須級（結果仍跑得出來、但成功條件會卡住並點名）。
  //   114-2 人工課表 6% 人日是孤堂日、13% 半天只 1 節；v17 引擎 11%／15%，課務組手調後 4%／10%
  lonelyDay: { level: WeightLevel; halfLevel: WeightLevel; partTimeMust: boolean }
  // 少節數老師集中：非導師、非鐘點、總節數 ≤ n 的老師（行政兼課、輔導團）壓到 ceil(節數/4) 天內（3 節→1 天、5～8 節→2 天）。
  //   人工課表 ≤6 節老師平均到校 2.1 天、v17 引擎 2.7 天；鐘點另有 hourlyBalance
  lowLoadConcentrate: { level: WeightLevel; n: number }
  // 導師連上上限（N 與適用年段在 hardParams.maxRunHomeroom／homeroomRunBands）：原為硬限制，人工課表 5% 班日導師連四、
  //   課務組手調也踩了 4 筆 → 降為權重（預設高）
  homeroomRun: WeightLevel
  // 同半天年級夾單節：同一位老師、上午（1-4）或下午（5-7）內三節連續、年級 X→Y→X 且中間只夾一節別的年級（2→1→2）。
  //   2→1→1→2、隔空堂、跨午休都不算。114-2 人工課表 0 筆（學校守的不是「相鄰不跨年級」而是「不要為一節課跳去又跳回」）；v18 手調 1 筆、v19 引擎 11 筆
  gradeSandwich: WeightLevel
  // 同半天跨區來回：同一口徑，看教室設定的「區」（A→B→A、B 只一節）
  zoneSandwich: WeightLevel
  // 科任每天至少一節：非導師、非鐘點、一週 ≥ n 節的老師，每個上課日至少 1 節（整天被個人不排課蓋住的日子不算）。
  //   課務組原則「科任不能有一天完全沒課」；行政兼課（<n 節）不受此限，由「少節數老師集中」管
  teacherEveryDay: { level: WeightLevel; n: number }
  // 科任每週平均：正式／代理科任（非導師、非鐘點、總節數 > 少節數門檻）各日課量盡量平均——最重日減最輕日 ≤ n 節才不罰
  //   （整天被個人不排課蓋住的日子不計）。課務組原則「正式和代理科任的課務要盡量平均、鐘點要集中」
  teacherSpread: { level: WeightLevel; n: number }
  classCohesion: WeightLevel                      // 科任課同日成塊：同班同日（上/下午各計）科任課＋鎖課連成一塊、不被導師課切開（同上降為權重）
  bandAdjacent: WeightLevel                       // 全單節老師相鄰兩堂同年級：課全是一節一節的老師（音樂、英語、體育…），相鄰兩堂盡量同年級，
                                                  //   免得一下四年級一下六年級（跨年級＝換教材換進度）。114-2 人工課表 263 對相鄰課有 43 對跨年級（16%）→ 權重
  batchType: WeightLevel                          // 同型態同日：老師同日不混排連堂與單節。114-2 人工課表 14/235 組混排，且成因結構性
                                                  //（同一師兼教連堂科目與單節科目；自然/社會 3 節＝連堂＋單節，單科內就會混）→ 權重非硬限制
  // 固定硬限制（人工課表 0 違反，維持）：同時段唯一、永不連 7、同科同日、連堂不拆、連堂不跨午休、科任老師上空上空
  // 已刪除（被硬限制自動涵蓋）：連堂單節分半週（間隔≥2天的組合必然跨半週）
  walkCost: WeightLevel                           // 走動成本（依教室設定相鄰距離）
  roomManagerFirst: WeightLevel                   // 教室管理教師優先：管理者必得自己的教室（結構保證）；非管理者用到有管理者的教室時扣分
  roomHalfDay: WeightLevel                        // 專科教室老師集中：一間教室一週時間軸上的老師「交接」越少越好（一位老師連續幾天用完再換人，器材不用收）。
                                                  //   多餘交接（超過老師數−1）每次扣 1；同日回頭扣 1（自然＝硬限制）；2／3 節之間交接（半天兩位）扣 ½
  // 上午導師課下限：每天上午（1~4 節）至少 N 節是導師課。刻意做成「下限」而非「越多越好」——
  // 單調版本會把科任課全擠到下午、讓上午 4 格全是導師課而撞上「不連四」硬限制。
  homeroomMorning: { level: WeightLevel; n: number }
  // 導師每週分布已刪除：每日上限 N 一設，14 節÷N 就強制用滿 5 天且只剩一種形狀，分散是必然結果
  // 導師每日節數上限：每班每日留白 ≤ N（科任課至少補到 每日格數−N）。
  //   fullDayLowN＝低年段整天日（週二）的上限（低年級只有週二整天，每班科任 7～8 堂擺不滿，課務組接受 5）；
  //   offBonusFrom＝導師個人不排課／進修加總達此格數者上限 +1（可排格少、其餘日子必然多上）
  homeroomDailyMax: { level: WeightLevel; n: number; fullDayLowN: number; offBonusFrom: number }
  // 母開關：科目避開節次／科目時段偏好——各自可新增多組子規則（TemplateRule），母開關「關閉」＝全部子規則不計；
  // 母開關的權重＝新增子規則的預設權重（子規則各自可再調）
  avoidPeriods: WeightLevel
  timePrefer: WeightLevel
  subjectApart: WeightLevel                       // 科目互斥同日（母開關）：子規則列的幾科同班不同天出現，預設高
  teacherApart: WeightLevel                       // 老師同日不混科目（母開關）：子規則列的幾科，同一位老師同一天只上其中一種。
                                                  //   英語老師：週一都國際教育、週二都英語，不穿插。114-2 人工課表 30 人日混排 2（7%）→ 權重高
}

/** 固定硬限制的參數（不是權重、只是數字；引擎絕不違反）。 */
export interface HardParams {
  maxRunTeacher: number       // 老師（科任／外師）連續授課絕對上限（預設 6＝永不連 7）
  maxRunHomeroom: number      // 導師連上上限（預設 3＝不連四）：班級同日連續留白不得超過此數＝至少落 1 堂科任／鎖課切開。
                              // 目的＝導師不會整個上午連四節都是自己的課（中間要有科任課能喘口氣、改作業）。強度由 builtin.homeroomRun 權重決定
  homeroomRunBands: Band[]    // 上一條適用的年段（預設全年段；清空＝停用）
  // 連堂後不緊接單節（同一位老師、同一個半天）：連堂結束要收器材，緊接著跑班來不及。
  // 單節後接連堂可以。114-2 人工課表自然 42 組連堂 0 例外 → 硬限制。列出的科目為「連堂的科目」
  noSingleAfterDouble: string[]
  // 專科教室老師不回頭：同一間專科教室同一天，老師走了不能再回來（翁 1-2／陳 3-4／翁 5-6 ✗）——收了實驗器材又要回來擺。
  // 114-1 人工課表自然教室 27 個教室日 0 次回頭 → 硬限制。列出的是「教室的科目」；其他科目由權重「專科教室同日老師成塊」管
  noReturnSubjects: string[]
  // 自然／科技教室優先排（教室科目清單，順序＝優先序）：課表全空時先為這些教室做精確搜尋——
  // 每位管理者一週只占一個連續區塊不交錯、區塊裡年級連續（六年級全上完才換四年級）；放不下自動降級並在結果說明
  roomBlockSubjects: string[]
}
export const DEFAULT_HARD_PARAMS: HardParams = { maxRunTeacher: 6, maxRunHomeroom: 3, homeroomRunBands: [...BANDS], noSingleAfterDouble: ['自然', '自然科學'], noReturnSubjects: ['自然', '自然科學'], roomBlockSubjects: [] }   // 教室優先求解預設關閉：115 實測只有一間自然教室放得進規則，且會讓五個種子都剩幾堂排不完；輸入改了（鎖課／不排課）再開

/** 專科教室使用時機（結構設定，非權重）。依 114-2 人工課表：
 *  自然科學＝連堂 42 組 100% 進自然教室、單節 42 堂 0% 進（實驗課進教室、講述課留原班，零例外）；
 *  音樂 42 堂、表演藝術 21 堂全為單節且 100% 進專科教室；智慧探究家全連堂 100% 進。
 *  所以不是一條「連堂才進專科教室」的全域規則，而是每個科目各有慣例。 */
export type RoomUse = 'always' | 'double' | 'never'
export const ROOM_USES: RoomUse[] = ['always', 'double', 'never']
export const ROOM_USE_LABEL: Record<RoomUse, string> = { always: '一律使用', double: '只有連堂', never: '不使用' }
/** 取某科某年級的專科教室使用時機（未設＝一律使用，與舊行為相同）。
 *  需要年級維度是因為視覺藝術：三年級連堂 5 組、單節 10 堂全部留原班，四～六年級 100% 進手作教室。 */
export function roomUseOf(w: ScheduleWeights, subject: string, grade: number): RoomUse {
  return w.roomUse?.[subject]?.[String(grade)] ?? 'always'
}
/** 依使用時機判斷這一堂該不該進專科教室（size 2＝連堂）。 */
export function shouldUseRoom(w: ScheduleWeights, subject: string, grade: number, size: number): boolean {
  const u = roomUseOf(w, subject, grade)
  return u === 'always' || (u === 'double' && size === 2)
}

/** 科目連堂模式（結構設定，非權重；影響第一階段可行性）：
 *  auto＝都可以（單節排、允許同科同日相鄰兩節自然成對，不跨午休）；double＝連堂（每 2 節綁一組永不拆）；
 *  single＝不連堂（單節、同科不同日）；biweekly＝單雙週連堂（視藝：占固定兩格、單週組/雙週組輪替）。 */
export type DoubleMode = 'auto' | 'double' | 'single' | 'biweekly'
export const DOUBLE_MODES: DoubleMode[] = ['auto', 'double', 'single', 'biweekly']
export const DOUBLE_MODE_LABEL: Record<DoubleMode, string> = { auto: '都可以', double: '連堂', single: '不連堂', biweekly: '單雙週' }
/** 取某科某年級的連堂模式（未設＝都可以）。 */
export function doubleModeOf(w: ScheduleWeights, subject: string, grade: number): DoubleMode {
  return w.doubleMode[subject]?.[String(grade)] ?? 'auto'
}

/** 模板規則：管理者可無限新增實例，引擎實作模板計分邏輯。（doublePeriod／noConsecDays 為舊資料，normalize 時遷移／剔除） */
export type RuleTemplate = 'avoidPeriods' | 'timePrefer' | 'subjectApart' | 'teacherApart'
export const RULE_TEMPLATE_LABEL: Record<RuleTemplate, string> = {
  avoidPeriods: '科目避開節次', timePrefer: '科目時段偏好', subjectApart: '科目互斥同日', teacherApart: '老師同日不混科目',
}
export interface TemplateRule {
  id: string
  template: RuleTemplate
  subjects: string[]              // 適用科目
  grades: number[]                // 適用年級（空＝全部年級）
  level: WeightLevel
  periods?: number[]              // avoidPeriods：避開的節次
  fullDayOnly?: boolean           // avoidPeriods：僅整天日適用（如避第 7 節，不影響半天日第 4 節）
  pref?: 'morning' | 'afternoon'  // timePrefer：偏好時段
  hard?: boolean                  // subjectApart：必須不同日（硬限制）。114-2 人工課表 國際教育／英語 同日 0／106，是鐵律不是偏好
}

export interface ScheduleWeights {
  builtin: BuiltinRules
  templates: TemplateRule[]
  doubleMode: Record<string, Record<string, DoubleMode>>   // 科目 → 年級("1"~"6") → 連堂模式（未設＝auto）
  roomUse: Record<string, Record<string, RoomUse>>        // 科目 → 年級("1"~"6") → 專科教室使用時機（未設＝一律使用）
  hardParams: HardParams                                    // 固定硬限制參數
}

/** 預設連堂矩陣（＝原本五條連堂模板＋視藝四六單雙週）。 */
export function defaultDoubleMode(): Record<string, Record<string, DoubleMode>> {
  const m: Record<string, Record<string, DoubleMode>> = {}
  const set = (subj: string, grades: number[], mode: DoubleMode) => { for (const g of grades) (m[subj] ??= {})[String(g)] = mode }
  set('自然', [1, 2, 3, 4, 5, 6], 'double'); set('社會', [1, 2, 3, 4, 5, 6], 'double')
  set('生活', [1, 2], 'double'); set('智慧探究家：科技創新任務', [3, 4, 5, 6], 'double')
  set('視覺藝術', [3, 5], 'double'); set('視覺藝術', [4, 6], 'biweekly')
  return m
}

/** 預設專科教室使用時機（依 114-2 人工課表，各年級逐一核對、零例外）：
 *  自然科學＝只有連堂（連堂 42 組 100% 進、單節 42 堂 0% 進，四個年級都一致）；
 *  視覺藝術＝三年級不使用（連堂 5 組、單節 10 堂全留原班），四～六年級一律使用；
 *  音樂、表演藝術、智慧探究家＝一律使用（100%）。 */
export function defaultRoomUse(): Record<string, Record<string, RoomUse>> {
  const m: Record<string, Record<string, RoomUse>> = {}
  const set = (subj: string, grades: number[], u: RoomUse) => { for (const g of grades) (m[subj] ??= {})[String(g)] = u }
  // 科目名以各校配課設定為準：本校配課用簡稱「自然」，人工課表 PDF 上則印全名「自然科學」，兩者都填
  set('自然', [1, 2, 3, 4, 5, 6], 'double')
  set('自然科學', [1, 2, 3, 4, 5, 6], 'double')
  set('視覺藝術', [3], 'never')
  return m
}

export function defaultScheduleWeights(): ScheduleWeights {
  return {
    // 預設值＝「關埔慣例」：由 115 學年度課務組最滿意的版本（v17）再手調 97 堂（v18）與四期人工課表逆推——
    // 課務組排的是「老師的課表」：科任老師不空堂、不為一節課跑一趟、少節數老師集中、連堂與單節分日；
    // 為此願意付出走動距離、相鄰同年級、導師每日／上午規則的分數，連上放寬到 6 連。
    builtin: {
      dailyMax: { level: 'high', n: 6 },      // 114-2 人工課表實測最大值恰為 6、0 筆超標
      consecMax: { level: 'mid', n: 6 },      // 人工課表 16% 人日超過 4 連、課務組手調主動做出 6 連——「連上」不如「不空堂」要緊；v19 一天 6 節偏多，課務組定為中；絕對上限仍是硬限制 6
      compact: 'high',                        // 課務組手調 97 堂的主旋律：人工課表 77% 人日零空堂，v17 引擎只有 51%
      hourlyBalance: { level: 'high', mode: 'concentrate', days: 3, must: true },   // 課務組原則「鐘點不要超過 3 天」——鐵律，超過＝必須級
      lonelyDay: { level: 'high', halfLevel: 'low', partTimeMust: false },
      lowLoadConcentrate: { level: 'high', n: 8 },
      classCohesion: 'mid',    // 114-2 人工課表 9% 半天被切開、v17 引擎 4%：引擎已比人工好，中即可
      batchType: 'high',
      bandAdjacent: 'low',     // 權重高時課務組仍手動打破 10 筆；人工課表 13% 相鄰跨年級——在他心裡位階低於不空堂
      walkCost: 'low',         // 人工課表 79% 相鄰兩堂換場地，學校根本沒在省；v17 目標函數被它吃掉一半而課務組完全不在意
      roomManagerFirst: 'high',   // 管理教師沒用到自己的教室／老師本週用了多間——中的話咬不住，引擎寧可讓人跑
      roomHalfDay: 'mid',
      homeroomMorning: { level: 'high', n: 2 },   // v19 上午 0 節導師課的班日 12→23，課務組定為高
      homeroomDailyMax: { level: 'high', n: 4, fullDayLowN: 5, offBonusFrom: 7 },   // 課務組原則「導師一天不要超過 4 節；低年級週二 5；不排課≥7 格者 5」
      homeroomRun: 'high',
      gradeSandwich: 'high',
      zoneSandwich: 'high',   // 課務組：千萬不要讓老師來回跨區
      teacherEveryDay: { level: 'high', n: 12 },
      teacherSpread: { level: 'mid', n: 2 },
      avoidPeriods: 'mid',
      timePrefer: 'off',
      subjectApart: 'mid',     // 人工課表 體育↔健康同日 22%、自然↔社會同日 16%，不到絕對
      teacherApart: 'high',
    },
    doubleMode: defaultDoubleMode(),
    roomUse: defaultRoomUse(),
    hardParams: { ...DEFAULT_HARD_PARAMS },
    templates: [
      { id: 'tpl-pe-lunch', template: 'avoidPeriods', subjects: ['體育'], grades: [], periods: [4, 5], level: 'mid' },
      { id: 'tpl-exam-last', template: 'avoidPeriods', subjects: ['社會', '自然', '英語'], grades: [], periods: [7], fullDayOnly: true, level: 'high' },   // 人工課表遵守率 92%
      // 國際教育（外師協同）與英語同班不同日：114-2 人工課表 0／106 零例外＝鐵律 → 硬限制
      { id: 'tpl-ie-en-apart', template: 'subjectApart', subjects: ['國際教育', '英語'], grades: [3, 4, 5, 6], level: 'high', hard: true },
      // 英語老師同一天只上國際教育或只上英語，不穿插：114-2 人工課表 30 人日混排 2（7%）
      { id: 'tpl-ie-en-teacher', template: 'teacherApart', subjects: ['國際教育', '英語'], grades: [], level: 'high' },
    ],
  }
}

const WEIGHT_LEVEL_SET = new Set<string>(WEIGHT_LEVELS)
function normLevel(v: unknown, fallback: WeightLevel): WeightLevel {
  if (v === 'must') return 'high'   // 舊資料的「必須」一律降為「高」（硬性要求已改為固定硬限制）
  return WEIGHT_LEVEL_SET.has(String(v)) ? v as WeightLevel : fallback
}

/** 舊資料的 homeroomBalance 是單純的 WeightLevel 字串 → 補成「分散」傾向。 */
function normSpread(v: unknown, fallback: DaySpread): DaySpread {
  if (typeof v === 'string') return { level: normLevel(v, fallback.level), mode: 'spread', days: fallback.days, must: fallback.must }
  if (!v || typeof v !== 'object') return { ...fallback }
  const o = v as Partial<DaySpread>
  const days = Number(o.days)
  return {
    level: normLevel(o.level, fallback.level),
    mode: DAY_MODES.includes(o.mode as DayMode) ? o.mode as DayMode : fallback.mode,
    days: Number.isInteger(days) && days >= 1 && days <= 5 ? days : fallback.days,
    must: typeof o.must === 'boolean' ? o.must : fallback.must,
  }
}

export function normalizeScheduleWeights(raw: unknown): ScheduleWeights {
  const base = defaultScheduleWeights()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<ScheduleWeights>
  const b = (r.builtin ?? {}) as Partial<BuiltinRules>
  const db = base.builtin
  return {
    builtin: {
      dailyMax: { level: normLevel(b.dailyMax?.level, db.dailyMax.level), n: Number(b.dailyMax?.n ?? db.dailyMax.n) },
      consecMax: { level: normLevel(b.consecMax?.level, db.consecMax.level), n: Number(b.consecMax?.n ?? db.consecMax.n) },
      compact: normLevel(b.compact, db.compact),
      hourlyBalance: normSpread(b.hourlyBalance, db.hourlyBalance),
      lonelyDay: {
        level: normLevel(b.lonelyDay?.level, db.lonelyDay.level),
        halfLevel: normLevel(b.lonelyDay?.halfLevel, db.lonelyDay.halfLevel),
        partTimeMust: Boolean(b.lonelyDay?.partTimeMust ?? db.lonelyDay.partTimeMust),
      },
      lowLoadConcentrate: (() => {
        const n = Number(b.lowLoadConcentrate?.n)
        return { level: normLevel(b.lowLoadConcentrate?.level, db.lowLoadConcentrate.level), n: Number.isInteger(n) && n >= 2 && n <= 20 ? n : db.lowLoadConcentrate.n }
      })(),
      homeroomRun: normLevel(b.homeroomRun, db.homeroomRun),
      gradeSandwich: normLevel(b.gradeSandwich, db.gradeSandwich),
      zoneSandwich: normLevel(b.zoneSandwich, db.zoneSandwich),
      teacherEveryDay: (() => {
        const n = Number(b.teacherEveryDay?.n)
        return { level: normLevel(b.teacherEveryDay?.level, db.teacherEveryDay.level), n: Number.isInteger(n) && n >= 1 && n <= 30 ? n : db.teacherEveryDay.n }
      })(),
      teacherSpread: (() => {
        const n = Number(b.teacherSpread?.n)
        return { level: normLevel(b.teacherSpread?.level, db.teacherSpread.level), n: Number.isInteger(n) && n >= 0 && n <= 7 ? n : db.teacherSpread.n }
      })(),
      classCohesion: normLevel(b.classCohesion, db.classCohesion),
      batchType: normLevel(b.batchType, db.batchType),
      bandAdjacent: normLevel(b.bandAdjacent, db.bandAdjacent),
      walkCost: normLevel(b.walkCost, db.walkCost),
      roomManagerFirst: normLevel(b.roomManagerFirst, db.roomManagerFirst),
      roomHalfDay: normLevel(b.roomHalfDay, db.roomHalfDay),
      // 舊資料的 homeroomMorning 是純字串（單調版）→ 補成下限 N；homeroomBalance 直接丟棄
      homeroomMorning: typeof b.homeroomMorning === 'string'
        ? { level: normLevel(b.homeroomMorning, db.homeroomMorning.level), n: db.homeroomMorning.n }
        : { level: normLevel(b.homeroomMorning?.level, db.homeroomMorning.level), n: Number(b.homeroomMorning?.n ?? db.homeroomMorning.n) },
      homeroomDailyMax: (() => {
        const h = (b.homeroomDailyMax ?? {}) as Partial<BuiltinRules['homeroomDailyMax']>
        const num = (v: unknown, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isInteger(x) && x >= lo && x <= hi ? x : d }
        return { level: normLevel(h.level, db.homeroomDailyMax.level), n: num(h.n, db.homeroomDailyMax.n, 1, 7), fullDayLowN: num(h.fullDayLowN, db.homeroomDailyMax.fullDayLowN, 1, 7), offBonusFrom: num(h.offBonusFrom, db.homeroomDailyMax.offBonusFrom, 1, 35) }
      })(),
      avoidPeriods: normLevel(b.avoidPeriods, db.avoidPeriods),
      timePrefer: normLevel(b.timePrefer, db.timePrefer),
      subjectApart: normLevel(b.subjectApart, db.subjectApart),
      teacherApart: normLevel(b.teacherApart, db.teacherApart),
    },
    hardParams: (() => {
      const hp = (r as { hardParams?: Partial<HardParams> }).hardParams ?? {}
      const clamp = (v: unknown, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= 2 && n <= 6 ? n : d }
      // 舊資料（無 homeroomRunBands）＝「導師連上上限」改版前存的設定：值仍是舊預設 6 者視為沒調過，
      // 一律套新預設 3（不連四）；曾自行改成其他數字則尊重原設定。
      const legacy = !Array.isArray(hp.homeroomRunBands)
      const rawHomeroom = legacy && Number(hp.maxRunHomeroom) === 6 ? undefined : hp.maxRunHomeroom
      const bands = Array.isArray(hp.homeroomRunBands)
        ? BANDS.filter(b => (hp.homeroomRunBands as unknown[]).includes(b))
        : [...BANDS]
      return {
        maxRunTeacher: clamp(hp.maxRunTeacher, DEFAULT_HARD_PARAMS.maxRunTeacher),
        maxRunHomeroom: clamp(rawHomeroom, DEFAULT_HARD_PARAMS.maxRunHomeroom),
        homeroomRunBands: bands,
        noSingleAfterDouble: Array.isArray(hp.noSingleAfterDouble) ? (hp.noSingleAfterDouble as unknown[]).map(String).filter(Boolean) : [...DEFAULT_HARD_PARAMS.noSingleAfterDouble],
        noReturnSubjects: Array.isArray(hp.noReturnSubjects) ? (hp.noReturnSubjects as unknown[]).map(String).filter(Boolean) : [...DEFAULT_HARD_PARAMS.noReturnSubjects],
        roomBlockSubjects: Array.isArray(hp.roomBlockSubjects) ? (hp.roomBlockSubjects as unknown[]).map(String).filter(Boolean) : [...DEFAULT_HARD_PARAMS.roomBlockSubjects],
      }
    })(),
    roomUse: (() => {
      const raw = (r as { roomUse?: unknown }).roomUse
      if (!raw || typeof raw !== 'object') return defaultRoomUse()
      const out: Record<string, Record<string, RoomUse>> = {}
      for (const [subj, v] of Object.entries(raw as Record<string, unknown>)) {
        // 舊資料是「科目 → 使用時機」的扁平形式 → 展開成全年級
        if (typeof v === 'string') {
          if (ROOM_USES.includes(v as RoomUse) && v !== 'always') for (const g of [1, 2, 3, 4, 5, 6]) (out[subj] ??= {})[String(g)] = v as RoomUse
          continue
        }
        if (!v || typeof v !== 'object') continue
        for (const [g, u] of Object.entries(v as Record<string, unknown>)) {
          if (ROOM_USES.includes(u as RoomUse) && u !== 'always') (out[subj] ??= {})[g] = u as RoomUse
        }
      }
      return out
    })(),
    // 連堂矩陣：新資料直接讀；舊資料由 doublePeriod 模板＋builtin.artBiweekly 遷移；皆無＝預設矩陣
    doubleMode: (() => {
      const rawDm = (r as { doubleMode?: unknown }).doubleMode
      if (rawDm && typeof rawDm === 'object') {
        const out: Record<string, Record<string, DoubleMode>> = {}
        for (const [subj, byG] of Object.entries(rawDm as Record<string, Record<string, unknown>>)) {
          if (!byG || typeof byG !== 'object') continue
          for (const [g, v] of Object.entries(byG)) if (DOUBLE_MODES.includes(v as DoubleMode) && v !== 'auto') (out[subj] ??= {})[g] = v as DoubleMode
        }
        return out
      }
      const legacyTpl = Array.isArray(r.templates) ? r.templates.filter(t => (t.template as string) === 'doublePeriod') : []
      const legacyArt = (b as { artBiweekly?: { enabled?: boolean; grades?: number[] } }).artBiweekly
      if (!legacyTpl.length && !legacyArt) return defaultDoubleMode()
      const out: Record<string, Record<string, DoubleMode>> = {}
      for (const t of legacyTpl) {
        if (t.level === 'off') continue
        const gs = Array.isArray(t.grades) && t.grades.length ? t.grades.map(Number) : [1, 2, 3, 4, 5, 6]
        for (const subj of t.subjects ?? []) for (const g of gs) (out[String(subj)] ??= {})[String(g)] = 'double'
      }
      if (legacyArt?.enabled !== false) for (const g of (legacyArt?.grades ?? [4, 6])) (out['視覺藝術'] ??= {})[String(g)] = 'biweekly'
      return out
    })(),
    templates: Array.isArray(r.templates)
      ? r.templates.filter(t => (['avoidPeriods', 'timePrefer', 'subjectApart', 'teacherApart'] as string[]).includes(t.template as string))   // doublePeriod 已遷移為連堂矩陣、noConsecDays 已為內建權重
        .map(t => ({
          id: String(t.id ?? ''),
          template: t.template as RuleTemplate,
          subjects: Array.isArray(t.subjects) ? t.subjects.map(String) : [],
          grades: Array.isArray(t.grades) ? t.grades.map(Number) : [],
          level: normLevel(t.level, 'mid'),
          periods: Array.isArray(t.periods) ? t.periods.map(Number) : undefined,
          fullDayOnly: t.fullDayOnly === true ? true : undefined,
          pref: t.pref === 'morning' || t.pref === 'afternoon' ? t.pref : undefined,
          hard: (t as { hard?: unknown }).hard === true ? true : undefined,
        }))
      : base.templates,
  }
}

/** 某班「由導師授課的鎖課格」：名目有手動指定就聽它；否則看科目是否在該班導師的配課裡
 *  （或科任配班標「導師自上」）。種子班鎖課（國數／班級活動）全命中、本土語鎖課全不命中。
 *  引擎與課表匯出共用同一份判定，避免兩邊算出不同的導師課。 */
export function homeroomLockSlots(
  config: ScheduleConfig, grade: number, index: number, hrHours: Record<string, number> | undefined,
): string[] {
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const key = classKey(grade, index)
  return Object.entries(config.lockCells[key] ?? {}).filter(([, tid]) => {
    const t = lockTypeMap[tid]
    if (!t) return false
    if (t.byHomeroom !== null && t.byHomeroom !== undefined) return t.byHomeroom
    if (!t.subject) return false
    return (hrHours?.[t.subject] ?? 0) > 0
      || config.subjectClassTeacher[subjectClassKey(grade, index, t.subject)] === HOMEROOM_SELF
  }).map(([slot]) => slot)
}

/** 科任配班中「導師自上」的特殊值（該班該科由導師授課，不指派科任）。 */
export const HOMEROOM_SELF = '__homeroom__'
export function subjectClassKey(grade: number, index: number, subject: string): string {
  return `${grade}-${index}|${subject}`
}

/** 外師（協同英語教學）設定：外師不是配課單位、不算供需（無基本節數、無減課），只是「掛在某些課上」的額外資源。
 *  年級規則＝主授（該年級每班 N 節、可排除個別班），展開成 classKey×subject→節數，引擎在該班該科的科任課中挑 N 節掛上外師。
 *  硬規則：同一外師同時段只能在一班、不可用時段不排、單日不連 7。 */
export interface ForeignGradeRule { grade: number; subject: string; perClass: number; excluded: string[] }   // excluded＝classKey
export interface ForeignTeacherConfig {
  teacherId: string            // profiles.id（聘任別＝外師）
  gradeRules: ForeignGradeRule[]
  offSlots: string[]           // 無法到校時段 slotKey
  note: string
}
/** 外師需求展開：classKey|subject → 節數。 */
export function foreignDemand(ft: ForeignTeacherConfig, classCounts: Record<number, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of ft.gradeRules) {
    if (!r.subject || r.perClass <= 0) continue
    const n = classCounts[r.grade] ?? 0
    for (let i = 0; i < n; i++) {
      const key = classKey(r.grade, i)
      if (r.excluded.includes(key)) continue
      out[`${key}|${r.subject}`] = (out[`${key}|${r.subject}`] ?? 0) + r.perClass
    }
  }
  return out
}

export interface ScheduleConfig {
  bands: Record<Band, BandGrid>
  classTeacher: Record<string, string>            // 導師配班：classKey → teacherId（管理者指定）
  subjectClassTeacher: Record<string, string>     // 科任配班：`${grade}-${index}|${subject}` → teacherId 或 HOMEROOM_SELF
  lockTypes: LockType[]                           // 鎖課名目
  lockCells: Record<string, Record<string, string>>  // 鎖課標記：classKey → slotKey → lockTypeId
  gradeCommonOff: Record<string, string[]>        // 學年共同不排課：年級("1"~"6") → slotKey 列表（連動該年級所有導師）
  personalOff: PersonalOff[]                      // 個人不排課
  roomZones: RoomZone[]                           // 教室設定：樓層×區域×相鄰教室
  weights: ScheduleWeights                        // 權重設定：內建規則＋模板規則實例
  nativeLang: NativeLangConfig                    // 本土語設定：老師語別＋開課表
  foreignTeachers: ForeignTeacherConfig[]         // 外師（協同英語）：掛課規則＋不可用時段
}

/** 產生一張時段格：halfDays 中的星期只開 1~4 節（半天），其餘整天 7 節。 */
export function bandGridWithHalfDays(halfDays: number[]): BandGrid {
  const teachable: Record<string, boolean> = {}
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= DEFAULT_PERIODS; p++) {
    teachable[`${d}-${p}`] = halfDays.includes(d) ? p <= 4 : true
  }
  return { periodsPerDay: DEFAULT_PERIODS, teachable }
}
export function defaultBandGrid(): BandGrid { return bandGridWithHalfDays([]) }

// 預設半天（只開 1~4 節）：低年級 一三四五、中年級 一三五、高年級 三
export const DEFAULT_HALF_DAYS: Record<Band, number[]> = { low: [1, 3, 4, 5], mid: [1, 3, 5], high: [3] }

export function defaultScheduleConfig(): ScheduleConfig {
  return {
    bands: {
      low: bandGridWithHalfDays(DEFAULT_HALF_DAYS.low),
      mid: bandGridWithHalfDays(DEFAULT_HALF_DAYS.mid),
      high: bandGridWithHalfDays(DEFAULT_HALF_DAYS.high),
    },
    classTeacher: {},
    subjectClassTeacher: {},
    lockTypes: [],
    lockCells: {},
    gradeCommonOff: {},
    personalOff: [],
    roomZones: [],
    weights: defaultScheduleWeights(),
    nativeLang: { states: {}, teachers: {}, rooms: {} },
    foreignTeachers: [],
  }
}

export function normalizeScheduleConfig(raw: unknown): ScheduleConfig {
  const base = defaultScheduleConfig()
  if (!raw || typeof raw !== 'object') return base
  // 舊欄位 bandCommonOff（年段 Slot[]）→ 遷移為 gradeCommonOff（年級 slotKey[]）
  const r = raw as Partial<ScheduleConfig> & { bandCommonOff?: Record<Band, Slot[]> }
  const bands = {} as Record<Band, BandGrid>
  for (const b of BANDS) {
    const g = r.bands?.[b]
    bands[b] = g && typeof g === 'object'
      ? { periodsPerDay: Number(g.periodsPerDay ?? DEFAULT_PERIODS), teachable: { ...(g.teachable ?? {}) } }
      : bandGridWithHalfDays(DEFAULT_HALF_DAYS[b])
  }
  let gradeCommonOff: Record<string, string[]> = {}
  if (r.gradeCommonOff && typeof r.gradeCommonOff === 'object') {
    for (const [g, v] of Object.entries(r.gradeCommonOff)) {
      if (Array.isArray(v)) gradeCommonOff[g] = v.map(String)
    }
  } else if (r.bandCommonOff) {
    for (const b of BANDS) {
      const slots = (r.bandCommonOff[b] ?? []).map(s => slotKey(s))
      if (slots.length) for (const g of BAND_GRADES[b]) gradeCommonOff[String(g)] = [...slots]
    }
  }
  const lockCells: Record<string, Record<string, string>> = {}
  if (r.lockCells && typeof r.lockCells === 'object') {
    for (const [ck, m] of Object.entries(r.lockCells)) {
      if (m && typeof m === 'object') lockCells[ck] = { ...m }
    }
  }
  return {
    bands,
    classTeacher: r.classTeacher ?? {},
    subjectClassTeacher: r.subjectClassTeacher ?? {},
    lockTypes: Array.isArray(r.lockTypes)
      ? r.lockTypes.map(t => ({
          id: String(t.id ?? ''), label: String(t.label ?? ''), subject: String(t.subject ?? ''),
          color: LOCK_COLORS[String(t.color ?? '')] ? String(t.color) : LOCK_COLOR_KEYS[0],
          // 科目＝「本土語」即本土語鎖課（純推導，不看存檔旗標，避免舊勾選殘留）
          isNative: String(t.subject ?? '') === '本土語',
          byHomeroom: typeof (t as { byHomeroom?: unknown }).byHomeroom === 'boolean' ? (t as { byHomeroom: boolean }).byHomeroom : null,
        }))
      : [],
    lockCells,
    gradeCommonOff,
    personalOff: Array.isArray(r.personalOff)
      ? r.personalOff.map(p => ({
          id: String(p.id ?? ''), teacherId: String(p.teacherId ?? ''),
          category: OFF_CATEGORIES.includes(p.category as OffCategory) ? p.category as OffCategory : 'other',
          mode: p.mode === 'on' ? 'on' as const : 'off' as const,   // 舊資料無此欄＝不排課
          note: String(p.note ?? ''), slots: Array.isArray(p.slots) ? p.slots.map(String) : [],
        }))
      : [],
    roomZones: Array.isArray(r.roomZones)
      ? r.roomZones.map(z => ({
          id: String(z.id ?? ''), floor: String(z.floor ?? ''), area: String(z.area ?? ''),
          district: String((z as { district?: unknown }).district ?? (z as { building?: unknown }).building ?? ''),
          ring: Boolean(z.ring),
          rooms: Array.isArray(z.rooms)
            ? z.rooms.map(rm => ({
                id: String(rm.id ?? ''),
                kind: (['class', 'subject', 'native', 'none'] as RoomKind[]).includes(rm.kind as RoomKind) ? rm.kind as RoomKind : 'class',
                classKey: String(rm.classKey ?? ''), name: String(rm.name ?? ''), no: String(rm.no ?? ''),
                subject: String(rm.subject ?? ''),
                // 舊資料是單一 managerId 字串 → 併入陣列（一間教室可有多位管理教師）
                managerIds: Array.isArray((rm as { managerIds?: unknown }).managerIds)
                  ? ((rm as { managerIds: unknown[] }).managerIds).map(x => String(x)).filter(Boolean)
                  : (String((rm as { managerId?: unknown }).managerId ?? '') ? [String((rm as { managerId?: unknown }).managerId)] : []),
                langs: Array.isArray(rm.langs) ? rm.langs.map(String) : [],
                offSlots: Array.isArray((rm as { offSlots?: unknown }).offSlots) ? ((rm as { offSlots: unknown[] }).offSlots).map(String).filter(x => /^[1-5]-[1-7]$/.test(x)) : [],
                offNote: String((rm as { offNote?: unknown }).offNote ?? ''),
              }))
            : [],
        }))
      : [],
    weights: normalizeScheduleWeights((raw as Record<string, unknown>).weights),
    nativeLang: (() => {
      const n = (raw as { nativeLang?: Partial<NativeLangConfig> }).nativeLang
      const states: Record<string, 'stream' | 'cancelled'> = {}
      for (const [k, v] of Object.entries(n?.states ?? {})) {
        if (v === 'stream' || v === 'cancelled') states[k] = v
      }
      const teachers: Record<string, string> = {}
      for (const [k, v] of Object.entries(n?.teachers ?? {})) if (typeof v === 'string' && v) teachers[k] = v
      const rooms: Record<string, string> = {}
      for (const [k, v] of Object.entries(n?.rooms ?? {})) if (typeof v === 'string' && v) rooms[k] = v
      return { states, teachers, rooms }
    })(),
    foreignTeachers: Array.isArray((raw as { foreignTeachers?: unknown }).foreignTeachers)
      ? ((raw as { foreignTeachers: Partial<ForeignTeacherConfig>[] }).foreignTeachers)
        .filter(f => f && typeof f === 'object' && f.teacherId)
        .map(f => ({
          teacherId: String(f.teacherId),
          gradeRules: Array.isArray(f.gradeRules)
            ? f.gradeRules.map(r => ({
                grade: Number(r.grade) || 0, subject: String(r.subject ?? ''),
                perClass: Math.max(0, Number(r.perClass) || 0),
                excluded: Array.isArray(r.excluded) ? r.excluded.map(String) : [],
              })).filter(r => r.grade >= 1 && r.grade <= 6)
            : [],
          offSlots: Array.isArray(f.offSlots) ? f.offSlots.map(String) : [],
          note: String(f.note ?? ''),
        }))
      : [],
  }
}

// ── 本土語場次自動推導 ──
// 前提紀律（前置檢查把關）：某語別課程×年級的配課節數 ＝ 該年級本土語鎖課「相異時段數」。
// 全部預設實體；states 覆寫為直播/取消。教室自動分配（依可排語別，一室一語別一時段）。
export interface DerivedNativeSession {
  slot: string
  course: string          // 語別課程名（配課設定「其他」）
  lang: string
  grade: number
  teacherId: string       // 配課推導（含虛擬帳號）；'' ＝配課不足
  roomId: string | null   // 自動分配；null ＝教室不足
  state: 'physical' | 'stream' | 'cancelled'
}

export function deriveNativeSessions(opts: {
  config: ScheduleConfig
  extraCourses: { lang: string; grade: number; hours: number }[]   // 年級×語別×需求總節數
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>   // tid → 語別 → 年級 → 節數
}): { sessions: DerivedNativeSession[]; issues: { level: 'error' | 'warn'; text: string; tab?: string; href?: string }[] } {
  const { config, extraCourses, hoursByTeacher } = opts
  const issues: { level: 'error' | 'warn'; text: string; tab?: string; href?: string }[] = []
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))

  // 各年級本土語鎖課相異時段
  const gradeSlots: Record<number, string[]> = {}
  for (const [ck2, cells] of Object.entries(config.lockCells)) {
    const g = Number(ck2.split('-')[0])
    for (const [slot, tid] of Object.entries(cells)) {
      if (!nativeTypeIds.has(tid)) continue
      const arr = (gradeSlots[g] ??= [])
      if (!arr.includes(slot)) arr.push(slot)
    }
  }
  for (const arr of Object.values(gradeSlots)) {
    arr.sort((a, b) => { const A = parseSlotKey(a), B = parseSlotKey(b); return A.day - B.day || A.period - B.period })
  }

  const nativeRooms: { id: string; label: string; langs: string[] }[] = []
  for (const z of config.roomZones) for (const r of z.rooms) {
    if (r.kind === 'native') nativeRooms.push({ id: r.id, label: (r.name || '本土語言教室') + r.no, langs: r.langs })
  }

  const gradeZh = ['', '一', '二', '三', '四', '五', '六']
  const sessions: DerivedNativeSession[] = []
  for (const c of extraCourses) {
    if (!c.lang) continue
    const g = c.grade
    // 該語別×年級的老師（依配課節數展開；科目名＝語別名）
    const exp: string[] = []
    for (const [tid, m] of Object.entries(hoursByTeacher)) {
      const h = Number(m[c.lang]?.[String(g)]) || 0
      for (let i = 0; i < h; i++) exp.push(tid)
    }
    if (c.hours > 0 && exp.length !== c.hours) {
      issues.push({
        level: 'warn',
        text: `「${c.lang}」${gradeZh[g]}年級已配 ${exp.length} 節／需求 ${c.hours} 節${exp.length < c.hours ? '——差額請於配課統計建立虛擬帳號補足' : '（超配）'}。`,
        href: '/admin/allocation-statistics',
      })
    }
    if (exp.length === 0 && c.hours === 0) continue
    // 每個本土語時段都是一個候選場次（該時段各班選此語別的學生集合上課）；狀態由課務組定：
    //   實體＝老師到校開課／線上＝老師線上授課（皆耗 1 節配課）／不開＝此時段沒有該語別學生（不耗）
    const slots = gradeSlots[g] ?? []
    const list: DerivedNativeSession[] = slots.map(sl => ({
      slot: sl, course: c.lang, lang: c.lang, grade: g, teacherId: '', roomId: null,
      state: config.nativeLang.states[`${sl}|${c.lang}|${g}`] ?? 'physical',
    }))
    // 老師配給開課場次（實體＋線上）：課務組指定者優先（該師該語別該年級尚有節數才生效），其餘依剩餘節數自動配
    const remain: Record<string, number> = {}
    for (const tid of exp) remain[tid] = (remain[tid] ?? 0) + 1
    const physicalList = list.filter(s => s.state !== 'cancelled')
    for (const s of physicalList) {
      const want = config.nativeLang.teachers[`${s.slot}|${c.lang}|${g}`]
      if (want && (remain[want] ?? 0) > 0) { s.teacherId = want; remain[want]-- }
    }
    for (const s of physicalList) {
      if (s.teacherId) continue
      const tid = Object.keys(remain).find(t => remain[t] > 0)
      if (tid) { s.teacherId = tid; remain[tid]-- }
    }
    sessions.push(...list)
    const active = physicalList.length
    if (slots.length > 0 && active !== exp.length) {
      const where = physicalList.map(s => { const { day, period } = parseSlotKey(s.slot); return `${DAY_LABEL[day]}第${period}節` }).join('、')
      issues.push({
        level: 'warn',
        text: active > exp.length
          ? `「${c.lang}」${gradeZh[g]}年級配課 ${exp.length} 節，但開課場次有 ${active} 場（${where}）——請到「6 本土語場次」把沒有該語別學生的時段設為「不開」，或補配課節數。`
          : `「${c.lang}」${gradeZh[g]}年級配課 ${exp.length} 節，但開課場次只有 ${active} 場——多配的節數沒有場次可上，請把某個時段改回「實體／線上」或減少配課。`,
        tab: 'native',
      })
    }
  }

  // 教室分配（不開的場次不占教室）：課務組指定者優先（該教室可排此語別、該時段未被占才生效），其餘自動配
  const taken = new Map<string, Set<string>>()
  const canUse = (r: { id: string; langs: string[] }, s: DerivedNativeSession) =>
    (r.langs.length === 0 || r.langs.includes(s.lang)) && !(taken.get(s.slot)?.has(r.id))
  const occupy = (s: DerivedNativeSession, id: string) => { s.roomId = id; (taken.get(s.slot) ?? taken.set(s.slot, new Set()).get(s.slot)!).add(id) }
  const active = sessions.filter(s => s.state !== 'cancelled')
  for (const s of active) {
    const want = config.nativeLang.rooms[`${s.slot}|${s.lang}|${s.grade}`]
    const room = want ? nativeRooms.find(r => r.id === want) : undefined
    if (room && canUse(room, s)) occupy(s, room.id)
  }
  for (const s of active) {
    if (s.roomId) continue
    const room = nativeRooms.find(r => canUse(r, s))
    if (room) occupy(s, room.id)
    else issues.push({ level: 'warn', text: `本土語言教室不足：${s.slot} 的「${s.course}」分不到教室（檢查教室數與可排語別）。`, tab: 'room' })
  }

  return { sessions, issues }
}

/** 取一個年段時段格中所有可排課的 slotKey（依星期、節次排序）。 */
export function gridSlotKeys(grid: BandGrid): string[] {
  const out: string[] = []
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) {
    if (grid.teachable[`${d}-${p}`]) out.push(`${d}-${p}`)
  }
  return out
}

// ── 班級 / 課 ──
export interface ClassRef { grade: number; index: number }   // index 0-based
export function classKey(grade: number, index: number): string { return `${grade}-${index}` }
export function classLabel(grade: number, index: number): string { return `${grade}年${index + 1}班` }

/** 科任平均分配：把某年級某科的各班，平均分給有配該科該年級的科任。
 *  teachers: 該科該年級的科任，hours = 其 subjectGradeHours[subject][grade]。
 *  回傳 classIndex → 老師（容量 = floor(hours / perClass)）；容量不足的班回傳 null（未指派）。
 */
export function distributeClasses(
  classCount: number, perClass: number,
  teachers: { id: string; name: string; hours: number }[],
): (({ id: string; name: string }) | null)[] {
  const result: (({ id: string; name: string }) | null)[] = new Array(classCount).fill(null)
  if (perClass <= 0) return result
  // 依容量展開成「班級配額」佇列，老師依序認領班級
  const queue: { id: string; name: string }[] = []
  for (const t of teachers) {
    const cap = Math.floor((Number(t.hours) || 0) / perClass)
    for (let i = 0; i < cap; i++) queue.push({ id: t.id, name: t.name })
  }
  for (let c = 0; c < classCount; c++) result[c] = queue[c] ?? null
  return result
}

// ── 排課演算法 ──

/** 一節待排的課（某班某科一節，已指定老師）。 */
export interface Lesson { classKey: string; subject: string; teacherId: string; teacherName: string }

export interface PlanInput {
  classKeys: string[]                                   // 要排的班（該年段）
  slotKeys: string[]                                    // 可排課時段（年段時段格）
  lessons: Lesson[]                                     // 全部待排節（每節一筆）
  classBlocked: Record<string, Set<string>>             // classKey → 封鎖 slotKey（班級封鎖＋固定占用）
  teacherBlocked: Record<string, Set<string>>           // teacherId → 封鎖 slotKey（不排課＋共同時段）
}

export interface PlacedLesson { classKey: string; slot: Slot; subject: string; teacherId: string; teacherName: string }
export interface UnplacedLesson { classKey: string; subject: string; teacherId: string; teacherName: string; count: number }
export interface PlanResult { placed: PlacedLesson[]; unplaced: UnplacedLesson[] }

/**
 * 貪婪排課：
 *  1. 先排「最難排」的課（老師越忙、待排越多者越先排），降低後段卡死機率。
 *  2. 每節找一個格子，需同時滿足：該班該時段空 + 該老師該時段空 + 非封鎖。
 *  3. 軟限制：同班同科盡量不排在同一天（優先選該科尚未用過的星期）。
 *  4. 排不進 → 計入未排清單。
 */
export function planSchedule(input: PlanInput): PlanResult {
  const { slotKeys, classBlocked, teacherBlocked } = input

  // 已占用：classKey → Set<slotKey>、teacherId → Set<slotKey>
  const classBusy: Record<string, Set<string>> = {}
  const teacherBusy: Record<string, Set<string>> = {}
  for (const ck of input.classKeys) classBusy[ck] = new Set(classBlocked[ck] ?? [])
  // 同班同科已用過的星期：`${classKey}|${subject}` → Set<day>
  const subjDays: Record<string, Set<number>> = {}

  const tBlocked = (id: string) => teacherBlocked[id] ?? new Set<string>()
  const tBusy = (id: string) => (teacherBusy[id] ??= new Set<string>())

  // 老師總負擔（越忙越先排）
  const load: Record<string, number> = {}
  for (const l of input.lessons) load[l.teacherId] = (load[l.teacherId] || 0) + 1
  const lessons = [...input.lessons].sort((a, b) => (load[b.teacherId] - load[a.teacherId]))

  const placed: PlacedLesson[] = []
  const unplacedMap: Record<string, UnplacedLesson> = {}

  for (const l of lessons) {
    const cBusy = classBusy[l.classKey] ?? (classBusy[l.classKey] = new Set())
    const tb = tBlocked(l.teacherId), tu = tBusy(l.teacherId)
    const usedDays = (subjDays[`${l.classKey}|${l.subject}`] ??= new Set())

    // 候選格子：班空 + 老師空（未封鎖、未占用）
    const candidates = slotKeys.filter(k => {
      if (cBusy.has(k)) return false
      if (tb.has(k) || tu.has(k)) return false
      return true
    })
    if (candidates.length === 0) {
      const key = `${l.classKey}|${l.subject}|${l.teacherId}`
      ;(unplacedMap[key] ??= { classKey: l.classKey, subject: l.subject, teacherId: l.teacherId, teacherName: l.teacherName, count: 0 }).count++
      continue
    }
    // 軟限制：優先選該科尚未用過的星期
    const fresh = candidates.filter(k => !usedDays.has(parseSlotKey(k).day))
    const pick = (fresh.length ? fresh : candidates)[0]
    const slot = parseSlotKey(pick)

    cBusy.add(pick); tu.add(pick); usedDays.add(slot.day)
    placed.push({ classKey: l.classKey, slot, subject: l.subject, teacherId: l.teacherId, teacherName: l.teacherName })
  }

  return { placed, unplaced: Object.values(unplacedMap) }
}
