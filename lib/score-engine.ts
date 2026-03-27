/**
 * 分數計算引擎
 * 從原 Google AppScript 邏輯移植，計算教師歷年輪動分數
 */

export type Rotation = { year: number; work: string }
export type ScoreMapRow = {
  work: string
  year1: number; year2: number; year3: number; year4: number
  year5: number; year6: number; year7: number; year8: number
  group_name: string | null
}
// workName -> [score_year1, score_year2, ..., score_year8]
export type ScoreMap = Record<string, number[]>
// workName -> group_name (若有)
export type GroupMap = Record<string, string>
export type YearScores = Record<number, number>

const SKIP_WORKS = ['留職停薪', '育嬰留停', '借調']

// 中低年級導師自動轉換偵測的組別名稱
const MIDLOW_GROUP = '中低年級導師'

/** 從 scoremap DB rows 建立 ScoreMap 與 GroupMap */
export function buildScoreMaps(rows: ScoreMapRow[]): { scoreMap: ScoreMap; groupMap: GroupMap } {
  const scoreMap: ScoreMap = {}
  const groupMap: GroupMap = {}
  for (const row of rows) {
    scoreMap[row.work] = [row.year1, row.year2, row.year3, row.year4, row.year5, row.year6, row.year7, row.year8]
    if (row.group_name) groupMap[row.work] = row.group_name
  }
  return { scoreMap, groupMap }
}

/** 取得職位的分組名稱（有 groupMap 時用 group_name，否則用職位本身） */
function getGroup(work: string, groupMap: GroupMap): string {
  return groupMap[work] ?? work
}

/**
 * 計算單一教師的歷年分數
 * @param rotations          按年度升序排列的工作紀錄
 * @param scoreMap           工作 -> [8個年資分數]
 * @param groupMap           工作 -> 分組名稱
 * @param midLowSwitchScore  中低年級連續5年後轉換所得分數（預設 2）
 */
export function calculateTeacherScores(
  rotations: Rotation[],
  scoreMap: ScoreMap,
  groupMap: GroupMap = {},
  midLowSwitchScore: number = 2
): YearScores {
  const sorted = [...rotations].sort((a, b) => a.year - b.year)
  let prevGroup = ''
  let prevWork = ''
  let count = 0
  const scores: YearScores = {}

  for (const { year, work } of sorted) {
    if (!work) continue

    const coreRole = work.replace(/\(.*?\)/g, '').trim()

    if (SKIP_WORKS.includes(coreRole)) {
      scores[year] = 0
      // 留停不重置 prevGroup / prevWork，年資繼續計算
      continue
    }

    const currentGroup = getGroup(coreRole, groupMap)

    if (currentGroup === prevGroup && prevGroup !== '') {
      count++
    } else {
      count = 1
    }

    let score = 0

    // 中低年級導師轉換獎勵：連續5年以上且本年與上年職務不同
    if (
      count >= 5 &&
      currentGroup === MIDLOW_GROUP &&
      prevWork !== '' &&
      prevWork !== coreRole
    ) {
      score = midLowSwitchScore
    } else {
      const scoreList = scoreMap[coreRole]
      if (scoreList) {
        const idx = Math.min(count, 8) - 1
        const value = Number(scoreList[idx])
        score = isNaN(value) ? 0 : value
      }
    }

    prevGroup = currentGroup
    prevWork = coreRole
    scores[year] = score
  }

  return scores
}

/**
 * 計算近四年加總（取最新四個年度）
 */
export function calcRecentFourYearTotal(scores: YearScores): number {
  const years = Object.keys(scores).map(Number).sort((a, b) => b - a)
  const recentFour = years.slice(0, 4)
  return recentFour.reduce((sum, y) => sum + (scores[y] ?? 0), 0)
}

/**
 * 預估選擇某個志願後下一學年的分數
 */
export function estimatePreferenceScore(
  rotations: Rotation[],
  preferredWork: string,
  scoreMap: ScoreMap,
  groupMap: GroupMap,
  nextYear: number,
  midLowSwitchScore: number = 2
): number {
  const tempRotations: Rotation[] = [
    ...rotations.filter(r => r.year !== nextYear),
    { year: nextYear, work: preferredWork },
  ]
  const scores = calculateTeacherScores(tempRotations, scoreMap, groupMap, midLowSwitchScore)
  return scores[nextYear] ?? 0
}
