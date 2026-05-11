/**
 * 判定教師是否屬於「今年要填志願 / 確認分數」的對象，以及屬於哪一類。
 *
 * 規則（依最新一筆 rotation 判定）：
 *   - 含「主任」/「組長」                                → 行政
 *   - 含「接棒班」                                        → 接棒班導師
 *   - 含「科任」                                          → 科任
 *   - 低/中/高年級導師，連續同職次數為「偶數」且 ≥ 2     → 二/四/六年級導師
 *     （連續 2/4/6… 次代表剛帶完一輪 1→2/3→4/5→6，要輪換；
 *       連續 1/3/5… 次代表正帶到 1/3/5 年級，明年才換）
 *   - 留職停薪 / 育嬰留停 / 借調 / 延長病假              → 返回安排
 *   - 其他（含跨組、奇數年首屆、新進無紀錄）              → null（不需填）
 */

export type RotationTarget =
  | '二年級導師'
  | '四年級導師'
  | '六年級導師'
  | '接棒班導師'
  | '科任'
  | '行政'
  | '返回安排'

export const SPECIAL_STATUS = ['留職停薪', '育嬰留停', '借調', '延長病假'] as const

const HOMEROOM_TO_TARGET: Record<string, RotationTarget> = {
  '高年級導師': '六年級導師',
  '中年級導師': '四年級導師',
  '低年級導師': '二年級導師',
}

export function getRotationTarget(
  rotations: { year: number; work: string }[]
): RotationTarget | null {
  if (rotations.length === 0) return null
  const sorted = [...rotations].sort((a, b) => b.year - a.year)
  const w1 = sorted[0].work

  if (w1.includes('主任')) return '行政'
  if (w1.includes('組長')) return '行政'
  if (w1.includes('接棒班')) return '接棒班導師'
  if (w1.includes('科任')) return '科任'

  if (w1 in HOMEROOM_TO_TARGET) {
    // 從最新往回數連續同職的次數，遇到不同職務（含留停/育嬰/借調/延長病假）即中斷
    let streak = 0
    for (const r of sorted) {
      if (r.work === w1) streak++
      else break
    }
    return streak >= 2 && streak % 2 === 0 ? HOMEROOM_TO_TARGET[w1] : null
  }

  if ((SPECIAL_STATUS as readonly string[]).includes(w1)) return '返回安排'

  return null
}

/** 顏色搭配，用於管理者頁面徽章顯示 */
export const TARGET_BADGE_STYLE: Record<RotationTarget, string> = {
  '二年級導師': 'bg-emerald-50 border-emerald-200 text-emerald-700',
  '四年級導師': 'bg-sky-50 border-sky-200 text-sky-700',
  '六年級導師': 'bg-violet-50 border-violet-200 text-violet-700',
  '接棒班導師': 'bg-amber-50 border-amber-200 text-amber-700',
  '科任':       'bg-zinc-50 border-zinc-200 text-zinc-700',
  '行政':       'bg-orange-50 border-orange-200 text-orange-700',
  '返回安排':   'bg-rose-50 border-rose-200 text-rose-700',
}
