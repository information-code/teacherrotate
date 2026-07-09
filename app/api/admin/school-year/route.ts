import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ADMIN_DUTIES, DUTY_OFFICE_MAP } from '@/lib/staff'

/**
 * 開始新學年度（僅最高管理者）。body: { year }
 * 1. 設定 current_school_year＝year
 * 2. 從該年 rotations 把各行政職務的人帶入 staff_roster
 *    （enabled 開關保留原設定；之後可在權限頁改人，最終以權限頁為準）
 * 允許 year＝目前年度（重新帶入名單用）。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'superadmin') {
    return NextResponse.json({ error: '僅最高管理者可切換學年度' }, { status: 403 })
  }

  const { year } = await request.json()
  const nextYear = Number(year)
  if (!Number.isInteger(nextYear) || nextYear < 100 || nextYear > 300) {
    return NextResponse.json({ error: '學年度格式錯誤（民國年，例如 114）' }, { status: 400 })
  }

  const { data: cur } = await supabaseAdmin
    .from('settings').select('value').eq('key', 'current_school_year').maybeSingle()
  const currentYear = Number(cur?.value) || null
  if (currentYear && nextYear !== currentYear && nextYear !== currentYear + 1) {
    return NextResponse.json(
      { error: `只能重新帶入 ${currentYear} 或開始 ${currentYear + 1} 學年度。` },
      { status: 409 }
    )
  }

  // 該年度的行政職務名單
  const { data: rots, error: rotError } = await supabaseAdmin
    .from('rotations').select('teacher_id, work')
    .eq('year', nextYear).in('work', ADMIN_DUTIES)
  if (rotError) return NextResponse.json({ error: rotError.message }, { status: 500 })
  if (!rots || rots.length === 0) {
    return NextResponse.json(
      { error: `${nextYear} 學年度還沒有行政職務的工作紀錄，請先在「工作紀錄」建立，或建立後再切換。` },
      { status: 409 }
    )
  }

  const holder = new Map<string, string>()
  for (const r of rots) if (!holder.has(r.work)) holder.set(r.work, r.teacher_id)

  // enabled 開關保留既有設定
  const { data: existing } = await supabaseAdmin.from('staff_roster').select('duty, enabled')
  const enabledMap = new Map((existing ?? []).map(r => [r.duty, r.enabled]))

  const now = new Date().toISOString()
  const rows = ADMIN_DUTIES.map(duty => ({
    duty,
    office: DUTY_OFFICE_MAP[duty],
    teacher_id: holder.get(duty) ?? null,
    enabled: enabledMap.get(duty) ?? false,
    updated_at: now,
  }))
  const { error: rosterError } = await supabaseAdmin
    .from('staff_roster').upsert(rows, { onConflict: 'duty' })
  if (rosterError) return NextResponse.json({ error: rosterError.message }, { status: 500 })

  const { error: settingsError } = await supabaseAdmin
    .from('settings')
    .upsert({ key: 'current_school_year', value: String(nextYear) }, { onConflict: 'key' })
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    year: nextYear,
    imported: rows.filter(r => r.teacher_id).length,
    vacant: rows.filter(r => !r.teacher_id).map(r => r.duty),
  })
}
