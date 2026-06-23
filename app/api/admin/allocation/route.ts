import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/**
 * 管理者編輯任一教師的配課（最高權限，可覆寫已鎖定者）。
 * body: { teacher_id, data }（完整 TeacherAllocation）
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { teacher_id, data } = await request.json()
  if (!teacher_id) return NextResponse.json({ error: '缺少 teacher_id' }, { status: 400 })

  const { data: cur } = await supabaseAdmin.from('settings').select('value').eq('key', 'preference_year').maybeSingle()
  const year = Number(cur?.value ?? 115)

  const { error } = await supabaseAdmin
    .from('allocation')
    .upsert({ year, teacher_id, data: data ?? {}, updated_at: new Date().toISOString() }, { onConflict: 'year,teacher_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
