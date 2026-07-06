import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig } from '@/lib/equipment-server'
import { addDays, todayStr } from '@/lib/equipment'

/**
 * 教師端短期借用總覽。
 * query: date?（預設今天）
 * 回傳 { config, date, equipment（僅可借用狀態）, occupied: {設備id: 節次[]}, myLoans }
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = await loadEquipmentConfig()
  const today = todayStr()
  const maxDate = addDays(today, config.maxAdvanceDays)

  let date = request.nextUrl.searchParams.get('date') ?? today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today
  if (date < today) date = today
  if (date > maxDate) date = maxDate

  const [{ data: equipment }, { data: slots }, { data: myLoans }] = await Promise.all([
    supabaseAdmin.from('equipment').select('*')
      .eq('status', 'available').order('sort_order').order('created_at'),
    supabaseAdmin.from('equipment_loan_slots').select('equipment_id, period').eq('loan_date', date),
    supabaseAdmin.from('equipment_loans').select('*')
      .eq('teacher_id', user.id)
      .in('status', ['reserved', 'borrowed', 'returned', 'closed'])
      .order('loan_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  const occupied: Record<string, string[]> = {}
  for (const s of slots ?? []) {
    ;(occupied[s.equipment_id] ??= []).push(s.period)
  }

  const equipMap = new Map((equipment ?? []).map(e => [e.id, e.name]))
  // 歷史紀錄的設備可能已停用/刪除，補查名稱
  const missingIds = Array.from(new Set(
    (myLoans ?? []).map(l => l.equipment_id).filter(id => !equipMap.has(id))
  ))
  if (missingIds.length > 0) {
    const { data: extra } = await supabaseAdmin.from('equipment').select('id, name').in('id', missingIds)
    for (const e of extra ?? []) equipMap.set(e.id, e.name)
  }

  return NextResponse.json({
    config: { ...config, today, maxDate },
    date,
    equipment: equipment ?? [],
    occupied,
    myLoans: (myLoans ?? []).map(l => ({
      ...l,
      equipment_name: equipMap.get(l.equipment_id) ?? '（已刪除設備）',
    })),
  })
}
