import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadLendingBoard } from '@/lib/equipment-board'

/**
 * 教師端「借用情況」：指定日期的設備課表（誰預約、誰借用、誰歸還）與此刻設備分布。
 * query: date?（預設今天）。只回課表與分布，不含管理端的需處理清單與長借明細。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await loadLendingBoard(request.nextUrl.searchParams.get('date'))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  const { date, today, nowPeriod, openPeriods, board, dist } = result.data
  return NextResponse.json({ date, today, nowPeriod, openPeriods, board, dist })
}
