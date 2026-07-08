import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { normalizeScheduleConfig, roomLabel, subjectClassKey, HOMEROOM_SELF, deriveNativeSessions } from '@/lib/scheduling'
import { normalizeConfig as normalizeAllocConfig, type TeacherAllocation } from '@/lib/allocation'
import TimetableClient from './TimetableClient'

export interface LockCell { main: string; sub?: string }
export interface NativeSessionView { slot: string; roomId: string; roomLabel: string; lang: string; mode: 'physical' | 'stream'; teacherId: string; teacherName: string }

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

  const [{ data: schRow }, { data: planRow }, { data: hrRows }, { data: profiles }, { data: allocCfgRow }, { data: allocRows }] = await Promise.all([
    admin.from('schedule_config').select('config').eq('year', year).maybeSingle(),
    admin.from('schedule_plan').select('plan').eq('year', year).maybeSingle(),
    admin.from('schedule_homeroom').select('class_key, cells').eq('year', year),
    admin.from('profiles').select('id, name').neq('status', 'inactive'),
    admin.from('allocation_config').select('config').eq('year', year).maybeSingle(),
    admin.from('allocation').select('teacher_id, data').eq('year', year),
  ])
  const nameOf = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name ?? '']))
  const config = normalizeScheduleConfig(schRow?.config)
  const plan = (planRow?.plan ?? null) as { status?: string; placed?: TTPlaced[] } | null

  // 初版發布（published）與定案（final）皆對全校公開；初版＝導師課仍在填報、內容可能異動
  if (!plan || (plan.status !== 'published' && plan.status !== 'final')) {
    return (
      <div className="max-w-2xl">
        <h2 className="page-title mb-2">課表</h2>
        <div className="card text-sm text-zinc-500 py-8 text-center">{year} 學年度課表尚未發布，請等候教務處公告。</div>
      </div>
    )
  }

  // 教室顯示名（科任教室＋本土語言教室）
  const roomNames: Record<string, string> = {}
  for (const z of config.roomZones) for (const r of z.rooms) {
    if (r.kind === 'subject' && r.subject) roomNames[r.id] = roomLabel(r) || r.subject
    if (r.kind === 'native') roomNames[r.id] = (r.name || '本土語言教室') + r.no
  }
  // 鎖課顯示：本土語鎖課附閩南語老師名（科任配班有指派）或「直播共學」
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const locks: Record<string, Record<string, LockCell>> = {}
  const nativeClassCells: { classKey: string; slot: string; teacherId: string }[] = []   // 閩南語師的原班場次（教師檢視用）
  for (const [ck, cells] of Object.entries(config.lockCells)) {
    const [g, i] = ck.split('-').map(Number)
    const minnan = config.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
    const out: Record<string, LockCell> = {}
    for (const [s, tid] of Object.entries(cells)) {
      const t = lockTypeMap[tid]
      if (t?.isNative) {
        if (minnan && minnan !== HOMEROOM_SELF) {
          out[s] = { main: '本土語', sub: nameOf[minnan] ?? '' }
          nativeClassCells.push({ classKey: ck, slot: s, teacherId: minnan })
        } else {
          out[s] = { main: '本土語', sub: '直播共學' }
        }
      } else {
        out[s] = { main: t?.subject || t?.label || '鎖課' }
      }
    }
    locks[ck] = out
  }
  // 本土語開課場次（教室／教師檢視用）：由鎖課時段×配課自動推導，取消／無教室者不顯示
  const extraCourses = normalizeAllocConfig(allocCfgRow?.config).extraCourses
  const hoursByTeacher: Record<string, Record<string, Record<string, number>>> = {}
  const extraNames = new Set(extraCourses.map(c => c.name).filter(Boolean))
  for (const row of allocRows ?? []) {
    const sgh = (row.data as TeacherAllocation | null)?.subjectGradeHours ?? {}
    for (const [subj, byGrade] of Object.entries(sgh)) {
      if (!extraNames.has(subj)) continue
      ;(hoursByTeacher[row.teacher_id] ??= {})[subj] = byGrade as Record<string, number>
    }
  }
  const derived = deriveNativeSessions({ config, extraCourses, hoursByTeacher })
  const nativeSessions: NativeSessionView[] = derived.sessions
    .filter(s => s.state !== 'cancelled' && s.roomId && roomNames[s.roomId])
    .map(s => ({
      slot: s.slot, roomId: s.roomId!, roomLabel: roomNames[s.roomId!] ?? '本土語言教室',
      lang: s.lang, mode: s.state === 'stream' ? 'stream' as const : 'physical' as const,
      teacherId: s.teacherId,
      teacherName: s.state === 'stream' ? '' : (nameOf[s.teacherId] ?? ''),
    }))

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
      nativeSessions={nativeSessions}
      nativeClassCells={nativeClassCells}
      planStatus={plan.status}
    />
  )
}
