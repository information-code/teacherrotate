import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function checkAdmin(userId: string) {
  return hasPerms(userId, ['schedule-config','schedule-wizard'])
}

/** 讀取某年度排課結果。 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['schedule-config','schedule-wizard']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('schedule_plan').select('plan, generated_at').eq('year', year).maybeSingle()
  return NextResponse.json(data ?? {})
}

/** 發布／撤回導師排課。body: { year, action: 'publish' | 'unpublish' | 'finalize' | 'unfinalize' | 'fillOpen' | 'fillClose' }
 *  發布門檻：未排清單與必排未覆蓋都必須為 0——所有需求配課都要排入。 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['schedule-config','schedule-wizard']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    // 必須級違反（如排課標記時段未排課）一律擋發布——設定即絕對要求
    const mustViolations = Array.isArray(plan.penalties)
      ? (plan.penalties as { label?: string; count?: number; points?: number }[]).filter(p => Number(p.points) >= 1e6)
      : []
    if (unplaced > 0 || uncovered > 0 || mustViolations.length > 0) {
      const extra = mustViolations.length ? `、必須級違反：${mustViolations.map(p => `${p.label ?? '?'}×${p.count ?? '?'}`).join('、')}` : ''
      return NextResponse.json({
        error: `無法發布：仍有 ${unplaced} 堂未排、${uncovered} 格導師不排課時段未覆蓋${extra}。所有需求配課與標記都必須達成（調整配班／標記或手動處理後重排）。`,
      }, { status: 400 })
    }
    plan.status = 'published'
    plan.publishedAt = new Date().toISOString()
    plan.fillOpen = true   // 發布即開放導師填課；課務組可隨時收回（fillClose）再調課
  } else if (action === 'fillClose' || action === 'fillOpen') {
    // 導師填課權限開關：開著時課務組只能做科任課之間的互換；收回後可自由調課（含搬進空格／與導師課互換）
    if (plan.status !== 'published') return NextResponse.json({ error: '僅發布中（未定案）的課表可切換導師填課' }, { status: 400 })
    plan.fillOpen = action === 'fillOpen'
  } else if (action === 'unpublish') {
    if (plan.status === 'final') return NextResponse.json({ error: '已定案，無法撤回發布' }, { status: 400 })
    plan.status = 'draft'
    plan.publishedAt = null
  } else if (action === 'finalize') {
    if (plan.status !== 'published') return NextResponse.json({ error: '需先發布導師排課才能定案' }, { status: 400 })
    plan.status = 'final'
    plan.finalizedAt = new Date().toISOString()
  } else if (action === 'unfinalize') {
    if (plan.status !== 'final') return NextResponse.json({ error: '尚未定案' }, { status: 400 })
    plan.status = 'published'
    plan.finalizedAt = null
  } else {
    return NextResponse.json({ error: '無效的動作' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('schedule_plan')
    .update({ plan: plan as never })
    .eq('year', Number(year))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status: plan.status, fillOpen: plan.fillOpen !== false })
}

/** 儲存某年度排課結果。body: { year, plan } */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['schedule-config','schedule-wizard']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year, plan, expectedAt } = await request.json()
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  // 樂觀鎖：兩台電腦同時開排課精靈時，這裡是唯一會「無聲弄丟別人成果」的地方——
  // 草稿是整份覆寫，後存的會把前一台的手動調課全部蓋掉，而且雙方都不會收到任何提示。
  // 前端讀取時拿到的 generated_at 要一起送回來；對不上就擋下，讓人先看過對方改了什麼。
  // （expectedAt 省略＝不檢查，供沒有並行風險的呼叫端沿用。）
  const now = new Date().toISOString()
  if (typeof expectedAt === 'string') {
    const { data: cur } = await supabaseAdmin
      .from('schedule_plan').select('generated_at').eq('year', Number(year)).maybeSingle()
    const at = cur?.generated_at ?? ''
    if (at && at !== expectedAt) {
      return NextResponse.json({
        error: '這份課表在你編輯期間被別人改過了',
        conflict: true, currentAt: at,
      }, { status: 409 })
    }
  }

  const { error } = await supabaseAdmin
    .from('schedule_plan')
    .upsert({ year: Number(year), plan: plan ?? {}, generated_at: now }, { onConflict: 'year' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, generatedAt: now })
}
