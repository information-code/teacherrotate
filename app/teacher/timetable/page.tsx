import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { normalizeScheduleConfig, roomLabel } from '@/lib/scheduling'
import TimetableClient from './TimetableClient'

export const dynamic = 'force-dynamic'

export interface TTPlaced {
  id: string
  classKey: string
  classLabel: string
  subject: string
  teacherId: string
  teacherName: string
  day: number
  period: number
  size: number
  parity: string
  roomId: string | null
}

export default async function TimetablePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = getAdminClient()

  const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
  const year = Number(settingsRows?.[0]?.value ?? 115)

  const [{ data: schRow }, { data: planRow }, { data: hrRows }] = await Promise.all([
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_plan').select('plan').eq('year', year).maybeSingle(),
    admin.from('schedule_homeroom').select('class_key, cells').eq('year', year),
  ])
  const config = normalizeScheduleConfig(schRow?.config)
  const plan = (planRow?.plan ?? null) as { status?: string; placed?: TTPlaced[] } | null

  if (!plan || plan.status !== 'final') {
    return (
      <div className="max-w-2xl">
        <h2 className="page-title mb-2">課表</h2>
        <div className="card text-sm text-zinc-500 py-8 text-center">{year} 學年度課表尚未發布，請等候教務處定案。</div>
      </div>
    )
  }

  // 教室顯示名
  const roomNames: Record<string, string> = {}
  for (const z of config.roomZones) for (const r of z.rooms) {
    if (r.kind === 'subject' && r.subject) roomNames[r.id] = roomLabel(r) || r.subject
  }
  // 鎖課顯示
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const locks: Record<string, Record<string, string>> = {}
  for (const [ck, cells] of Object.entries(config.lockCells)) {
    locks[ck] = Object.fromEntries(Object.entries(cells).map(([s, tid]) => [s, lockTypeMap[tid]?.subject || lockTypeMap[tid]?.label || '鎖課']))
  }

  const myClassKey = Object.entries(config.classTeacher).find(([, tid]) => tid === user.id)?.[0] ?? null

  return (
    <TimetableClient
      year={year}
      userId={user.id}
      myClassKey={myClassKey}
      placed={plan.placed ?? []}
      homeroomCells={Object.fromEntries((hrRows ?? []).map(r => [r.class_key, (r.cells ?? {}) as Record<string, string>]))}
      classTeacher={config.classTeacher}
      bands={config.bands}
      locks={locks}
      roomNames={roomNames}
    />
  )
}
