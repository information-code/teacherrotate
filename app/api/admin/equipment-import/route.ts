import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import type { ChecklistItem } from '@/lib/equipment'

const MAX_ROWS = 200
const STATUS_MAP: Record<string, string> = {
  可借用: 'available',
  維修中: 'maintenance',
  停用: 'retired',
}

/** 「、」「,」「，」「;」「；」或換行分隔 → 字串陣列 */
function splitList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[、,，;；\n]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** 項目結尾「*」代表需拍照 */
function parseChecklist(raw: unknown): ChecklistItem[] {
  return splitList(raw).map(item =>
    item.endsWith('*')
      ? { label: item.slice(0, -1).trim(), requiresPhoto: true }
      : { label: item, requiresPhoto: false }
  )
}

/**
 * 設備批次匯入。body: { rows: [{名稱, 位置, 編號, 狀態, 週邊配件, 借用檢查項目, 歸還檢查項目, 備註}] }
 * 名稱以「（範例）」開頭的列自動略過。回傳 { created, skipped, errors }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { rows } = await request.json()
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '檔案中沒有資料列' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `一次最多匯入 ${MAX_ROWS} 列` }, { status: 400 })
  }

  const payloads: Record<string, unknown>[] = []
  const errors: string[] = []
  let skipped = 0

  rows.forEach((row: Record<string, unknown>, index: number) => {
    const line = index + 2 // Excel 列號（含標題列）
    const name = String(row['名稱'] ?? '').trim()
    if (!name) {
      errors.push(`第 ${line} 列：缺少名稱`)
      return
    }
    if (name.startsWith('（範例）') || name.startsWith('(範例)')) {
      skipped++
      return
    }
    const statusRaw = String(row['狀態'] ?? '').trim()
    if (statusRaw && !STATUS_MAP[statusRaw]) {
      errors.push(`第 ${line} 列：狀態「${statusRaw}」無效（可借用／維修中／停用）`)
      return
    }
    payloads.push({
      name,
      location: String(row['位置'] ?? '').trim(),
      asset_number: String(row['編號'] ?? '').trim(),
      status: STATUS_MAP[statusRaw] ?? 'available',
      peripherals: splitList(row['週邊配件']),
      borrow_checklist: parseChecklist(row['借用檢查項目']),
      return_checklist: parseChecklist(row['歸還檢查項目']),
      notes: String(row['備註'] ?? '').trim(),
    })
  })

  if (payloads.length === 0) {
    return NextResponse.json(
      { error: `沒有可匯入的資料。${errors.length > 0 ? errors.join('；') : ''}` },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from('equipment').insert(payloads as never).select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: data ?? [], skipped, errors })
}
