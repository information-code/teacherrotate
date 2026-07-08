import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/** 讀取某年度排課結果。 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('schedule_plan').select('plan, generated_at').eq('year', year).maybeSingle()
  return NextResponse.json(data ?? {})
}

/** 發布／撤回導師排課。body: { year, action: 'publish' | 'unpublish' }
 *  發布門檻：未排清單與必排未覆蓋都必須為 0——所有需求配課都要排入。 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year, action } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { data: row } = await supabaseAdmin
    .from('schedule_plan').select('plan').eq('year', Number(year)).maybeSingle()
  const plan = (row?.plan ?? null) as Record<string, unknown> | null
  if (!plan || !Array.isArray(plan.placed)) {
    return NextResponse.json({ error: '尚未儲存排課結果，請先執行排課並儲存' }, { status: 400 })
  }

  if (action === 'publish') {
    const unplaced = Array.isArray(plan.unplaced) ? plan.unplaced.length : 0
    const uncovered = Array.isArray(plan.uncoveredMustFill) ? plan.uncoveredMustFill.length : 0
    if (unplaced > 0 || uncovered > 0) {
      return NextResponse.json({
        error: `無法發布：仍有 ${unplaced} 堂未排、${uncovered} 格導師不排課時段未覆蓋。所有需求配課都必須排入（調整配班或手動處理後重排）。`,
      }, { status: 400 })
    }
    plan.status = 'published'
    plan.publishedAt = new Date().toISOString()
  } else if (action === 'unpublish') {
    if (plan.status === 'final') return NextResponse.json({ error: '已定案，無法撤回發布' }, { status: 400 })
    plan.status = 'draft'
    plan.publishedAt = null
  } else {
    return NextResponse.json({ error: '無效的動作' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('schedule_plan')
    .update({ plan: plan as never })
    .eq('year', Number(year))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: plan.status })
}

/** 儲存某年度排課結果。body: { year, plan } */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year, plan } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('schedule_plan')
    .upsert({ year: Number(year), plan: plan ?? {}, generated_at: new Date().toISOString() }, { onConflict: 'year' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
