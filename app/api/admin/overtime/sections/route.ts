import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import { OT_DAY_ZH, OT_PERIOD_ZH, isDateStr, rangesOverlap } from '@/lib/overtime'
import { forbidIfNotPlanOwner, loadPersonSlots, overCapWarning } from '@/lib/overtime-server'

/**
 * 時間區段整批操作。區段＝同一筆清冊列、同 start/end_date 的一組減課時段（NULL＝全期程）。
 *  - PUT：改區段日期，整組時段搬到新日期（同星期節次與重疊區段衝突則拒絕；超過每週 6 節只回 warning）。
 *    新日期與同一人另一個區段相同時，兩組自然合成一個區段。
 *  - DELETE：刪除整個區段（連同其中所有時段）。
 */

async function loadRow(id: string) {
  const { data } = await supabaseAdmin.from('overtime_teachers')
    .select('id, teacher_id, name, category, plan_id').eq('id', id).maybeSingle()
  return data
}

/** body: { teacher_row_id, from_start, from_end（原區段，null＝全期程）, start_date, end_date（新日期） } */
export async function PUT(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const teacher_row_id = String(body?.teacher_row_id ?? '')
  const from_start = body?.from_start ? String(body.from_start) : null
  const from_end = body?.from_end ? String(body.from_end) : null
  let start_date: string | null = String(body?.start_date ?? '')
  let end_date: string | null = String(body?.end_date ?? '')
  if (!teacher_row_id) return NextResponse.json({ error: '缺少教師' }, { status: 400 })
  if (!isDateStr(start_date) || !isDateStr(end_date) || start_date > end_date) {
    return NextResponse.json({ error: '時間區段日期無效' }, { status: 400 })
  }

  const row = await loadRow(teacher_row_id)
  if (!row) return NextResponse.json({ error: '找不到清冊教師' }, { status: 404 })
  const forbidden = await forbidIfNotPlanOwner(auth.access, row.plan_id)
  if (forbidden) return forbidden

  const { myPlan, personSlots } = await loadPersonSlots(row)
  if (!myPlan) return NextResponse.json({ error: '找不到計畫' }, { status: 404 })
  if (start_date < myPlan.start_date || end_date > myPlan.end_date) {
    return NextResponse.json(
      { error: `區段要在計畫期程內（${myPlan.start_date} ～ ${myPlan.end_date}）` }, { status: 400 })
  }
  // 與計畫期程相同＝全期程（存 NULL，才會跟既有的全期程區段合在一起）
  if (start_date === myPlan.start_date && end_date === myPlan.end_date) {
    start_date = null
    end_date = null
  }
  const newEff: [string, string] = [start_date ?? myPlan.start_date, end_date ?? myPlan.end_date]

  const moving = personSlots.filter(s =>
    s.teacher_row_id === row.id && s.start_date === from_start && s.end_date === from_end)
  if (moving.length === 0) return NextResponse.json({ error: '這個區段沒有時段' }, { status: 404 })
  const movingIds = new Set(moving.map(s => s.id))
  const others = personSlots.filter(s => !movingIds.has(s.id))

  for (const m of moving) {
    const clash = others.find(s =>
      s.weekday === m.weekday && s.period === m.period
      && rangesOverlap(s.eff[0], s.eff[1], newEff[0], newEff[1]))
    if (clash) {
      const what = `週${OT_DAY_ZH[m.weekday]}${OT_PERIOD_ZH[m.period]}`
      const where = `${clash.eff[0]} ～ ${clash.eff[1]}`
      return NextResponse.json({
        error: clash.teacher_row_id === row.id
          ? `${what}跟這位老師另一個區段（${where}）重疊；要合併請先刪除那個區段，再改這個區段的日期`
          : `${what}在重疊的時間區段（${where}）已有其他計畫的減課，無法改到這個日期`,
      }, { status: 400 })
    }
  }

  const warning = overCapWarning(row, [...others.map(s => s.eff), ...moving.map(() => newEff)])

  const ids = Array.from(movingIds)
  const { error } = await supabaseAdmin.from('overtime_slots').update({ start_date, end_date }).in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ids, start_date, end_date, warning })
}

/** query: teacher_row_id, start, end（皆空＝全期程區段） */
export async function DELETE(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const sp = request.nextUrl.searchParams
  const teacher_row_id = sp.get('teacher_row_id') ?? ''
  const start = sp.get('start') || null
  const end = sp.get('end') || null
  if (!teacher_row_id) return NextResponse.json({ error: '缺少教師' }, { status: 400 })

  const row = await loadRow(teacher_row_id)
  if (!row) return NextResponse.json({ error: '找不到清冊教師' }, { status: 404 })
  const forbidden = await forbidIfNotPlanOwner(auth.access, row.plan_id)
  if (forbidden) return forbidden

  let q = supabaseAdmin.from('overtime_slots').delete().eq('teacher_row_id', teacher_row_id)
  q = start ? q.eq('start_date', start) : q.is('start_date', null)
  q = end ? q.eq('end_date', end) : q.is('end_date', null)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
