import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/** 讀取某年度全部導師填報。 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  const { data } = await supabaseAdmin
    .from('schedule_homeroom').select('class_key, teacher_id, cells, confirmed_at').eq('year', year)
  return NextResponse.json(data ?? [])
}

/** 管理動作。body:
 *  { year, classKey, action: 'unconfirm' }         退回導師確認（導師可重新編輯）
 *  { year, classKey, action: 'setCells', cells }   管理者代調導師課（保留確認狀態） */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year, classKey, action, cells } = await request.json()
  if (!Number.isInteger(Number(year)) || !classKey) return NextResponse.json({ error: '參數錯誤' }, { status: 400 })

  if (action === 'unconfirm') {
    const { error } = await supabaseAdmin
      .from('schedule_homeroom')
      .update({ confirmed_at: null, updated_at: new Date().toISOString() })
      .eq('year', Number(year)).eq('class_key', String(classKey))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'setCells') {
    if (!cells || typeof cells !== 'object') return NextResponse.json({ error: 'cells 格式錯誤' }, { status: 400 })
    const { error } = await supabaseAdmin
      .from('schedule_homeroom')
      .update({ cells, updated_at: new Date().toISOString() })
      .eq('year', Number(year)).eq('class_key', String(classKey))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '無效的動作' }, { status: 400 })
}
