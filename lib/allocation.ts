// 配課（course allocation）共用型別與邏輯。Stage 2 設定頁、Stage 3 教師端、
// Stage 4 統計頁共用。設定整體存於 allocation_config.config（每年度一筆 JSON）。

export const GRADES = [1, 2, 3, 4, 5, 6] as const
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
  subjects: { name: string; perClass: number }[]  // 各科每班基本節數（→ 需求 = classCount × perClass）
  homeroomBase: number                        // 該年級導師基本授課節數
  scenarios: Record<Reduction, GradeScenario>
}

/** 整年度配課設定 */
export interface AllocationConfig {
  grades: Record<number, GradeConfig>   // 1..6
  subjectBase: number                   // 科任基本授課節數
  adminBase: number                     // 行政基本授課節數
}

const DEFAULT_SUBJECTS = ['國語', '數學', '英語', '生活', '健康', '綜合', '本土語', '班級活動']

export function defaultGradeConfig(): GradeConfig {
  return {
    classCount: 0,
    subjects: DEFAULT_SUBJECTS.map(name => ({ name, perClass: 0 })),
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
  for (const g of GRADES) grades[g] = defaultGradeConfig()
  return { grades, subjectBase: 0, adminBase: 0 }
}

/** 合併資料庫讀回的（可能不完整的）config 與預設值，確保結構完整。 */
export function normalizeConfig(raw: unknown): AllocationConfig {
  const base = defaultAllocationConfig()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<AllocationConfig>
  const out: AllocationConfig = {
    subjectBase: Number(r.subjectBase ?? 0),
    adminBase: Number(r.adminBase ?? 0),
    grades: {},
  }
  for (const g of GRADES) {
    const rg = r.grades?.[g]
    const dg = base.grades[g]
    out.grades[g] = rg
      ? {
          classCount: Number(rg.classCount ?? 0),
          subjects: Array.isArray(rg.subjects) && rg.subjects.length
            ? rg.subjects.map(s => ({ name: String(s.name ?? ''), perClass: Number(s.perClass ?? 0) }))
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
