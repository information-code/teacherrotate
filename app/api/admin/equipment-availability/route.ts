import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeAvailability, loadEquipmentConfig } from '@/lib/equipment-server'
import { todayStr } from '@/lib/equipment'
import { hasPerms } from '@/lib/staff-server'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 協助借用：各設備在指定期間的可借台數（逾期未還、長期借用、維修中、已占用都不算可借）。
 * body: { occurrences: [{ start_date, end_date }], start_period?, end_period? }
 *   每週重複時一週一筆；節次省略＝整天（活動保留）。
 * 回傳 { results: [{ start, end, resources: ResourceAvailability[] }] }，順序同 occurrences。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['equipment']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const raw: { start_date?: string; end_date?: string }[] = Array.isArray(body?.occurrences) ? body.occurrences : []
  const today = todayStr()
  const occurrences = raw.slice(0, 40).map(o => ({ start: String(o.start_date ?? ''), end: String(o.end_date ?? '') }))
  if (
    occurrences.length === 0 ||
    occurrences.some(o => !DATE.test(o.start) || !DATE.test(o.end) || o.end < o.start || o.start < today)
  ) {
    return NextResponse.json({ error: '日期無效（不可早於今天，結束不可早於開始）' }, { status: 400 })
  }
  const config = await loadEquipmentConfig()
  const startPeriod = body?.start_period ? String(body.start_period) : undefined
  const endPeriod = body?.end_period ? String(body.end_period) : undefined
  if (
    (startPeriod && !config.openPeriods.includes(startPeriod)) ||
    (endPeriod && !config.openPeriods.includes(endPeriod))
  ) {
    return NextResponse.json({ error: '包含未開放借用的時段' }, { status: 400 })
  }

  try {
    const results = await computeAvailability({ occurrences, startPeriod, endPeriod })
    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json({ error: `系統查詢失敗：${(e as Error).message}` }, { status: 500 })
  }
}
