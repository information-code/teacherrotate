import { guardPage } from '@/lib/staff-server'
import { getAdminClient } from '@/lib/supabase/admin'
import TeachersClient from './TeachersClient'

export const dynamic = 'force-dynamic'

const SKIP_WORKS = ['留職停薪', '育嬰留停', '借調', '延長病假']

export default async function TeachersPage() {
  await guardPage(['teachers'])
  const admin = getAdminClient()
  const [{ data: profiles }, { data: rotations }] = await Promise.all([
    admin.from('profiles').select('*').neq('role', 'superadmin').order('name'),
    admin.from('rotations').select('teacher_id, work'),
  ])

  // 關埔年資 = rotation 中扣掉留停/育嬰/借調/延長病假後的紀錄數
  const kanpuYearsByTeacher: Record<string, number> = {}
  for (const r of rotations ?? []) {
    if (SKIP_WORKS.includes(r.work)) continue
    kanpuYearsByTeacher[r.teacher_id] = (kanpuYearsByTeacher[r.teacher_id] ?? 0) + 1
  }

  return <TeachersClient profiles={profiles ?? []} kanpuYearsMap={kanpuYearsByTeacher} />
}
