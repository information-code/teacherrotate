import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** 在自己的案件留言。body: { report_id, body }。未結案才能發言。 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload = await request.json()
  const reportId = String(payload?.report_id ?? '')
  const body = String(payload?.body ?? '').trim()
  if (!reportId) return NextResponse.json({ error: '缺少案件 id' }, { status: 400 })
  if (!body) return NextResponse.json({ error: '留言不可為空' }, { status: 400 })

  const { data: report } = await supabaseAdmin
    .from('repair_reports').select('id, teacher_id, status').eq('id', reportId).maybeSingle()
  if (!report || report.teacher_id !== user.id) {
    return NextResponse.json({ error: '找不到案件' }, { status: 404 })
  }
  if (report.status === 'closed') {
    return NextResponse.json({ error: '案件已結案，無法留言' }, { status: 400 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('name, email').eq('id', user.id).maybeSingle()

  const { data, error } = await supabaseAdmin.from('repair_messages').insert({
    report_id: reportId,
    author_id: user.id,
    author_name: profile?.name || profile?.email || '',
    is_admin: false,
    body,
  }).select('id').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
