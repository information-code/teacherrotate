import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 工作首頁一次性讀取。query: start, end（行事曆顯示範圍，含首尾）
 * 回傳 { events, holidays, personalEvents, announcements, todos }
 * - announcements：僅已上架（publish_at 已到、expire_at 未過），附 read 旗標
 * - todos：未完成全部＋最近兩週完成的
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const start = request.nextUrl.searchParams.get('start') ?? ''
  const end = request.nextUrl.searchParams.get('end') ?? ''
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || end < start) {
    return NextResponse.json({ error: '日期範圍無效' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const doneSince = new Date(Date.now() - 14 * 86400_000).toISOString()

  const [events, holidays, personalEvents, announcements, reads, todos, doneTodos] = await Promise.all([
    // 與範圍有交集的活動：start_date <= end 且 end_date >= start
    supabaseAdmin.from('school_events').select('*')
      .lte('start_date', end).gte('end_date', start).order('start_date'),
    supabaseAdmin.from('holidays').select('*')
      .gte('date', start).lte('date', end),
    supabaseAdmin.from('personal_events').select('*')
      .eq('user_id', user.id).gte('date', start).lte('date', end).order('date'),
    supabaseAdmin.from('announcements').select('*')
      .lte('publish_at', now)
      .or(`expire_at.is.null,expire_at.gt.${now}`)
      .order('pinned', { ascending: false })
      .order('publish_at', { ascending: false }),
    supabaseAdmin.from('announcement_reads').select('announcement_id')
      .eq('user_id', user.id),
    supabaseAdmin.from('todos').select('*')
      .eq('user_id', user.id).eq('status', 'todo'),
    supabaseAdmin.from('todos').select('*')
      .eq('user_id', user.id).eq('status', 'done').gte('completed_at', doneSince),
  ])

  const firstError = [events, holidays, personalEvents, announcements, reads, todos, doneTodos]
    .find(r => r.error)?.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const readSet = new Set((reads.data ?? []).map(r => r.announcement_id))
  return NextResponse.json({
    events: events.data ?? [],
    holidays: holidays.data ?? [],
    personalEvents: personalEvents.data ?? [],
    announcements: (announcements.data ?? []).map(a => ({ ...a, read: readSet.has(a.id) })),
    todos: [...(todos.data ?? []), ...(doneTodos.data ?? [])],
  })
}
