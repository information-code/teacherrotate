import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function getPreferenceYear(): Promise<number> {
  const { data } = await supabaseAdmin.from('settings').select('value').eq('key', 'preference_year').maybeSingle()
  return Number(data?.value ?? 115)
}
async function getAllocationPhase(): Promise<'open' | 'closed'> {
  const { data } = await supabaseAdmin.from('settings').select('value').eq('key', 'allocation_phase').maybeSingle()
  return data?.value === 'closed' ? 'closed' : 'open'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const year = await getPreferenceYear()
  const { data } = await supabaseAdmin
    .from('allocation').select('data').eq('year', year).eq('teacher_id', user.id).maybeSingle()
  return NextResponse.json(data?.data ?? null)
}

/** 儲存配課。body: { data } （data.locked=true 代表送出鎖定）。已鎖定後僅管理者可改。 */
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if ((await getAllocationPhase()) === 'closed') {
    return NextResponse.json({ error: 'closed', message: '配課填報已截止，目前無法修改。如需協助請洽管理員。' }, { status: 423 })
  }

  const year = await getPreferenceYear()
  const { data: existing } = await supabaseAdmin
    .from('allocation').select('data').eq('year', year).eq('teacher_id', user.id).maybeSingle()
  const prev = existing?.data as { locked?: boolean } | null
  if (prev?.locked) {
    return NextResponse.json({ error: 'locked', message: '您的配課已送出鎖定，如需修改請洽管理員。' }, { status: 423 })
  }

  const { data } = await request.json()
  const { error } = await supabaseAdmin
    .from('allocation')
    .upsert({ year, teacher_id: user.id, data: data ?? {}, updated_at: new Date().toISOString() }, { onConflict: 'year,teacher_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
