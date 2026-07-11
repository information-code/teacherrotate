import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import ScheduleConfigClient from './ScheduleConfigClient'
import {
  normalizeConfig, allocRole, homeroomGrade, subjectAreaOf, GRADES,
  type TeacherAllocation, type AllocRole,
} from '@/lib/allocation'
import { normalizeScheduleConfig } from '@/lib/scheduling'

export const dynamic = 'force-dynamic'

export interface HomeroomTeacher { id: string; name: string; grade: number; gradeGuessed?: boolean }   // gradeGuessed＝工作紀錄年級未填、依職稱暫列

/** 科任配班用：可授課教師（科任／行政）與其配課節數（科目 → 年級 → 節數）。 */
export interface SubjectTeacher {
  id: string
  name: string
  work: string
  role: 'subject' | 'admin'
  hours: Record<string, Record<string, number>>
}

/** 不排課標記用：全體教師（含導師）。 */
export interface OffTeacher { id: string; name: string; work: string; role: AllocRole }

/** 教師於配課精靈申報的排課需求（供個人不排課帶入參考）。 */
export interface NeedsRef {
  teacherId: string
  name: string
  officialLeave: boolean
  officialLeaveUnsure: boolean
  officialLeaveSlots: string[]
  counseling: boolean
  counselingUnsure: boolean
  counselingSlots: string[]
  avoidChildGrades: number[]
  other: boolean
  otherText: string
}

export interface GradeSubject { name: string; perClass: number; homeroom: boolean }

export default async function ScheduleConfigPage({ searchParams }: { searchParams?: { tab?: string } }) {
  await guardPage(['schedule-config'])
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: cfgRow }, { data: schRow }, { data: profiles }] = await Promise.all([
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    // 鐘點教師也列入（配課統計有配節數者可於科任配班指派、可標不排課）
    admin.from('profiles').select('id, name, employment_type').neq('status', 'inactive').neq('role', 'superadmin'),
  ])
  const config = normalizeConfig(cfgRow?.config)
  const scheduleConfig = normalizeScheduleConfig(schRow?.config)

  const ids = (profiles ?? []).map(p => p.id)
  const nameMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))
  const empMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.employment_type]))

  const [{ data: rots }, { data: allocs }] = await Promise.all([
    ids.length ? admin.from('rotations').select('teacher_id, work, grade').eq('year', year).in('teacher_id', ids) : Promise.resolve({ data: [] as { teacher_id: string; work: string; grade: number | null }[] }),
    ids.length ? admin.from('allocation').select('teacher_id, data').eq('year', year).in('teacher_id', ids) : Promise.resolve({ data: [] as { teacher_id: string; data: TeacherAllocation }[] }),
  ])
  const rotMap = Object.fromEntries((rots ?? []).map(r => [r.teacher_id, r]))
  const allocMap = Object.fromEntries((allocs ?? []).map(a => [a.teacher_id, a.data as TeacherAllocation]))

  const homerooms: HomeroomTeacher[] = []
  const subjectTeachers: SubjectTeacher[] = []
  const offTeachers: OffTeacher[] = []
  const needsRefs: NeedsRef[] = []

  for (const id of ids) {
    const name = nameMap[id] ?? id
    const d = allocMap[id]
    // 角色與職務：鐘點/代理看配課資料，正式看工作紀錄
    let role: AllocRole = 'none'
    let work = ''
    let grade: number | null = null
    let gradeGuessed = false   // 工作紀錄年級未填、以職稱推斷（低→2、中→4、高→6）
    if (empMap[id] === 'hourly') {
      role = 'subject'
      work = '鐘點教師'
    } else if (empMap[id] === 'substitute') {
      role = d?.role ?? 'none'
      work = d?.work ?? '代理'
      grade = d?.role === 'homeroom' ? (d.grade ?? null) : null
    } else {
      const rot = rotMap[id]
      work = rot?.work ?? ''
      role = allocRole(work)
      if (role === 'homeroom') {
        grade = homeroomGrade(work, rot?.grade ?? null)
        gradeGuessed = grade !== null && !(rot?.grade && rot.grade >= 1 && rot.grade <= 6)
      }
    }
    if (role === 'none') continue

    offTeachers.push({ id, name, work, role })
    if (role === 'homeroom' && grade) homerooms.push({ id, name, grade, gradeGuessed })

    if (role === 'subject' || role === 'admin') {
      // 配課節數：優先 subjectGradeHours（科目×年級，統計頁可編輯）；
      // 正式單一領域科任若只填 gradeHours，則以職稱領域回推。
      const hours: Record<string, Record<string, number>> = {}
      const sgh = d?.subjectGradeHours
      if (sgh && Object.values(sgh).some(m => Object.values(m ?? {}).some(v => Number(v) > 0))) {
        for (const [subj, m] of Object.entries(sgh)) {
          for (const [g, v] of Object.entries(m ?? {})) {
            if (Number(v) > 0) (hours[subj] ??= {})[g] = Number(v)
          }
        }
      } else if (role === 'subject' && d?.gradeHours) {
        const area = subjectAreaOf(work)
        for (const [g, v] of Object.entries(d.gradeHours)) {
          if (area && Number(v) > 0) (hours[area] ??= {})[g] = Number(v)
        }
      }
      subjectTeachers.push({ id, name, work, role, hours })
    }

    // 排課需求申報（有勾任一項才列入參考）
    const s = d?.scheduling
    if (s && (s.officialLeave || s.counselingGroup || s.avoidChildGrade || s.other)) {
      needsRefs.push({
        teacherId: id, name,
        officialLeave: Boolean(s.officialLeave),
        officialLeaveUnsure: Boolean(s.officialLeaveUnsure),
        officialLeaveSlots: s.officialLeaveSlots ?? [],
        counseling: Boolean(s.counselingGroup),
        counselingUnsure: Boolean(s.counselingUnsure),
        counselingSlots: s.counselingSlots ?? [],
        avoidChildGrades: s.avoidChildGrade ? (s.avoidChildGradeValues?.length ? s.avoidChildGradeValues : (s.avoidChildGradeValue ? [s.avoidChildGradeValue] : [])) : [],
        other: Boolean(s.other),
        otherText: s.otherText ?? '',
      })
    }
  }

  const classCounts: Record<number, number> = {}
  const gradeSubjects: Record<number, GradeSubject[]> = {}
  for (const g of GRADES) {
    classCounts[g] = config.grades[g].classCount
    gradeSubjects[g] = config.grades[g].subjects.map(s => ({ name: s.name, perClass: s.perClass, homeroom: s.homeroom }))
  }

  return (
    <ScheduleConfigClient
      year={year}
      initialTab={searchParams?.tab}
      initialConfig={scheduleConfig}
      classCounts={classCounts}
      gradeSubjects={gradeSubjects}
      homerooms={homerooms}
      subjectTeachers={subjectTeachers}
      offTeachers={offTeachers}
      needsRefs={needsRefs}
      allNames={nameMap}
    />
  )
}
