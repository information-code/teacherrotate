import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/** 取得所有教師的確認狀態 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, email, score_confirmed, score_confirmed_at')
    .not('role', 'eq', 'superadmin')
    .neq('status', 'inactive')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ teachers: data ?? [] })
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
