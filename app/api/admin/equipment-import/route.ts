import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import type { ChecklistItem } from '@/lib/equipment'

const MAX_ROWS = 500
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
 * 設備庫 Excel 匯入（與匯出檔互為同步）。
 * body: { rows: [{id?, 名稱, 位置, 編號, 狀態, 週邊配件, 借用檢查項目, 歸還檢查項目, 備註}] }
 * - 有 id 且存在 → 更新該設備
 * - id 空白 → 新增設備
 * - 檔案中未列出的設備不受影響（不做刪除）
 * 回傳 { createdCount, updatedCount, skipped, errors }
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

  const { data: existing } = await supabaseAdmin.from('equipment').select('id, name, asset_number')
  const existingIds = new Set((existing ?? []).map(e => e.id))
  // 「名稱|編號」→ 設備 id（僅非空編號）：同名設備編號不可重複，不同名可同編號
  const numberOwner = new Map<string, string>(
    (existing ?? []).filter(e => e.asset_number).map(e => [`${e.name}|${e.asset_number}`, e.id])
  )
  const seenNumbers = new Map<string, number>() // 檔案內「名稱|編號」→ 首次出現列號

  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
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
    const id = String(row['id'] ?? '').trim()
    if (id && !existingIds.has(id)) {
      errors.push(`第 ${line} 列：id 不存在於系統中（請勿自行填寫 id，新增請留空）`)
      return
    }

    // 同名設備編號唯一：檔案內不可重複；與資料庫比對（更新自己那台除外）
    const assetNumber = String(row['編號'] ?? '').trim()
    if (assetNumber) {
      const key = `${name}|${assetNumber}`
      const firstLine = seenNumbers.get(key)
      if (firstLine !== undefined) {
        errors.push(`第 ${line} 列：「${name}」編號「${assetNumber}」與第 ${firstLine} 列重複，同名設備編號不可重複`)
        return
      }
      const ownerId = numberOwner.get(key)
      if (ownerId && ownerId !== id) {
        errors.push(`第 ${line} 列：「${name}」已有編號「${assetNumber}」的設備，同名設備編號不可重複`)
        return
      }
      seenNumbers.set(key, line)
    }

    const payload = {
      name,
      location: String(row['位置'] ?? '').trim(),
      asset_number: String(row['編號'] ?? '').trim(),
      status: STATUS_MAP[statusRaw] ?? 'available',
      peripherals: splitList(row['週邊配件']),
      borrow_checklist: parseChecklist(row['借用檢查項目']),
      return_checklist: parseChecklist(row['歸還檢查項目']),
      notes: String(row['備註'] ?? '').trim(),
    }
    if (id) updates.push({ ...payload, id, updated_at: new Date().toISOString() })
    else inserts.push(payload)
  })

  if (inserts.length === 0 && updates.length === 0) {
    return NextResponse.json(
      { error: `沒有可匯入的資料。${errors.length > 0 ? errors.join('；') : ''}` },
      { status: 400 }
    )
  }

  if (inserts.length > 0) {
    const { error } = await supabaseAdmin.from('equipment').insert(inserts as never)
    if (error) return NextResponse.json({ error: `新增失敗：${error.message}` }, { status: 500 })
  }
  if (updates.length > 0) {
    const { error } = await supabaseAdmin
      .from('equipment').upsert(updates as never, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: `更新失敗：${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    createdCount: inserts.length,
    updatedCount: updates.length,
    skipped,
    errors,
  })
}
