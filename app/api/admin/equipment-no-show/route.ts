import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['equipment']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 「預約未借」次數清單（僅列有紀錄的老師）。 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [{ data: stats, error }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_teacher_stats').select('*')
      .gt('no_show_count', 0).order('no_show_count', { ascending: false }),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name ?? p.email]))
  return NextResponse.json({
    rows: (stats ?? []).map(s => ({
      teacher_id: s.teacher_id,
      name: profileMap.get(s.teacher_id) ?? '（未知）',
      no_show_count: s.no_show_count,
      updated_at: s.updated_at,
    })),
  })
}

/**
 * 重置某老師的「預約未借」次數（歸零後恢復自行預約）。
 * 已計次的借用紀錄保持已計次，不會被重算。body: { teacher_id }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { teacher_id } = await request.json()
  if (!teacher_id) return NextResponse.json({ error: '缺少老師 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('equipment_teacher_stats')
    .update({ no_show_count: 0, updated_at: new Date().toISOString() })
    .eq('teacher_id', teacher_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
