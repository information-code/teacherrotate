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

// ── 時間軸工具 ──────────────────────────────────────────────

export interface TimelineSegment {
  work: string
  count: number
  from: number
  to: number
}

/** 將工作紀錄轉為「連續同工作」段落 */
export function buildTimeline(rotations: { year: number; work: string }[]): TimelineSegment[] {
  if (rotations.length === 0) return []
  const sorted = [...rotations].sort((a, b) => a.year - b.year)
  const segments: TimelineSegment[] = []
  let curWork = sorted[0].work
  let count = 1
  let from = sorted[0].year
  let to = sorted[0].year
  for (let i = 1; i < sorted.length; i++) {
    const { year, work } = sorted[i]
    if (work === curWork) {
      count++
      to = year
    } else {
      segments.push({ work: curWork, count, from, to })
      curWork = work
      count = 1
      from = year
      to = year
    }
  }
  segments.push({ work: curWork, count, from, to })
  return segments
}

export type WorkCategory = '中低年級' | '高年級' | '行政' | '科任' | '留停'

export function getWorkCategory(work: string): WorkCategory {
  if (work.includes('主任') || work.includes('組長')) return '行政'
  if (work.includes('高年級')) return '高年級'
  if (work.includes('中年級') || work.includes('低年級')) return '中低年級'
  if (work.includes('科任')) return '科任'
  return '留停'
}

export const CATEGORY_STYLE: Record<WorkCategory, string> = {
  '中低年級': 'bg-zinc-700 text-white border-zinc-700',
  '高年級':   'bg-zinc-100 text-zinc-800 border-zinc-400',
  '行政':     'bg-amber-50 text-amber-800 border-amber-400',
  '科任':     'bg-zinc-50  text-zinc-600  border-zinc-300',
  '留停':     'bg-white    text-zinc-400  border-zinc-200 border-dashed',
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
