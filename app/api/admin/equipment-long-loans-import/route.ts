import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'

const MAX_ROWS = 1000

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
 * 長期借用指派表匯入（每台設備一列）。
 * body: { rows: [{設備名稱, 設備編號, 老師姓名, 起始日, 到期日, 備註}] }
 * - 老師姓名留空 → 略過（不影響該設備現有借用）
 * - 該設備已有使用中借用：同一位老師 → 更新起訖日/備註；換老師 → 原借用自動結束＋新增
 * - 該設備無使用中借用 → 新增（狀態一律「使用中」）
 * - 與匯出檔內容完全相同的列視為無變動，自動略過
 * 檢查：設備存在且唯一、老師姓名存在且不同名、日期格式與先後、同設備檔內不可重複指派。
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

  const [{ data: equipment }, { data: profiles }, { data: activeLoans }, { data: shortSlots }] = await Promise.all([
    supabaseAdmin.from('equipment').select('id, name, asset_number'),
    // 借用人比對排除離校教師（離校者姓名會被視為系統外人員並附提醒）
    supabaseAdmin.from('profiles').select('id, name, email').neq('status', 'inactive'),
    supabaseAdmin.from('equipment_long_loans').select('*').eq('status', 'active'),
    // 有效短期借用的占用格（歸還/取消即刪），用於長短期衝突檢查
    supabaseAdmin.from('equipment_loan_slots').select('equipment_id, loan_date'),
  ])

  const slotDates = new Map<string, string[]>()
  for (const s of shortSlots ?? []) {
    const list = slotDates.get(s.equipment_id) ?? []
    list.push(s.loan_date)
    slotDates.set(s.equipment_id, list)
  }
  /** 期間內第一個短期借用日，無衝突回傳 undefined */
  const shortConflict = (equipId: string, start: string, due: string) =>
    (slotDates.get(equipId) ?? []).find(d => d >= start && d <= due)

  // 姓名 → 老師 id 清單（偵測同名）；email → id（同名時的精準比對）
  const teachersByName = new Map<string, string[]>()
  const teacherByEmail = new Map<string, string>()
  for (const p of profiles ?? []) {
    const name = (p.name ?? '').trim()
    if (name) teachersByName.set(name, [...(teachersByName.get(name) ?? []), p.id])
    teacherByEmail.set(p.email.toLowerCase(), p.id)
  }
  const activeByEquipment = new Map((activeLoans ?? []).map(l => [l.equipment_id, l]))

  /**
   * 解析借用人欄位：
   * 「姓名（系統外）」→ 系統外人員；「姓名（email）」→ email 精準比對（同名老師用）；
   * 純姓名 → 唯一比對，同名回報錯誤，查無視為系統外人員（附提醒讓管理者確認非打錯字）。
   */
  const resolveBorrower = (raw: string):
    | { teacherId: string }
    | { externalName: string; note?: string }
    | { error: string } => {
    const m = raw.match(/^(.+?)[（(]([^（()）]+)[)）]$/)
    if (m) {
      const base = m[1].trim()
      const inner = m[2].trim()
      if (inner === '系統外') return { externalName: base }
      if (inner.includes('@')) {
        const id = teacherByEmail.get(inner.toLowerCase())
        return id ? { teacherId: id } : { error: `Email「${inner}」不存在於系統帳號中` }
      }
    }
    const ids = teachersByName.get(raw) ?? []
    if (ids.length === 1) return { teacherId: ids[0] }
    if (ids.length > 1) return { error: `系統有 ${ids.length} 位「${raw}」，請用下拉選單的「姓名（email）」格式指定` }
    return {
      externalName: raw,
      note: `「${raw}」不在系統名單中，已建立為【系統外人員】，請確認不是打錯字`,
    }
  }

  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const errors: string[] = []
  const warnings: string[] = []
  let skipped = 0
  let unchanged = 0
  const assignedInFile = new Map<string, number>() // equipment_id → 首次指派列號
  const now = new Date().toISOString()

  rows.forEach((row: Record<string, unknown>, index: number) => {
    const line = index + 2 // Excel 列號（含標題列）
    const equipName = String(row['設備名稱'] ?? '').trim()
    if (!equipName || equipName.startsWith('（範例）') || equipName.startsWith('(範例)') || equipName.startsWith('（尚無設備')) {
      skipped++
      return
    }

    // 老師姓名留空＝不指派，直接略過
    const teacherNameRaw = String(row['老師姓名'] ?? '').trim()
    if (!teacherNameRaw) {
      skipped++
      return
    }

    // 設備：名稱＋編號比對
    const assetNumber = String(row['設備編號'] ?? '').trim()
    const matched = (equipment ?? []).filter(e => e.name === equipName && (e.asset_number ?? '') === assetNumber)
    if (matched.length === 0) {
      errors.push(`第 ${line} 列：找不到設備「${equipName}${assetNumber ? ` #${assetNumber}` : ''}」，設備名稱與編號請勿修改`)
      return
    }
    if (matched.length > 1) {
      errors.push(`第 ${line} 列：「${equipName}${assetNumber ? ` #${assetNumber}` : ''}」對應到多台設備，請先到設備庫補齊編號`)
      return
    }
    const equipmentId = matched[0].id

    // 借用人解析：系統帳號或系統外人員
    const borrower = resolveBorrower(teacherNameRaw)
    if ('error' in borrower) {
      errors.push(`第 ${line} 列：${borrower.error}`)
      return
    }
    const teacherId = 'teacherId' in borrower ? borrower.teacherId : null
    const externalName = 'externalName' in borrower ? borrower.externalName : ''
    if ('note' in borrower && borrower.note) warnings.push(`第 ${line} 列：${borrower.note}`)

    const startDate = parseDate(row['起始日'])
    const dueDate = parseDate(row['到期日'])
    if (!startDate) {
      errors.push(`第 ${line} 列：起始日缺少或格式錯誤（請用 2026-08-01 格式）`)
      return
    }
    if (!dueDate) {
      errors.push(`第 ${line} 列：到期日缺少或格式錯誤（請用 2026-12-18 格式）`)
      return
    }
    if (dueDate < startDate) {
      errors.push(`第 ${line} 列：到期日（${dueDate}）不可早於起始日（${startDate}）`)
      return
    }

    const firstLine = assignedInFile.get(equipmentId)
    if (firstLine !== undefined) {
      errors.push(`第 ${line} 列：與第 ${firstLine} 列是同一台設備，同一設備只能指派給一位老師`)
      return
    }
    assignedInFile.set(equipmentId, line)

    const notes = String(row['備註'] ?? '').trim()
    const current = activeByEquipment.get(equipmentId)
    const sameBorrower = current && (
      teacherId ? current.teacher_id === teacherId
                : !current.teacher_id && current.external_name === externalName
    )

    if (current && sameBorrower) {
      // 同一位借用人：內容沒變就略過，有變才更新
      if (current.start_date === startDate && current.due_date === dueDate && current.notes === notes) {
        unchanged++
        return
      }
      const conflict = shortConflict(equipmentId, startDate, dueDate)
      if (conflict) {
        errors.push(`第 ${line} 列：長期借用期間內已有短期借用（${conflict}），請先處理該短期借用`)
        return
      }
      updates.push({ ...current, start_date: startDate, due_date: dueDate, notes, updated_at: now })
      return
    }
    const conflict = shortConflict(equipmentId, startDate, dueDate)
    if (conflict) {
      errors.push(`第 ${line} 列：長期借用期間內已有短期借用（${conflict}），請先處理該短期借用`)
      return
    }
    if (current) {
      // 換借用人：原借用結束，另立新紀錄（保留續借歷史歸屬）
      updates.push({ ...current, status: 'ended', updated_at: now })
    }
    inserts.push({
      equipment_id: equipmentId,
      teacher_id: teacherId,
      external_name: teacherId ? '' : externalName,
      start_date: startDate,
      due_date: dueDate,
      status: 'active',
      notes,
    })
  })

  if (inserts.length === 0 && updates.length === 0) {
    return NextResponse.json(
      {
        error: errors.length > 0
          ? `沒有可套用的變更。${errors.join('；')}`
          : '沒有變更：檔案內容與系統現況相同，或老師欄皆為空白。',
      },
      { status: 400 }
    )
  }

  // 先更新（含結束原借用），再新增接手的借用
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
    unchanged,
    skipped,
    errors,
    warnings,
  })
}
