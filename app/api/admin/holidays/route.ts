import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requirePerms } from '@/lib/staff-server'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 政府行政機關辦公日曆表（人事行政總處資料的社群整理版，逐年 JSON）
const HOLIDAY_SOURCES = [
  (year: number) => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`,
  (year: number) => `https://raw.githubusercontent.com/ruyut/TaiwanCalendar/master/data/${year}.json`,
]

interface CalendarEntry { date: string; week: string; isHoliday: boolean; description: string }

/** 假日列表。query: year（所有可發布者皆可讀，行事曆頁需要） */
export async function GET(request: NextRequest) {
  const auth = await requirePerms(['calendar', 'holidays'])
  if ('error' in auth) return auth.error

  const year = Number(request.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: '年份無效' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('holidays').select('*')
    .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`).order('date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/**
 * 同步年度假日（政府行政機關辦公日曆表）。body: { year }
 * 僅收有說明的日期（國定假日、補假、補行上班），一般週休二日由前端以星期判斷。
 * 覆蓋既有 source='sync' 資料；手動新增（source='manual'）不受影響。
 */
export async function POST(request: NextRequest) {
  const auth = await requirePerms(['holidays'])
  if ('error' in auth) return auth.error

  const { year } = await request.json()
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: '年份無效' }, { status: 400 })
  }

  let entries: CalendarEntry[] | null = null
  let lastError = ''
  for (const buildUrl of HOLIDAY_SOURCES) {
    try {
      const res = await fetch(buildUrl(year), { cache: 'no-store' })
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue }
      const json = await res.json()
      if (Array.isArray(json)) { entries = json; break }
      lastError = '資料格式不符'
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  if (!entries) {
    return NextResponse.json(
      { error: `無法取得 ${year} 年辦公日曆表（${lastError}），政府資料可能尚未發布，請稍後再試或手動新增。` },
      { status: 502 }
    )
  }

  const rows = entries
    .filter(e => /^\d{8}$/.test(e.date) && String(e.description ?? '').trim())
    .map(e => ({
      date: `${e.date.slice(0, 4)}-${e.date.slice(4, 6)}-${e.date.slice(6, 8)}`,
      name: String(e.description).trim(),
      is_holiday: Boolean(e.isHoliday),
      source: 'sync',
      updated_at: new Date().toISOString(),
    }))
  if (rows.length === 0) {
    return NextResponse.json({ error: `${year} 年資料中沒有可同步的假日。` }, { status: 502 })
  }

  // 先清掉該年舊的同步資料再寫入（手動資料保留；同日手動資料以同步結果覆蓋）
  const { error: delError } = await supabaseAdmin.from('holidays').delete()
    .eq('source', 'sync').gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  const { error } = await supabaseAdmin.from('holidays')
    .upsert(rows, { onConflict: 'date' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: rows.length })
}

/** 手動新增／修改單日。body: { date, name, is_holiday } */
export async function PUT(request: NextRequest) {
  const auth = await requirePerms(['holidays'])
  if ('error' in auth) return auth.error

  const body = await request.json()
  const date = String(body?.date ?? '')
  const name = String(body?.name ?? '').trim()
  if (!DATE_RE.test(date)) return NextResponse.json({ error: '日期格式無效' }, { status: 400 })
  if (!name) return NextResponse.json({ error: '請填寫名稱' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('holidays').upsert({
    date,
    name,
    is_holiday: body?.is_holiday !== false,
    source: 'manual',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'date' }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除單日。query: date */
export async function DELETE(request: NextRequest) {
  const auth = await requirePerms(['holidays'])
  if ('error' in auth) return auth.error

  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!DATE_RE.test(date)) return NextResponse.json({ error: '日期格式無效' }, { status: 400 })

  const { error } = await supabaseAdmin.from('holidays').delete().eq('date', date)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
