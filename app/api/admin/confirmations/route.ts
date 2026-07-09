import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRotationTarget } from '@/lib/rotation-target'
import { hasPerms } from '@/lib/staff-server'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/** 取得所有教師的確認狀態（含目標分類、志願鎖定狀態） */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['confirmations']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: profiles, error }, { data: rotations }, { data: settingsRows }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, name, email, score_confirmed, score_confirmed_at')
      .not('role', 'eq', 'superadmin')
      .neq('status', 'inactive')
      .order('name'),
    supabaseAdmin.from('rotations').select('teacher_id, year, work, grade'),
    supabaseAdmin.from('settings').select('value').eq('key', 'preference_year'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const preferenceYear = Number(settingsRows?.[0]?.value ?? 115)

  const { data: prefs } = await supabaseAdmin
    .from('preferences')
    .select('teacher_id, locked, give_up, preference1, preference2, preference3')
    .eq('year', preferenceYear)

  const prefByTeacher = Object.fromEntries(
    (prefs ?? []).map(p => [p.teacher_id, p])
  )

  const rotByTeacher: Record<string, { year: number; work: string; grade: number | null }[]> = {}
  for (const r of rotations ?? []) {
    if (!rotByTeacher[r.teacher_id]) rotByTeacher[r.teacher_id] = []
    rotByTeacher[r.teacher_id].push({ year: r.year, work: r.work, grade: r.grade ?? null })
  }

  const teachers = (profiles ?? []).map(p => {
    const pref = prefByTeacher[p.id]
    return {
      ...p,
      targetType: getRotationTarget(rotByTeacher[p.id] ?? []),
      prefLocked: pref?.locked ?? false,
      prefGiveUp: pref?.give_up ?? false,
      prefFilled: !!(pref?.preference1 || pref?.preference2 || pref?.preference3),
    }
  })

  return NextResponse.json({ teachers, preferenceYear })
}

/** 重置確認狀態（PATCH body: { id } = 個別重置；body: { all: true } = 全體重置） */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['confirmations']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const reset = { score_confirmed: false, score_confirmed_at: null }

  if (body.all === true) {
    // 全體重置
    const { error } = await supabaseAdmin
      .from('profiles')
      .update(reset)
      .not('role', 'eq', 'superadmin')
      .neq('status', 'inactive')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, scope: 'all' })
  }

  if (body.id) {
    // 個別重置
    const { error } = await supabaseAdmin
      .from('profiles')
      .update(reset)
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, scope: 'single' })
  }

  return NextResponse.json({ error: '請提供 id 或 all: true' }, { status: 400 })
}
