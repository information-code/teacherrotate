import { getAdminClient } from '@/lib/supabase/admin'
import { getWorkSortOrder, buildTimeline, type TimelineSegment } from '@/lib/work-sort'
import { getRotationTarget, type RotationTarget } from '@/lib/rotation-target'
import StatisticsClient from './StatisticsClient'

export const dynamic = 'force-dynamic'

interface StatRow {
  work: string
  pref1: number
  pref2: number
  pref3: number
  total: number
}

export interface TeacherEval {
  id: string
  name: string
  pref1: string | null
  pref2: string | null
  pref3: string | null
  score: number
  currentWork: string | null
  midLowConsecutiveYears: number
  timeline: TimelineSegment[]
  targetType: RotationTarget
}

const SKIP_WORKS = ['留職停薪', '育嬰留停', '借調', '延長病假']
const MIDLOW_GROUP = '中低年級導師'

/** 計算教師連續擔任中低年級導師的年數（留停不中斷但不計入） */
function getMidLowConsecutiveYears(
  rotations: { year: number; work: string }[],
  groupMap: Record<string, string>
): number {
  const sorted = [...rotations].sort((a, b) => b.year - a.year)
  let count = 0
  for (const r of sorted) {
    const core = r.work.replace(/\(.*?\)/g, '').trim()
    if (SKIP_WORKS.includes(core)) continue
    if ((groupMap[core] ?? core) === MIDLOW_GROUP) count++
    else break
  }
  return count
}

export default async function StatisticsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const admin = getAdminClient()
  const params = await searchParams

  // 讀「目前開放填寫年度」與 preferences 中所有出現過的年度
  const [settingsResult, prefYearsResult] = await Promise.all([
    admin.from('settings').select('key, value').eq('key', 'preference_year').single(),
    admin.from('preferences').select('year'),
  ])
  const currentYear = Number(settingsResult.data?.value ?? 115)
  const distinctYears = Array.from(new Set((prefYearsResult.data ?? []).map(r => r.year))).sort((a, b) => b - a)
  // 確保 currentYear 在清單裡（即使目前還沒人填）
  const availableYears = distinctYears.includes(currentYear) ? distinctYears : [currentYear, ...distinctYears]
  const viewYear = Number(params.year ?? currentYear)
  const isCurrent = viewYear === currentYear

  // 先取在職教師 ID
  const { data: activeProfiles } = await admin
    .from('profiles').select('id, name').neq('status', 'inactive')
  const activeIds = (activeProfiles ?? []).map(p => p.id)

  const [prefsResult, scoresResult, rotationsResult, scoremapResult] = await Promise.all([
    activeIds.length > 0
      ? admin.from('preferences')
          .select('teacher_id, preference1, preference2, preference3')
          .in('teacher_id', activeIds)
          .eq('year', viewYear)
      : Promise.resolve({ data: [] }),
    admin.from('scores').select('teacher_id, recent_four_year_total').not('recent_four_year_total', 'is', null),
    activeIds.length > 0
      ? admin.from('rotations').select('teacher_id, year, work').in('teacher_id', activeIds).order('year', { ascending: false })
      : Promise.resolve({ data: [] }),
    admin.from('scoremap').select('work, group_name'),
  ])

  // 建立 groupMap（work → group_name）
  const groupMap: Record<string, string> = {}
  for (const row of scoremapResult.data ?? []) {
    if (row.group_name) groupMap[row.work] = row.group_name
  }

  // 每位教師的工作紀錄（分組）
  const teacherRotations: Record<string, { year: number; work: string }[]> = {}
  for (const r of rotationsResult.data ?? []) {
    if (!teacherRotations[r.teacher_id]) teacherRotations[r.teacher_id] = []
    teacherRotations[r.teacher_id].push({ year: r.year, work: r.work })
  }

  // 計算每位教師的目標類別（依最新一筆 rotation 判定）
  const targetMap: Record<string, RotationTarget | null> = {}
  for (const id of activeIds) {
    targetMap[id] = getRotationTarget(teacherRotations[id] ?? [])
  }

  // 只有當前年度才套用「需填志願」過濾與評估面板；歷史年度直接統計該年度所有志願
  const filterIds: Set<string> | null = isCurrent
    ? new Set(activeIds.filter(id => targetMap[id] !== null))
    : null

  // 取各教師最新職位
  const currentWorkMap: Record<string, string> = {}
  for (const [id, rots] of Object.entries(teacherRotations)) {
    const sorted = [...rots].sort((a, b) => b.year - a.year)
    currentWorkMap[id] = sorted[0]?.work ?? ''
  }

  // 統計志願
  const stats: Record<string, { pref1: number; pref2: number; pref3: number }> = {}
  for (const p of prefsResult.data ?? []) {
    if (filterIds && !filterIds.has(p.teacher_id)) continue
    const fields = [
      { value: p.preference1, rank: 'pref1' as const },
      { value: p.preference2, rank: 'pref2' as const },
      { value: p.preference3, rank: 'pref3' as const },
    ]
    for (const { value, rank } of fields) {
      if (!value) continue
      if (!stats[value]) stats[value] = { pref1: 0, pref2: 0, pref3: 0 }
      stats[value][rank]++
    }
  }
  const result: StatRow[] = Object.entries(stats)
    .map(([work, counts]) => ({
      work,
      pref1: counts.pref1,
      pref2: counts.pref2,
      pref3: counts.pref3,
      total: counts.pref1 + counts.pref2 + counts.pref3,
    }))
    .sort((a, b) => b.total - a.total || getWorkSortOrder(a.work) - getWorkSortOrder(b.work))

  // 建立評估資料（只有當前年度使用）
  const profileMap = Object.fromEntries((activeProfiles ?? []).map(p => [p.id, p.name ?? '']))
  const scoreMap: Record<string, number> = {}
  for (const s of scoresResult.data ?? []) {
    const cur = scoreMap[s.teacher_id] ?? -Infinity
    if ((s.recent_four_year_total ?? 0) > cur) {
      scoreMap[s.teacher_id] = s.recent_four_year_total ?? 0
    }
  }

  const prefMap = Object.fromEntries(
    (prefsResult.data ?? []).map(p => [p.teacher_id, p])
  )

  const teachers: TeacherEval[] = filterIds
    ? [...filterIds].map(id => {
        const pref = prefMap[id]
        return {
          id,
          name: profileMap[id] ?? id,
          pref1: pref?.preference1 ?? null,
          pref2: pref?.preference2 ?? null,
          pref3: pref?.preference3 ?? null,
          score: scoreMap[id] ?? 0,
          currentWork: currentWorkMap[id] ?? null,
          midLowConsecutiveYears: getMidLowConsecutiveYears(teacherRotations[id] ?? [], groupMap),
          timeline: buildTimeline(teacherRotations[id] ?? []),
          targetType: targetMap[id]!,
        }
      })
    : []

  // 中低年級導師組的職位清單（用於 client 端拖拉驗證）
  const midLowWorks = new Set(
    (scoremapResult.data ?? [])
      .filter(r => r.group_name === MIDLOW_GROUP)
      .map(r => r.work)
  )

  return (
    <StatisticsClient
      initialStats={result}
      initialTeachers={teachers}
      midLowWorks={[...midLowWorks]}
      currentYear={currentYear}
      viewYear={viewYear}
      availableYears={availableYears}
      isCurrent={isCurrent}
    />
  )
}
