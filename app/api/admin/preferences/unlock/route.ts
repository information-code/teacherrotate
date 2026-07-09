import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function checkAdmin(userId: string) {
  return hasPerms(userId, ['confirmations','selection-panel'])
}

/** 管理者解鎖某位老師指定年度的志願（讓老師可重新修改） */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['confirmations','selection-panel']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { teacher_id, year } = await request.json()
  if (!teacher_id || !year) {
    return NextResponse.json({ error: '請提供 teacher_id 與 year' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('preferences')
    .update({ locked: false })
    .eq('teacher_id', teacher_id)
    .eq('year', Number(year))

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
