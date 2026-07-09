import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function checkAdmin(userId: string) {
  return hasPerms(userId, ['selection-panel'])
}

/**
 * 啟動下一年度新一輪：
 *  0. 防呆閘門：所有「在職（status≠inactive）、非 superadmin」教師，都必須有一筆
 *     「目前年度（currentYear，例如 115）」的 rotation 工作紀錄。缺任一人即拒絕，
 *     回傳未滿足的教師名單，逼管理者先建立該年度工作或將離校者設為離職。
 *  1. 通過後：將 preference_year 設為 nextYear，並把 preference_phase 設回 open
 *  2. 重置全體 score_confirmed（新一輪須重新核對含上一年新增的分數）
 * 不會動到任何 preferences / scores / rotations 歷史資料。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['selection-panel']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year } = await request.json()
  const nextYear = Number(year)
  if (!Number.isInteger(nextYear)) {
    return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  }

  // 以伺服器端目前年度為準（避免信任前端）
  const { data: cur } = await supabaseAdmin
    .from('settings').select('value').eq('key', 'preference_year').maybeSingle()
  const currentYear = Number(cur?.value ?? (nextYear - 1))
  if (nextYear !== currentYear + 1) {
    return NextResponse.json(
      { error: `年度不連續（目前為 ${currentYear}），請重新整理頁面後再試。` },
      { status: 409 }
    )
  }

  // ── 0. 防呆閘門：currentYear 工作資料必須齊全 ──
  const checkYear = currentYear
  const { data: activeProfiles } = await supabaseAdmin
    .from('profiles')
    .select('id, name')
    .neq('status', 'inactive')
    .neq('role', 'superadmin')
  const active = activeProfiles ?? []

  const { data: rots } = await supabaseAdmin
    .from('rotations').select('teacher_id').eq('year', checkYear)
  const haveRotation = new Set((rots ?? []).map(r => r.teacher_id))

  const missing = active
    .filter(p => !haveRotation.has(p.id))
    .map(p => (p.name ?? '').trim() || '(未命名教師)')
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))

  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'missing_rotations', year: checkYear, count: missing.length, teachers: missing },
      { status: 409 }
    )
  }

  // ── 1. 切換年度並設為開放 ──
  const { error: settingsError } = await supabaseAdmin
    .from('settings')
    .upsert(
      [
        { key: 'preference_year', value: String(nextYear) },
        { key: 'preference_phase', value: 'open' },
      ],
      { onConflict: 'key' }
    )
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 })

  // ── 2. 重置全體分數確認（只需重置目前已確認者）──
  const { error: resetError } = await supabaseAdmin
    .from('profiles')
    .update({ score_confirmed: false, score_confirmed_at: null })
    .eq('score_confirmed', true)
  if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 })

  return NextResponse.json({ ok: true, year: nextYear })
}
