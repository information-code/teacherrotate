import { getAdminClient } from '@/lib/supabase/admin'
import RotationsClient from './RotationsClient'

export const dynamic = 'force-dynamic'

export default async function RotationsPage() {
  const admin = getAdminClient()
  const [rotationsResult, scoresResult, profilesResult, activeTeachersResult, scoremapResult] = await Promise.all([
    admin.from('rotations').select('id, teacher_id, year, work').order('year', { ascending: false }),
    admin.from('scores').select('teacher_id, year, score, recent_four_year_total'),
    admin.from('profiles').select('id, name, email'),
    admin.from('profiles').select('id, name, email').neq('status', 'inactive'),
    admin.from('scoremap').select('work').order('sort_order', { ascending: true }),
  ])

  // 手動 join profiles，避免 PostgREST 關聯語法問題
  const profileMap = Object.fromEntries((profilesResult.data ?? []).map(p => [p.id, p]))
  const rotations = (rotationsResult.data ?? []).map(r => ({
    ...r,
    profiles: profileMap[r.teacher_id] ?? null,
  }))
  return (
    <RotationsClient
      initialRotations={rotations}
      initialScores={scoresResult.data ?? []}
      activeTeachers={activeTeachersResult.data ?? []}
      scoremapWorks={(scoremapResult.data ?? []).map(r => r.work)}
    />
  )
}
