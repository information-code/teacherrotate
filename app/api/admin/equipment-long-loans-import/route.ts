import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'

const MAX_ROWS = 500
const STATUS_MAP: Record<string, string> = { 使用中: 'active', 已結束: 'ended' }

/** 接受 'YYYY-MM-DD'、'YYYY/M/D' 或 Excel 日期序號，回傳 ISO 日期字串或 null */
function parseDate(raw: unknown): string | null {
  if (typeof raw === 'number' && isFinite(raw)) {
    // Excel 序號：1970-01-01 為 25569（1900 日期系統）
    const d = new Date(Math.round((raw - 25569) * 86400000))
    if (isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  }
  const s = String(raw ?? '').trim().replaceAll('/', '-')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return isNaN(Date.parse(iso)) ? null : iso
}

/**
 * 長期借用 Excel 匯入（與匯出檔互為同步）。
 * body: { rows: [{id?, 設備名稱, 設備編號, 老師Email, 起始日, 到期日, 狀態, 備註}] }
 * - 有 id 且存在 → 更新；id 空白 → 新增；未列出的紀錄不受影響
 * 檢查：設備存在（同名多台須以編號指定）、老師 Email 存在、日期格式與先後、
 *       同一設備同時只能有一筆「使用中」（檔案內互查＋與資料庫比對）。
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

  const [{ data: existingLoans }, { data: equipment }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_long_loans').select('id, equipment_id, status'),
    supabaseAdmin.from('equipment').select('id, name, asset_number'),
    supabaseAdmin.from('profiles').select('id, email'),
  ])
  const existingIds = new Set((existingLoans ?? []).map(l => l.id))
  const teacherByEmail = new Map((profiles ?? []).map(p => [p.email.toLowerCase(), p.id]))

  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const errors: string[] = []
  let skipped = 0

  // 第一遍：解析與逐列驗證，並收齊本檔案要更新的紀錄 id
  interface Candidate {
    line: number
    id: string
    equipmentId: string
    status: string
    payload: Record<string, unknown>
  }
  const candidates: Candidate[] = []
  const updateIdsInFile = new Set<string>()

  rows.forEach((row: Record<string, unknown>, index: number) => {
    const line = index + 2 // Excel 列號（含標題列）
    const name = String(row['設備名稱'] ?? '').trim()
    if (!name) {
      errors.push(`第 ${line} 列：缺少設備名稱`)
      return
    }
    if (name.startsWith('（範例）') || name.startsWith('(範例)')) {
      skipped++
      return
    }

    const id = String(row['id'] ?? '').trim()
    if (id && !existingIds.has(id)) {
      errors.push(`第 ${line} 列：id 不存在於系統中（請勿自行填寫 id，新增請留空）`)
      return
    }

    // 設備：名稱（＋編號）唯一定位
    const assetNumber = String(row['設備編號'] ?? '').trim()
    const matched = (equipment ?? []).filter(e =>
      e.name === name && (!assetNumber || e.asset_number === assetNumber)
    )
    if (matched.length === 0) {
      errors.push(`第 ${line} 列：找不到設備「${name}${assetNumber ? ` #${assetNumber}` : ''}」，請確認名稱與編號和設備庫一致`)
      return
    }
    if (matched.length > 1) {
      errors.push(`第 ${line} 列：「${name}」有 ${matched.length} 台，請填寫設備編號指定是哪一台`)
      return
    }

    const email = String(row['老師Email'] ?? '').trim().toLowerCase()
    if (!email) {
      errors.push(`第 ${line} 列：缺少老師Email`)
      return
    }
    const teacherId = teacherByEmail.get(email)
    if (!teacherId) {
      errors.push(`第 ${line} 列：老師Email「${email}」不存在於系統帳號中`)
      return
    }

    const startDate = parseDate(row['起始日'])
    const dueDate = parseDate(row['到期日'])
    if (!startDate) {
      errors.push(`第 ${line} 列：起始日格式錯誤（請用 2026-08-01 格式）`)
      return
    }
    if (!dueDate) {
      errors.push(`第 ${line} 列：到期日格式錯誤（請用 2026-12-18 格式）`)
      return
    }
    if (dueDate < startDate) {
      errors.push(`第 ${line} 列：到期日（${dueDate}）不可早於起始日（${startDate}）`)
      return
    }

    const statusRaw = String(row['狀態'] ?? '').trim()
    if (statusRaw && !STATUS_MAP[statusRaw]) {
      errors.push(`第 ${line} 列：狀態「${statusRaw}」無效（使用中／已結束）`)
      return
    }
    const status = STATUS_MAP[statusRaw] ?? 'active'

    if (id) updateIdsInFile.add(id)
    candidates.push({
      line,
      id,
      equipmentId: matched[0].id,
      status,
      payload: {
        equipment_id: matched[0].id,
        teacher_id: teacherId,
        start_date: startDate,
        due_date: dueDate,
        status,
        notes: String(row['備註'] ?? '').trim(),
      },
    })
  })

  // 第二遍：同一設備同時只能有一筆「使用中」。
  // 檔案內互查用各列更新後的狀態；資料庫既有的使用中紀錄若也在本檔案更新名單中，
  // 以檔案內容為準、不算占用。
  const activeInFile = new Map<string, number>() // equipment_id → 首次出現列號
  const dbActiveOwner = new Map<string, string>() // equipment_id → 使用中紀錄 id
  for (const l of existingLoans ?? []) {
    if (l.status === 'active') dbActiveOwner.set(l.equipment_id, l.id)
  }

  for (const c of candidates) {
    if (c.status === 'active') {
      const firstLine = activeInFile.get(c.equipmentId)
      if (firstLine !== undefined) {
        errors.push(`第 ${c.line} 列：與第 ${firstLine} 列同一台設備都是「使用中」，同一設備同時只能借給一位老師`)
        continue
      }
      const ownerId = dbActiveOwner.get(c.equipmentId)
      if (ownerId && ownerId !== c.id && !updateIdsInFile.has(ownerId)) {
        errors.push(`第 ${c.line} 列：這台設備已有使用中的長期借用，請先結束原借用或改用其他設備`)
        continue
      }
      activeInFile.set(c.equipmentId, c.line)
    }
    if (c.id) updates.push({ ...c.payload, id: c.id, updated_at: new Date().toISOString() })
    else inserts.push(c.payload)
  }

  if (inserts.length === 0 && updates.length === 0) {
    return NextResponse.json(
      { error: `沒有可匯入的資料。${errors.length > 0 ? errors.join('；') : ''}` },
      { status: 400 }
    )
  }

  // 先更新後新增：更新可先結束原借用，新紀錄才能接手同一台設備
  if (updates.length > 0) {
    const { error } = await supabaseAdmin
      .from('equipment_long_loans').upsert(updates as never, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: `更新失敗：${error.message}` }, { status: 500 })
  }
  if (inserts.length > 0) {
    const { error } = await supabaseAdmin.from('equipment_long_loans').insert(inserts as never)
    if (error) return NextResponse.json({ error: `新增失敗：${error.message}` }, { status: 500 })
  }

  return NextResponse.json({
    createdCount: inserts.length,
    updatedCount: updates.length,
    skipped,
    errors,
  })
}
