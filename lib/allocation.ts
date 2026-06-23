// 配課（course allocation）共用型別與邏輯。Stage 2 設定頁、Stage 3 教師端、
// Stage 4 統計頁共用。設定整體存於 allocation_config.config（每年度一筆 JSON）。

export const GRADES = [1, 2, 3, 4, 5, 6] as const

// 科目顯示順序（必修依課綱，其餘非必修排在後面、維持原順序）
export const SUBJECT_ORDER = ['國語', '數學', '生活', '社會', '自然', '英語', '健康', '體育', '視覺藝術', '表演藝術', '音樂', '綜合', '本土語']

// 導師配課三分類：
//   原則配課（動到→理由提課發會）
export const PRINCIPLE_SUBJECTS = ['國語', '數學', '班級活動', '自主學習']
//   專長配課＝學校有科任的科目（動到→理由給課務組排配課依據）
export const SPECIALTY_SUBJECTS = ['社會', '自然', '英語', '體育', '視覺藝術', '表演藝術', '音樂', '本土語', '專題', '國際教育']
//   其餘（健康、綜合、生活…）為選填配課
export function subjectCategory(name: string): 'principle' | 'specialty' | 'optional' {
  if (PRINCIPLE_SUBJECTS.includes(name)) return 'principle'
  if (SPECIALTY_SUBJECTS.includes(name)) return 'specialty'
  return 'optional'
}
// 需證照科目
export const CERT_SUBJECTS = ['英語', '本土語']
// 超鐘順序的特殊終止選項：選了它代表「清單以外的領域不願意支援」，後面的志願序自動補上同值
export const OVERTIME_REJECT_OTHERS = '其他領域不願意'
export function sortSubjects<T extends { name: string }>(arr: T[]): T[] {
  const known = SUBJECT_ORDER.flatMap(m => arr.filter(s => s.name === m))
  const unknown = arr.filter(s => !SUBJECT_ORDER.includes(s.name))
  return [...known, ...unknown]
}
export function orderSubjectNames(names: string[]): string[] {
  const known = SUBJECT_ORDER.filter(m => names.includes(m))
  const unknown = names.filter(n => !SUBJECT_ORDER.includes(n))
  return [...known, ...unknown]
}
export const GRADE_LABEL: Record<number, string> = {
  1: '一年級', 2: '二年級', 3: '三年級', 4: '四年級', 5: '五年級', 6: '六年級',
}

// 減課情境（政府給的減課節數）
export type Reduction = 0 | 1 | 2
export const REDUCTIONS: Reduction[] = [0, 1, 2]
export const REDUCTION_LABEL: Record<Reduction, string> = {
  0: '無減課', 1: '減1節', 2: '減2節',
}

/** 行政提供的一個配課方案：科目 → 節數 */
export interface AllocationPlan {
  name: string
  alloc: Record<string, number>
}

/** 某年級某情境（減課版本）的設定 */
export interface GradeScenario {
  enabled: boolean
  plans: AllocationPlan[]
}

/** 某年級的設定 */
export interface GradeConfig {
  classCount: number                          // 班級數
  // 各科每班基本節數（→ 需求 = classCount × perClass）。homeroom=false 的科目只算需求，
  // 不出現在導師的配課選填（例如國際教育/專題/其它，由科任或特殊安排）。
  subjects: { name: string; perClass: number; homeroom: boolean }[]
  homeroomBase: number                        // 該年級導師基本授課節數
  scenarios: Record<Reduction, GradeScenario>
}

/** 行政基本授課節數（再細分校長/主任/組長） */
export interface AdminBase {
  principal: number   // 校長
  director: number    // 主任
  chief: number       // 組長
}

/** 整年度配課設定 */
export interface AllocationConfig {
  grades: Record<number, GradeConfig>   // 1..6
  subjectBase: number                   // 科任基本授課節數
  adminBase: AdminBase                  // 行政基本授課節數（校長/主任/組長）
}

// 各年級必修課（前端預設）。低年級(1-2) 有「生活」、無社會/自然/英語；
// 中高年級(3-6) 有社會/自然/英語、無生活。其餘共同必修各年級皆有。
// homeroom 預設 true（導師可配）；科任授課的科目請於「配課設定」取消勾選。
function defaultSubjectsFor(grade: number): string[] {
  return grade <= 2
    ? ['國語', '數學', '生活', '健康', '體育', '本土語']
    : ['國語', '數學', '社會', '自然', '英語', '健康', '體育', '視覺藝術', '表演藝術', '音樂', '綜合', '本土語']
}

export function defaultGradeConfig(grade: number): GradeConfig {
  return {
    classCount: 0,
    subjects: defaultSubjectsFor(grade).map(name => ({ name, perClass: 0, homeroom: true })),
    homeroomBase: 0,
    scenarios: {
      0: { enabled: true, plans: [] },
      1: { enabled: false, plans: [] },
      2: { enabled: false, plans: [] },
    },
  }
}

export function defaultAllocationConfig(): AllocationConfig {
  const grades: Record<number, GradeConfig> = {}
  for (const g of GRADES) grades[g] = defaultGradeConfig(g)
  return { grades, subjectBase: 0, adminBase: { principal: 0, director: 0, chief: 0 } }
}

/** 合併資料庫讀回的（可能不完整的）config 與預設值，確保結構完整。 */
export function normalizeConfig(raw: unknown): AllocationConfig {
  const base = defaultAllocationConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AllocationConfig> & { adminBase?: number | Partial<AdminBase> }
  const ab = r.adminBase
  const adminBase: AdminBase = typeof ab === 'object' && ab !== null
    ? { principal: Number(ab.principal ?? 0), director: Number(ab.director ?? 0), chief: Number(ab.chief ?? 0) }
    : { principal: 0, director: 0, chief: 0 }
  const out: AllocationConfig = {
    subjectBase: Number(r.subjectBase ?? 0),
    adminBase,
    grades: {},
  }
  for (const g of GRADES) {
    const rg = r.grades?.[g]
    const dg = base.grades[g]
    out.grades[g] = rg
      ? {
          classCount: Number(rg.classCount ?? 0),
          subjects: Array.isArray(rg.subjects) && rg.subjects.length
            ? rg.subjects.map(s => ({ name: String(s.name ?? ''), perClass: Number(s.perClass ?? 0), homeroom: s.homeroom !== false }))
            : dg.subjects,
          homeroomBase: Number(rg.homeroomBase ?? 0),
          scenarios: {
            0: normScenario(rg.scenarios?.[0]),
            1: normScenario(rg.scenarios?.[1]),
            2: normScenario(rg.scenarios?.[2]),
          },
        }
      : dg
  }
  return out
}

function normScenario(s: GradeScenario | undefined): GradeScenario {
  if (!s) return { enabled: false, plans: [] }
  return {
    enabled: Boolean(s.enabled),
    plans: Array.isArray(s.plans)
      ? s.plans.map(p => ({ name: String(p.name ?? ''), alloc: { ...(p.alloc ?? {}) } }))
      : [],
  }
}

/** 某年級各科需求總節數 = 班級數 × 每班節數 */
export function gradeDemand(g: GradeConfig): { subject: string; perClass: number; total: number }[] {
  return g.subjects.map(s => ({ subject: s.name, perClass: s.perClass, total: g.classCount * s.perClass }))
}

/** 實際授課節數 = 基本授課節數 − 減課節數 − 專案減課 + 自願超鐘點 */
export function actualPeriods(opts: {
  base: number; reduction: number; projectReduction?: number; extraHours?: number
}): number {
  return opts.base - opts.reduction - (opts.projectReduction ?? 0) + (opts.extraHours ?? 0)
}

/** 一個方案的總節數 */
export function planTotal(plan: AllocationPlan): number {
  return Object.values(plan.alloc).reduce((s, n) => s + (Number(n) || 0), 0)
}

// ── 角色判定（依 rotation 的 work）──
export type AllocRole = 'homeroom' | 'subject' | 'admin' | 'none'
export type AdminKind = 'principal' | 'director' | 'chief'
export const ADMIN_KIND_LABEL: Record<AdminKind, string> = { principal: '校長', director: '主任', chief: '組長' }

/** 導師＝完整配課；科任/行政＝只算節數；其他（留停等）＝無需配課 */
export function allocRole(work: string | null | undefined): AllocRole {
  const w = work ?? ''
  if (!w) return 'none'
  if (w.includes('導師') || w.includes('接棒班')) return 'homeroom'
  if (w.includes('科任')) return 'subject'
  if (w.includes('校長') || w.includes('主任') || w.includes('組長')) return 'admin'
  return 'none'
}

export function adminKind(work: string): AdminKind {
  if (work.includes('校長')) return 'principal'
  if (work.includes('主任')) return 'director'
  return 'chief' // 組長
}
export const ADMIN_KIND_ORDER: Record<AdminKind, number> = { principal: 0, director: 1, chief: 2 }

/** 從科任職稱取領域名：「英語領域科任」→「英語」、「生活課程科任」→「生活」。用於按名稱對應配課科目。 */
export function subjectAreaOf(work: string): string {
  return work.replace(/領域科任$/, '').replace(/課程科任$/, '').replace(/科任$/, '')
}

/**
 * 導師年級由系統決定，不需老師選：
 *   - 撕榜只處理一、三、五年級（grade 已寫入 1/3/5）→ 直接用。
 *   - 其餘為連任，一定是二、四、六年級：低年段→2、中年段→4、高年段→6。
 */
export function homeroomGrade(work: string, grade: number | null): number | null {
  if (grade && grade >= 1 && grade <= 6) return grade
  if (work.includes('低年級')) return 2
  if (work.includes('中年級')) return 4
  if (work.includes('高年級')) return 6
  return null
}

/** 某老師的基本授課節數（依角色）。 */
export function baseForTeacher(config: AllocationConfig, work: string, grade: number | null): number | null {
  const role = allocRole(work)
  if (role === 'homeroom') {
    const g = homeroomGrade(work, grade)
    return g ? (config.grades[g]?.homeroomBase ?? 0) : null
  }
  if (role === 'subject') return config.subjectBase
  if (role === 'admin') return config.adminBase[adminKind(work)]
  return null
}

// 排課需求（移送課發會－排配課會議審議）
export interface SchedulingNeeds {
  officialLeave: boolean              // 公假進修
  counselingGroup: boolean            // 輔導團共同不排課
  avoidChildGrade: boolean            // 避免授課子女班級年段
  avoidChildGradeValue: number | null // 年段 1~6
  other: boolean                      // 其他
  otherText: string                   // 其他說明
}
export function defaultSchedulingNeeds(): SchedulingNeeds {
  return { officialLeave: false, counselingGroup: false, avoidChildGrade: false, avoidChildGradeValue: null, other: false, otherText: '' }
}

// ── 教師配課結果（每年每位老師一筆 JSON）──
export interface ScenarioChoice {
  planName: string | null              // 選的方案名（null = 自配）
  breakdown: Record<string, number>    // 科目 → 節數（僅導師）
  reason?: string                      // 自配時必填理由（供行政參考）
  escalate?: boolean                   // 自配動到原則配課 → 理由提課發會
}
export interface TeacherAllocation {
  role: AllocRole
  work: string
  grade: number | null                 // 導師年級（系統判定）
  projectReduction: number             // 專案減課
  extraHours: number                   // 自願超鐘點
  scenarios: Record<string, ScenarioChoice>  // 導師：各情境（key = "0"/"1"/"2"）的配課
  gradeHours?: Record<string, number>  // 科任：各年級授課節數（單一領域，key = "1".."6"）
  // 代理專用：
  subjects?: string[]                                          // 代理科任複選的授課科目
  subjectGradeHours?: Record<string, Record<string, number>>  // 代理科任：科目 → 年級 → 節數
  // 送出精靈收集（教師層級）：
  projects?: { name: string; hours: number }[]  // 專案減課申請（教師端，可多筆）
  projectOrder?: string[]              // 減課順序（教師端，依優先順序）
  overtimeHours?: number               // 願意超鐘點節數
  overtimeSubjects?: string[]          // 願意超鐘點支援的科目（舊欄位，保留相容）
  overtimeOrder?: string[]             // 願意超鐘點支援科目（依優先順序）
  overtimeApproved?: number            // 管理者事後審核通過的超鐘數
  principleReason?: string             // 動到原則配課的理由（提課發會）
  specialtyReason?: string             // 動到專長配課的理由（課務組排配課依據）
  scheduling?: SchedulingNeeds         // 排課需求（移送課發會審議）
  acknowledged?: boolean               // 已閱讀並同意注意事項
  locked: boolean
  submittedAt: string | null
}

export function defaultTeacherAllocation(role: AllocRole, work: string, grade: number | null): TeacherAllocation {
  return { role, work, grade, projectReduction: 0, extraHours: 0, scenarios: {}, locked: false, submittedAt: null }
}
