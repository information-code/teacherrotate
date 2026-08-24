import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function checkAdmin(userId: string) {
  return hasPerms(userId, ['allocation-config','allocation-statistics'])
}

/**
 * 管理者編輯任一教師的配課（最高權限，可覆寫已鎖定者）。
 * body: { teacher_id, data }（完整 TeacherAllocation）
 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['allocation-config','allocation-statistics']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { teacher_id, data } = await request.json()
  if (!teacher_id) return NextResponse.json({ error: '缺少 teacher_id' }, { status: 400 })

  const { data: cur } = await supabaseAdmin.from('settings').select('value').eq('key', 'preference_year').maybeSingle()
  const year = Number(cur?.value ?? 115)

  // 這是整份取代。只要送來的 data 少了 subjectGradeHours（分頁開太久、狀態是舊的、
  // 防抖存檔晚一步觸發都會發生），代理科任的授課節數就被一次清光——而且要等到排課
  // 預檢跳「有科任需求卻沒有科任可配」才會發現。
  // 沒帶那個欄位（或帶空的）＝沒有要改它，保留原值；真的要清是把節數設成 0。
  const incoming = (data ?? {}) as Record<string, unknown>
  const sgh = incoming.subjectGradeHours as Record<string, Record<string, number>> | undefined
  if (!sgh || Object.keys(sgh).length === 0) {
    const { data: prev } = await supabaseAdmin
      .from('allocation').select('data').eq('year', year).eq('teacher_id', teacher_id).maybeSingle()
    const kept = (prev?.data as { subjectGradeHours?: Record<string, Record<string, number>> } | null)?.subjectGradeHours
    if (kept && Object.keys(kept).length) incoming.subjectGradeHours = kept
  }

  const { error } = await supabaseAdmin
    .from('allocation')
    .upsert({ year, teacher_id, data: incoming as never, updated_at: new Date().toISOString() }, { onConflict: 'year,teacher_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
