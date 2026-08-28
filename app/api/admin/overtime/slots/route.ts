import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import {
  OT_WEEKLY_CAP, otCategoryLabel, isCappedCategory, isDateStr,
  rangesOverlap, maxConcurrentSlots,
} from '@/lib/overtime'

/**
 * 新增減課時段。body: { teacher_row_id, weekday, period, class_name, domain, start_date?, end_date? }
 * start/end_date＝這個時段生效的時間區段（NULL＝整個計畫期程）。
 * 檢查（同一人跨計畫合計，系統帳號比對 teacher_id、手動比對姓名）：
 *  - 同星期節次僅在「生效區段重疊」時衝突（不重疊的區段可各自成立）
 *  - 正式／代理：同時生效的減課節數（掃描線最大值）不得超過每週 6 節
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const teacher_row_id = String(body?.teacher_row_id ?? '')
  const weekday = Math.round(Number(body?.weekday))
  const period = Math.round(Number(body?.period))
  const class_name = String(body?.class_name ?? '').trim()
  const domain = String(body?.domain ?? '').trim()
  const start_date = body?.start_date ? String(body.start_date) : null
  const end_date = body?.end_date ? String(body.end_date) : null
  if (!teacher_row_id) return NextResponse.json({ error: '缺少教師' }, { status: 400 })
  if (!(weekday >= 1 && weekday <= 5)) return NextResponse.json({ error: '星期無效' }, { status: 400 })
  if (!(period >= 1 && period <= 7)) return NextResponse.json({ error: '節次無效' }, { status: 400 })
  if ((start_date === null) !== (end_date === null)) {
    return NextResponse.json({ error: '時間區段要同時有開始與結束' }, { status: 400 })
  }
  if (start_date && (!isDateStr(start_date) || !isDateStr(end_date!) || start_date > end_date!)) {
    return NextResponse.json({ error: '時間區段日期無效' }, { status: 400 })
  }

  const { data: row } = await supabaseAdmin.from('overtime_teachers')
    .select('id, teacher_id, name, category, plan_id').eq('id', teacher_row_id).single()
  if (!row) return NextResponse.json({ error: '找不到清冊教師' }, { status: 404 })

  // 同一人所有清冊列（跨計畫）＋各列所屬計畫期程
  let q = supabaseAdmin.from('overtime_teachers').select('id, plan_id')
  q = row.teacher_id ? q.eq('teacher_id', row.teacher_id) : q.eq('name', row.name).is('teacher_id', null)
  const { data: sameTeacher } = await q
  const rows = sameTeacher ?? []
  const rowIds = rows.map(r => r.id)
  const planIds = Array.from(new Set(rows.map(r => r.plan_id)))

  const [{ data: slots }, { data: plans }] = await Promise.all([
    supabaseAdmin.from('overtime_slots')
      .select('teacher_row_id, weekday, period, start_date, end_date').in('teacher_row_id', rowIds),
    supabaseAdmin.from('overtime_plans').select('id, start_date, end_date').in('id', planIds),
  ])
  const planOf = Object.fromEntries((plans ?? []).map(p => [p.id, p]))
  const planOfRow = Object.fromEntries(rows.map(r => [r.id, planOf[r.plan_id]]))

  const eff = (s: { teacher_row_id: string; start_date: string | null; end_date: string | null }): [string, string] | null => {
    const p = planOfRow[s.teacher_row_id]
    if (!p) return null
    return [s.start_date ?? p.start_date, s.end_date ?? p.end_date]
  }
  const myPlan = planOf[row.plan_id]
  if (!myPlan) return NextResponse.json({ error: '找不到計畫' }, { status: 404 })
  const newEff: [string, string] = [start_date ?? myPlan.start_date, end_date ?? myPlan.end_date]

  const existing = (slots ?? [])
    .map(s => ({ ...s, eff: eff(s) }))
    .filter((s): s is typeof s & { eff: [string, string] } => s.eff !== null)

  const clash = existing.find(s =>
    s.weekday === weekday && s.period === period
    && rangesOverlap(s.eff[0], s.eff[1], newEff[0], newEff[1]))
  if (clash) {
    return NextResponse.json(
      { error: `這位教師該星期節次在重疊的時間區段（${clash.eff[0]} ～ ${clash.eff[1]}）已有減課（含其他計畫）` },
      { status: 400 },
    )
  }

  if (isCappedCategory(row.category)) {
    const peak = maxConcurrentSlots([...existing.map(s => s.eff), newEff])
    if (peak > OT_WEEKLY_CAP) {
      return NextResponse.json(
        { error: `${otCategoryLabel(row.category)}教師同一週最多 ${OT_WEEKLY_CAP} 節（加入後同時生效將達 ${peak} 節，含其他計畫）` },
        { status: 400 },
      )
    }
  }

  const { data, error } = await supabaseAdmin.from('overtime_slots')
    .insert({ teacher_row_id, weekday, period, class_name, domain, start_date, end_date })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除減課時段。query: id */
export async function DELETE(request: NextRequest) {
  const auth = await requirePerms(['overtime'])
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('overtime_slots').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
