// 撕榜面板的空缺定義與「槽位 → 工作紀錄」對應。
// 從 SelectionPanelClient 抽出，讓伺服器端（套用到工作紀錄）與前端共用同一份來源。

// 行政空缺：固定 4 處，每職位 1 個位置
export const ADMIN_GROUPS: { 處: string; positions: string[] }[] = [
  { 處: '教務處', positions: ['教務主任', '註冊組長', '課務組長', '課發組長', '資訊組長'] },
  { 處: '學務處', positions: ['學務主任', '生教組長', '體健組長', '活動組長', '環衛組長'] },
  { 處: '總務處', positions: ['總務主任', '文書組長'] },
  { 處: '輔導處', positions: ['輔導主任', '輔導組長', '親職組長', '特教組長'] },
]

// 科任 領域（admin 輸入各領域名額）
export const SUBJECT_AREAS = ['科技創新任務', '體育', '英語', '社會', '自然', '音樂', '表藝', '視藝', '生活', '其他']

// 科任領域 → scoremap 中對應的科任職位名（音樂/表藝/視藝皆歸「藝術領域科任」）
export const SUBJECT_AREA_TO_WORK: Record<string, string> = {
  '科技創新任務': '科技創新任務科任',
  '體育': '體育領域科任',
  '英語': '英語領域科任',
  '社會': '社會領域科任',
  '自然': '自然領域科任',
  '音樂': '藝術領域科任',
  '表藝': '藝術領域科任',
  '視藝': '藝術領域科任',
  '生活': '生活課程科任',
  '其他': '其他領域科任',
}

// 導師空缺：六個年級各自獨立
//   一/三/五年級 = 一般導師（新一輪開始）
//   二/四/六年級 = 接棒班（接續上一位導師、把學生帶到一輪結束）
export interface HomeroomSlot {
  grade: 1 | 2 | 3 | 4 | 5 | 6
  kind: 'normal' | 'relay'
  work: string         // 對應 scoremap 中的職位名
  label: string        // 顯示用：「一年級」、「二年級接棒班」…
  shortLabel: string   // 列首顯示：「一年級」、「二年級」…
}

export const HOMEROOM_SLOTS: HomeroomSlot[] = [
  { grade: 1, kind: 'normal', work: '低年級導師', label: '低年級導師',  shortLabel: '一年級' },
  { grade: 2, kind: 'relay',  work: '低年級接棒班', label: '低年級接棒班', shortLabel: '二年級' },
  { grade: 3, kind: 'normal', work: '中年級導師', label: '中年級導師',  shortLabel: '三年級' },
  { grade: 4, kind: 'relay',  work: '中年級接棒班', label: '中年級接棒班', shortLabel: '四年級' },
  { grade: 5, kind: 'normal', work: '高年級導師', label: '高年級導師',  shortLabel: '五年級' },
  { grade: 6, kind: 'relay',  work: '高年級接棒班', label: '高年級接棒班', shortLabel: '六年級' },
]

// quota 輸入時的成對排版：(grade1 + grade2), (grade3 + grade4), (grade5 + grade6)
export const HOMEROOM_INPUT_PAIRS: { normal: HomeroomSlot; relay: HomeroomSlot }[] = [
  { normal: HOMEROOM_SLOTS[0], relay: HOMEROOM_SLOTS[1] },
  { normal: HOMEROOM_SLOTS[2], relay: HOMEROOM_SLOTS[3] },
  { normal: HOMEROOM_SLOTS[4], relay: HOMEROOM_SLOTS[5] },
]

export interface Quotas {
  subjects: Record<string, number>
  homerooms: Record<number, number>  // grade 1..6 → count
}

export const DEFAULT_QUOTAS: Quotas = {
  subjects: Object.fromEntries(SUBJECT_AREAS.map(a => [a, 0])),
  homerooms: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
}

export const MIDLOW_LIMIT = 8

// 科任領域顯示名稱：除「科技創新任務」與「其他」外，其餘都加「領域」
export function subjectDisplayLabel(area: string): string {
  return (area === '科技創新任務' || area === '其他') ? area : `${area}領域`
}

/**
 * 把撕榜槽位 id 轉成要寫進 rotations 的 { work, grade }。
 *   grade-{g}-{i}    → 導師：work 取自 HOMEROOM_SLOTS、grade=g
 *   subject-{area}-{i} → 科任：work 取自 SUBJECT_AREA_TO_WORK、grade=null
 *   admin-{pos}      → 行政：work=pos、grade=null
 * 無法辨識回 null。
 */
export function slotToRotation(slotId: string): { work: string; grade: number | null } | null {
  let m = slotId.match(/^grade-(\d+)-\d+$/)
  if (m) {
    const g = Number(m[1])
    const slot = HOMEROOM_SLOTS.find(s => s.grade === g)
    return slot ? { work: slot.work, grade: g } : null
  }
  m = slotId.match(/^subject-(.+)-\d+$/)
  if (m) {
    const area = m[1]
    return { work: SUBJECT_AREA_TO_WORK[area] ?? `${area}領域科任`, grade: null }
  }
  m = slotId.match(/^admin-(.+)$/)
  if (m) return { work: m[1], grade: null }
  return null
}
