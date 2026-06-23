import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/** 讀取某年度的撕榜面板（名額 + 配置）。 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('selection_panel').select('data').eq('year', year).maybeSingle()
  return NextResponse.json(data?.data ?? {})
}

/** 儲存某年度的撕榜面板。body: { year, data: { quotas, placements } } */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year, data } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('selection_panel')
    .upsert({ year: Number(year), data: data ?? {}, updated_at: new Date().toISOString() }, { onConflict: 'year' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
