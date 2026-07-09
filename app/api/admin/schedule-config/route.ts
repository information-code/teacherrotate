import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function checkAdmin(userId: string) {
  return hasPerms(userId, ['schedule-config','schedule-wizard'])
}

/** 讀取某年度排課設定。 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['schedule-config','schedule-wizard']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('schedule_config').select('config').eq('year', year).maybeSingle()
  return NextResponse.json(data?.config ?? {})
}

/** 儲存某年度排課設定。body: { year, config } */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['schedule-config','schedule-wizard']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year, config } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('schedule_config')
    .upsert({ year: Number(year), config: config ?? {}, updated_at: new Date().toISOString() }, { onConflict: 'year' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
