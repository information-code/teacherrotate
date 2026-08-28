import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'
import { OT_WEEKLY_CAP, otCategoryLabel } from '@/lib/overtime'

/**
 * 新增減課時段。body: { teacher_row_id, weekday, period, class_name, domain }
 * 檢查（同一人跨計畫合計，系統帳號比對 teacher_id、手動比對姓名）：
 *  - 同星期節次不可重複（人不能同時在兩個地方減課）
 *  - 正式／代理每人每週上限 6 節（鐘點人員無上限）
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
  if (!teacher_row_id) return NextResponse.json({ error: '缺少教師' }, { status: 400 })
  if (!(weekday >= 1 && weekday <= 5)) return NextResponse.json({ error: '星期無效' }, { status: 400 })
  if (!(period >= 1 && period <= 7)) return NextResponse.json({ error: '節次無效' }, { status: 400 })

  const { data: row } = await supabaseAdmin.from('overtime_teachers')
    .select('id, teacher_id, name, category').eq('id', teacher_row_id).single()
  if (!row) return NextResponse.json({ error: '找不到清冊教師' }, { status: 404 })

  // 同一人所有清冊列（跨計畫）
  let q = supabaseAdmin.from('overtime_teachers').select('id, category')
  q = row.teacher_id ? q.eq('teacher_id', row.teacher_id) : q.eq('name', row.name).is('teacher_id', null)
  const { data: sameTeacher } = await q
  const rowIds = (sameTeacher ?? []).map(r => r.id)

  const { data: slots } = await supabaseAdmin.from('overtime_slots')
    .select('teacher_row_id, weekday, period').in('teacher_row_id', rowIds)
  const existing = slots ?? []

  if (existing.some(s => s.weekday === weekday && s.period === period)) {
    return NextResponse.json({ error: '這位教師該星期節次已有減課時段（含其他計畫）' }, { status: 400 })
  }
  if (row.category !== 'hourly' && existing.length >= OT_WEEKLY_CAP) {
    return NextResponse.json(
      { error: `${otCategoryLabel(row.category)}教師每人每週上限 ${OT_WEEKLY_CAP} 節（含其他計畫共 ${existing.length} 節）` },
      { status: 400 },
    )
  }

  const { data, error } = await supabaseAdmin.from('overtime_slots')
    .insert({ teacher_row_id, weekday, period, class_name, domain }).select().single()
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
