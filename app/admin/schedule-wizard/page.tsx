import { getAdminClient } from '@/lib/supabase/admin'
import ScheduleWizardClient from './ScheduleWizardClient'
import { normalizeConfig, GRADES } from '@/lib/allocation'
import { normalizeScheduleConfig } from '@/lib/scheduling'
import type { GradeSubject } from '../schedule-config/page'

export const dynamic = 'force-dynamic'

export default async function ScheduleWizardPage() {
  const admin = getAdminClient()
  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: cfgRow }, { data: schRow }, { data: profiles }, { data: planRow }] = await Promise.all([
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('profiles').select('id, name').neq('status', 'inactive').neq('role', 'superadmin'),
    admin.from('schedule_plan').select('generated_at').eq('year', year).maybeSingle(),
  ])
  const allocConfig = normalizeConfig(cfgRow?.config)
  const scheduleConfig = normalizeScheduleConfig(schRow?.config)
  const teacherNames = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))

  const classCounts: Record<number, number> = {}
  const gradeSubjects: Record<number, GradeSubject[]> = {}
  const gradeHomeroomBase: Record<number, number> = {}
  for (const g of GRADES) {
    classCounts[g] = allocConfig.grades[g].classCount
    gradeSubjects[g] = allocConfig.grades[g].subjects.map(s => ({ name: s.name, perClass: s.perClass, homeroom: s.homeroom }))
    gradeHomeroomBase[g] = allocConfig.grades[g].homeroomBase
  }

  return (
    <ScheduleWizardClient
      year={year}
      scheduleConfig={scheduleConfig}
      classCounts={classCounts}
      gradeSubjects={gradeSubjects}
      gradeHomeroomBase={gradeHomeroomBase}
      teacherNames={teacherNames}
      lastGeneratedAt={planRow?.generated_at ?? null}
    />
  )
}
