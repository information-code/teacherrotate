import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getRotationTarget } from '@/lib/rotation-target'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/** 取得所有教師的確認狀態（含目標分類） */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: profiles, error }, { data: rotations }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, name, email, score_confirmed, score_confirmed_at')
      .not('role', 'eq', 'superadmin')
      .neq('status', 'inactive')
      .order('name'),
    supabaseAdmin.from('rotations').select('teacher_id, year, work'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rotByTeacher: Record<string, { year: number; work: string }[]> = {}
  for (const r of rotations ?? []) {
    if (!rotByTeacher[r.teacher_id]) rotByTeacher[r.teacher_id] = []
    rotByTeacher[r.teacher_id].push({ year: r.year, work: r.work })
  }

  const teachers = (profiles ?? []).map(p => ({
    ...p,
    targetType: getRotationTarget(rotByTeacher[p.id] ?? []),
  }))

  return NextResponse.json({ teachers })
}

/** 重置確認狀態（PATCH body: { id } = 個別重置；body: { all: true } = 全體重置） */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
