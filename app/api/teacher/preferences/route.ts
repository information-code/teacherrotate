import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function getPreferenceYear(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'preference_year')
    .single()
  return Number(data?.value ?? 115)
}

async function getPreferencePhase(): Promise<'open' | 'closed'> {
  const { data } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'preference_phase')
    .maybeSingle()
  return data?.value === 'closed' ? 'closed' : 'open'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const year = await getPreferenceYear()
  const { data } = await supabase
    .from('preferences')
    .select('preference1, preference2, preference3, locked, give_up')
    .eq('teacher_id', user.id)
    .eq('year', year)
    .maybeSingle()

  return NextResponse.json({
    year,
    preference1: data?.preference1 ?? null,
    preference2: data?.preference2 ?? null,
    preference3: data?.preference3 ?? null,
    locked: data?.locked ?? false,
    give_up: data?.give_up ?? false,
  })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { preference1, preference2, preference3, give_up } = await request.json()

  // 若整輪已截止（撕榜期 / 年度之間的暫停），拒絕修改
  if ((await getPreferencePhase()) === 'closed') {
    return NextResponse.json(
      { error: 'closed', message: '本學年度選填志願已截止，目前無法新增或修改志願。如有疑問請洽管理員。' },
      { status: 423 }
    )
  }

  const year = await getPreferenceYear()

  // 若該年度已鎖定，拒絕修改
  const { data: existing } = await supabaseAdmin
    .from('preferences')
    .select('locked')
    .eq('teacher_id', user.id)
    .eq('year', year)
    .maybeSingle()

  if (existing?.locked) {
    return NextResponse.json(
      { error: 'locked', message: '您的志願已鎖定，如需修改請洽管理員協助解鎖。' },
      { status: 423 }
    )
  }

  const payload = give_up
    ? { teacher_id: user.id, year, preference1: null, preference2: null, preference3: null, give_up: true, locked: true }
    : { teacher_id: user.id, year, preference1, preference2, preference3, give_up: false, locked: true }

  const { data, error } = await supabase
    .from('preferences')
    .upsert(payload, { onConflict: 'teacher_id,year' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
