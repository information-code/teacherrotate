import { getAdminClient } from '@/lib/supabase/admin'
import { getRotationTarget, type RotationTarget } from '@/lib/rotation-target'
import { buildTimeline, type TimelineSegment } from '@/lib/work-sort'
import SelectionPanelClient from './SelectionPanelClient'

export const dynamic = 'force-dynamic'

export interface PanelTeacher {
  id: string
  name: string
  pref1: string | null
  pref2: string | null
  pref3: string | null
  score: number
  currentWork: string | null
  targetType: RotationTarget
  midLowConsecutiveYears: number
  timeline: TimelineSegment[]
  prefLocked: boolean
  prefGiveUp: boolean
}

const SKIP_WORKS = ['留職停薪', '育嬰留停', '借調', '延長病假']
const MIDLOW_GROUP = '中低年級導師'

function midLowConsecutive(
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

export default async function SelectionPanelPage() {
  const admin = getAdminClient()

  const [{ data: activeProfiles }, { data: settingsRows }, { data: scoremapRows }] = await Promise.all([
    admin.from('profiles').select('id, name').neq('status', 'inactive'),
    admin.from('settings').select('value').eq('key', 'preference_year'),
    admin.from('scoremap').select('work, group_name'),
  ])

  const preferenceYear = Number(settingsRows?.[0]?.value ?? 115)
  const activeIds = (activeProfiles ?? []).map(p => p.id)
  const profileMap = Object.fromEntries((activeProfiles ?? []).map(p => [p.id, p.name ?? '']))

  const groupMap: Record<string, string> = {}
  for (const row of scoremapRows ?? []) {
    if (row.group_name) groupMap[row.work] = row.group_name
  }
  const midLowWorks = (scoremapRows ?? []).filter(r => r.group_name === MIDLOW_GROUP).map(r => r.work)

  const [prefsResult, scoresResult, rotationsResult] = await Promise.all([
    activeIds.length > 0
      ? admin.from('preferences')
          .select('teacher_id, preference1, preference2, preference3, locked, give_up')
          .in('teacher_id', activeIds).eq('year', preferenceYear)
      : Promise.resolve({ data: [] as { teacher_id: string; preference1: string | null; preference2: string | null; preference3: string | null; locked: boolean; give_up: boolean }[] }),
    admin.from('scores').select('teacher_id, recent_four_year_total').not('recent_four_year_total', 'is', null),
    activeIds.length > 0
      ? admin.from('rotations').select('teacher_id, year, work, grade').in('teacher_id', activeIds).order('year', { ascending: false })
      : Promise.resolve({ data: [] as { teacher_id: string; year: number; work: string; grade: number | null }[] }),
  ])

  const teacherRotations: Record<string, { year: number; work: string; grade: number | null }[]> = {}
  for (const r of rotationsResult.data ?? []) {
    if (!teacherRotations[r.teacher_id]) teacherRotations[r.teacher_id] = []
    teacherRotations[r.teacher_id].push({ year: r.year, work: r.work, grade: r.grade ?? null })
  }

  const targetMap: Record<string, RotationTarget | null> = {}
  for (const id of activeIds) {
    targetMap[id] = getRotationTarget(teacherRotations[id] ?? [])
  }

  const currentWorkMap: Record<string, string> = {}
  for (const [id, rots] of Object.entries(teacherRotations)) {
    const sorted = [...rots].sort((a, b) => b.year - a.year)
    currentWorkMap[id] = sorted[0]?.work ?? ''
  }

  const scoreMap: Record<string, number> = {}
  for (const s of scoresResult.data ?? []) {
    const cur = scoreMap[s.teacher_id] ?? -Infinity
    if ((s.recent_four_year_total ?? 0) > cur) {
      scoreMap[s.teacher_id] = s.recent_four_year_total ?? 0
    }
  }

  const prefMap = Object.fromEntries((prefsResult.data ?? []).map(p => [p.teacher_id, p]))

  const teachers: PanelTeacher[] = activeIds
    .filter(id => targetMap[id] !== null)
    .map(id => {
      const pref = prefMap[id]
      return {
        id,
        name: profileMap[id] ?? id,
        pref1: pref?.preference1 ?? null,
        pref2: pref?.preference2 ?? null,
        pref3: pref?.preference3 ?? null,
        score: scoreMap[id] ?? 0,
        currentWork: currentWorkMap[id] ?? null,
        targetType: targetMap[id]!,
        midLowConsecutiveYears: midLowConsecutive(teacherRotations[id] ?? [], groupMap),
        timeline: buildTimeline(teacherRotations[id] ?? []),
        prefLocked: pref?.locked ?? false,
        prefGiveUp: pref?.give_up ?? false,
      }
    })
    .sort((a, b) => b.score - a.score)

  return (
    <SelectionPanelClient
      teachers={teachers}
      midLowWorks={midLowWorks}
      preferenceYear={preferenceYear}
    />
  )
}
