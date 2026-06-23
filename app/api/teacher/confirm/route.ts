import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** 教師確認自己的歷年積分無誤（POST = 確認，確認後鎖定） */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 整輪已截止時，暫停分數確認（與選填志願一致）
  const { data: phaseRow } = await supabaseAdmin
    .from('settings').select('value').eq('key', 'preference_phase').maybeSingle()
  if (phaseRow?.value === 'closed') {
    return NextResponse.json(
      { error: 'closed', message: '目前非開放期間，暫停分數確認。如有疑問請洽管理員。' },
      { status: 423 }
    )
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      score_confirmed: true,
      score_confirmed_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
