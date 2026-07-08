import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { normalizeScheduleConfig, bandOf, classLabel, SCHEDULE_DAYS } from '@/lib/scheduling'
import { homeroomBreakdown, type TeacherAllocation } from '@/lib/allocation'
import ScheduleFillClient from './ScheduleFillClient'

export const dynamic = 'force-dynamic'

/** 班級課表上的固定格（科任課／鎖課），導師不可動。 */
export interface FixedCell {
  subject: string
  teacherName?: string
  kind: 'subject' | 'lock'
  biweekly?: 'odd' | 'even'
}

export default async function ScheduleFillPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = getAdminClient()

  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: schRow }, { data: planRow }, { data: allocRow }] = await Promise.all([
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_plan').select('plan').eq('year', year).maybeSingle(),
    admin.from('allocation').select('data').eq('teacher_id', user.id).eq('year', year).maybeSingle(),
  ])
  const config = normalizeScheduleConfig(schRow?.config)
  const plan = (planRow?.plan ?? null) as {
    status?: string
    placed?: { classKey: string; subject: string; teacherName: string; day: number; period: number; size: number; parity: string }[]
  } | null

  // 我是哪一班的導師？
  const classKey = Object.entries(config.classTeacher).find(([, tid]) => tid === user.id)?.[0] ?? null

  const notReady = (msg: string) => (
    <div className="max-w-2xl">
      <h2 className="page-title mb-2">排課選填</h2>
      <div className="card text-sm text-zinc-500 py-8 text-center">{msg}</div>
    </div>
  )
  if (!classKey) return notReady('此功能供班級導師填排自己的課務。您目前未被指定為任何班級的導師（如有疑問請洽教務處）。')
  if (!plan || (plan.status !== 'published' && plan.status !== 'final')) {
    return notReady('導師排課尚未發布。待課務組完成科任課表並發布後，即可在此填排自己的課務。')
  }

  const [g, i] = classKey.split('-').map(Number)
  const grid = config.bands[bandOf(g)]
  const teachable: string[] = []
  for (const d of SCHEDULE_DAYS) for (let p = 1; p <= grid.periodsPerDay; p++) {
    if (grid.teachable[`${d}-${p}`]) teachable.push(`${d}-${p}`)
  }

  // 固定格：科任課＋鎖課
  const fixed: Record<string, FixedCell> = {}
  for (const p of plan.placed ?? []) {
    if (p.classKey !== classKey) continue
    const bi = p.parity === 'odd' || p.parity === 'even' ? p.parity as 'odd' | 'even' : undefined
    fixed[`${p.day}-${p.period}`] = { subject: p.subject, teacherName: p.teacherName, kind: 'subject', biweekly: bi }
    if (p.size === 2) fixed[`${p.day}-${p.period + 1}`] = { subject: p.subject, teacherName: p.teacherName, kind: 'subject', biweekly: bi }
  }
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  for (const [slot, tid] of Object.entries(config.lockCells[classKey] ?? {})) {
    const t = lockTypeMap[tid]
    fixed[slot] = { subject: t?.subject || t?.label || '鎖課', kind: 'lock' }
  }

  // 我要填的配課節數
  const breakdown = homeroomBreakdown(allocRow?.data as TeacherAllocation | null)

  const { data: hrRow } = await admin
    .from('schedule_homeroom').select('cells, confirmed_at')
    .eq('year', year).eq('class_key', classKey).maybeSingle()

  return (
    <ScheduleFillClient
      year={year}
      classLabel={classLabel(g, i)}
      periodsPerDay={grid.periodsPerDay}
      teachable={teachable}
      fixed={fixed}
      breakdown={breakdown}
      initialCells={(hrRow?.cells ?? {}) as Record<string, string>}
      confirmedAt={hrRow?.confirmed_at ?? null}
      finalized={plan.status === 'final'}
    />
  )
}
