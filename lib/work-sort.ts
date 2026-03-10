/**
 * 職位排序與分組工具
 * 順序：校長 > 主任 > 組長 > 高導 > 中導 > 低導 > 科任 > 高接棒 > 中接棒 > 低接棒 > 借調 > 育嬰留停 > 留職停薪
 */
export function getWorkSortOrder(work: string): number {
  if (work.includes('校長'))                               return 0
  if (work.includes('主任'))                               return 100
  if (work.includes('組長'))                               return 200
  if (work.includes('高年級') && !work.includes('接棒'))   return 300
  if (work.includes('中年級') && !work.includes('接棒'))   return 400
  if (work.includes('低年級') && !work.includes('接棒'))   return 500
  if (work.includes('科任'))                               return 600
  if (work.includes('接棒') && work.includes('高'))        return 700
  if (work.includes('接棒') && work.includes('中'))        return 800
  if (work.includes('接棒') && work.includes('低'))        return 900
  if (work.includes('接棒'))                               return 950 // 其他接棒
  if (work.includes('借調'))                               return 1000
  if (work.includes('育嬰留停'))                           return 1100
  if (work.includes('留職停薪'))                           return 1200
  return 550 // 未分類放在科任前
}

export function sortWorks(works: string[]): string[] {
  return [...works].sort((a, b) => getWorkSortOrder(a) - getWorkSortOrder(b))
}

/** STEP1 分組定義 */
export type WorkGroup = { label: string; works: string[] }

export function groupWorks(works: string[]): WorkGroup[] {
  const sorted = sortWorks(works)
  const groups: WorkGroup[] = [
    { label: '行政', works: sorted.filter(w => w.includes('主任') || w.includes('組長') || w.includes('校長')) },
    { label: '導師', works: sorted.filter(w => (w.includes('年級') || w.includes('導師')) && !w.includes('接棒')) },
    { label: '科任', works: sorted.filter(w => w.includes('科任')) },
    { label: '接棒班', works: sorted.filter(w => w.includes('接棒')) },
    { label: '特殊', works: sorted.filter(w => w.includes('借調') || w.includes('留停') || w.includes('留職停薪') || w.includes('育嬰')) },
  ]
  // 未被分類的
  const categorized = new Set(groups.flatMap(g => g.works))
  const others = sorted.filter(w => !categorized.has(w))
  if (others.length > 0) groups.splice(1, 0, { label: '其他', works: others })
  return groups.filter(g => g.works.length > 0)
}
