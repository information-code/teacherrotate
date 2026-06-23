import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/**
 * 啟動下一年度新一輪：
 *  1. 將 preference_year 設為指定年度，並把 preference_phase 設回 open
 *  2. 重置全體 score_confirmed（新一輪須重新核對含上一年新增的分數）
 * 不會動到任何 preferences / scores / rotations 歷史資料。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year } = await request.json()
  const nextYear = Number(year)
  if (!Number.isInteger(nextYear)) {
    return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })
  }

  // 1. 切換年度並設為開放
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

  // 2. 重置全體分數確認（只需重置目前已確認者）
  const { error: resetError } = await supabaseAdmin
    .from('profiles')
    .update({ score_confirmed: false, score_confirmed_at: null })
    .eq('score_confirmed', true)
  if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 })

  return NextResponse.json({ ok: true, year: nextYear })
}
