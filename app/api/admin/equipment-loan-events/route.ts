import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin, collectChecklistPhotos, signPhotoUrls } from '@/lib/equipment-server'

/**
 * 短期借用操作日誌（唯讀）。
 * query: from? / to?（事件時間，日期）/ action?
 * 回傳 { events, loanDetails: {loan_id: {borrow_checklist, return_checklist}}, photoUrls }
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params = request.nextUrl.searchParams
  let query = supabaseAdmin.from('equipment_loan_events').select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  const from = params.get('from')
  const to = params.get('to')
  const action = params.get('action')
  if (from) query = query.gte('created_at', `${from}T00:00:00`)
  if (to) query = query.lte('created_at', `${to}T23:59:59`)
  if (action) query = query.eq('action', action)

  const { data: events, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 借用/歸還/結案事件可展開檢查明細與照片
  const detailIds = Array.from(new Set(
    (events ?? [])
      .filter(e => ['borrowed', 'returned', 'closed'].includes(e.action) && e.loan_id)
      .map(e => e.loan_id as string)
  ))
  const { data: loans } = detailIds.length > 0
    ? await supabaseAdmin.from('equipment_loans')
        .select('id, borrow_checklist, return_checklist').in('id', detailIds)
    : { data: [] as never[] }

  const loanDetails: Record<string, { borrow_checklist: unknown; return_checklist: unknown }> = {}
  for (const l of loans ?? []) {
    loanDetails[l.id] = { borrow_checklist: l.borrow_checklist, return_checklist: l.return_checklist }
  }

  const photoPaths = (loans ?? []).flatMap(l => [
    ...collectChecklistPhotos(l.borrow_checklist),
    ...collectChecklistPhotos(l.return_checklist),
  ])
  const photoUrls = await signPhotoUrls(photoPaths)

  return NextResponse.json({ events: events ?? [], loanDetails, photoUrls })
}
