import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  addDays,
  dateRangeList,
  daySlotPeriods,
  loanTimeText,
  normalizeEquipmentConfig,
  todayStr,
  type ChecklistItem,
  type ChecklistResult,
  type EquipmentConfig,
} from '@/lib/equipment'

export const EQUIPMENT_PHOTO_BUCKET = 'equipment-photos'

export async function checkAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

export async function loadEquipmentConfig(): Promise<EquipmentConfig> {
  const { data } = await supabaseAdmin.from('equipment_config').select('config').eq('id', 1).maybeSingle()
  return normalizeEquipmentConfig(data?.config)
}

/** 產生照片簽名網址（私有 bucket），回傳 path → url 對照表 */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths)).filter(Boolean)
  if (unique.length === 0) return {}
  // 案件報表會一次簽全校歷史照片，切段送出避免單一請求過大
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += 500) chunks.push(unique.slice(i, i + 500))
  const results = await Promise.all(chunks.map(chunk =>
    supabaseAdmin.storage.from(EQUIPMENT_PHOTO_BUCKET).createSignedUrls(chunk, 60 * 60)
  ))
  const map: Record<string, string> = {}
  for (const { data } of results) {
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) map[item.path] = item.signedUrl
    }
  }
  return map
}

/**
 * 寫入借用操作日誌（一個操作一條）。設備與人名以快照存文字。
 * 日誌寫入失敗不影響主流程。
 */
export async function logLoanEvent(opts: {
  loanId: string
  equipmentId?: string | null
  groupId?: string | null
  teacherId: string
  action: 'reserved' | 'borrowed' | 'returned' | 'cancelled' | 'released' | 'closed'
  detail: string
  actorId?: string
  /** 群組借 N 台：快照名稱顯示「（N 台）」而非「（整組）」 */
  unitCount?: number
}): Promise<void> {
  try {
    const [equipRes, groupRes, teacherRes, actorRes] = await Promise.all([
      opts.equipmentId
        ? supabaseAdmin.from('equipment').select('name, asset_number').eq('id', opts.equipmentId).maybeSingle()
        : Promise.resolve({ data: null }),
      opts.groupId
        ? supabaseAdmin.from('equipment_groups').select('name').eq('id', opts.groupId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from('profiles').select('name, email').eq('id', opts.teacherId).maybeSingle(),
      opts.actorId && opts.actorId !== opts.teacherId
        ? supabaseAdmin.from('profiles').select('name, email').eq('id', opts.actorId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const teacherName = teacherRes.data?.name ?? teacherRes.data?.email ?? ''
    const equipmentName = opts.groupId
      ? `${groupRes.data?.name ?? '（已刪除群組）'}（${opts.unitCount ? `${opts.unitCount} 台` : '整組'}）`
      : (equipRes.data as { name?: string } | null)?.name ?? '（已刪除設備）'
    await supabaseAdmin.from('equipment_loan_events').insert({
      loan_id: opts.loanId,
      equipment_id: opts.equipmentId ?? null,
      equipment_name: equipmentName,
      asset_number: (equipRes.data as { asset_number?: string } | null)?.asset_number ?? '',
      teacher_id: opts.teacherId,
      teacher_name: teacherName,
      action: opts.action,
      detail: opts.detail,
      actor_name: actorRes.data ? (actorRes.data.name ?? actorRes.data.email ?? '') : teacherName,
    })
  } catch {
    // 日誌失敗不影響借用主流程
  }
}

/** 從檢查結果快照收集所有照片 path */
export function collectChecklistPhotos(checklist: unknown): string[] {
  if (!Array.isArray(checklist)) return []
  return checklist.flatMap(item =>
    Array.isArray((item as ChecklistResult)?.photos) ? (item as ChecklistResult).photos : []
  )
}

/**
 * 驗證教師送出的檢查結果是否符合設備定義：
 * 項目一一對應、全部勾選、需拍照項目至少 1 張（至多 maxPhotos 張）。
 * 通過回傳正規化後的快照，不通過回傳錯誤訊息。
 */
export function validateChecklistResult(
  definition: ChecklistItem[],
  submitted: unknown,
  maxPhotos: number
): { ok: true; result: ChecklistResult[] } | { ok: false; error: string } {
  const list = Array.isArray(submitted) ? (submitted as ChecklistResult[]) : []
  if (list.length !== definition.length) return { ok: false, error: '檢查項目與設備定義不符，請重新整理後再試。' }

  const result: ChecklistResult[] = []
  for (let i = 0; i < definition.length; i++) {
    const def = definition[i]
    const sub = list[i]
    if (!sub || sub.label !== def.label) return { ok: false, error: '檢查項目與設備定義不符，請重新整理後再試。' }
    if (!sub.checked) return { ok: false, error: `「${def.label}」尚未完成勾選。` }
    const photos = Array.isArray(sub.photos) ? sub.photos.filter(p => typeof p === 'string') : []
    if (def.requiresPhoto && photos.length === 0) return { ok: false, error: `「${def.label}」需要拍照上傳。` }
    if (photos.length > maxPhotos) return { ok: false, error: `「${def.label}」照片最多 ${maxPhotos} 張。` }
    result.push({ label: def.label, requiresPhoto: def.requiresPhoto, checked: true, photos })
  }
  return { ok: true, result }
}

/**
 * 建立短期借用（訂房式，支援跨日；單台或整組）——教師自訂與管理端代訂共用。
 * 首日從開始時段起、末日到結束時段止、中間日整天保留；
 * 交易式寫入（期間內任一格被占用整筆回滾），成功寫入「已預約」並記日誌。
 * enforceMaxAdvance：教師自訂受「可預借天數」上限；管理端代訂只要求不早於今天。
 * actorId：管理端代訂時填操作者，日誌 actor 會顯示管理者而非老師。
 */
export async function reserveShortLoan(opts: {
  teacherId: string
  equipmentId?: string | null
  groupId?: string | null
  startDate: string
  endDate: string
  startPeriod: string
  endPeriod: string
  actorId?: string
  /** 群組借用台數（1～可借數）；未指定＝整組全部成員（舊語意，全員可用才可借） */
  quantity?: number
  /** 每週重複建立時串起多筆借用的系列 id */
  seriesId?: string
  enforceMaxAdvance: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  const { teacherId, equipmentId, groupId, startDate, endDate, startPeriod, endPeriod } = opts
  const fail = (error: string, status = 400) => ({ ok: false as const, error, status })

  if ((!equipmentId && !groupId) || !startDate || !endDate || !startPeriod || !endPeriod) {
    return fail('請選擇設備、起訖日期與時段')
  }

  const config = await loadEquipmentConfig()
  const today = todayStr()
  const maxDate = addDays(today, config.maxAdvanceDays)
  const dateOk = (d: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && (!opts.enforceMaxAdvance || d <= maxDate)
  if (!dateOk(startDate) || !dateOk(endDate)) {
    return fail(opts.enforceMaxAdvance
      ? `借用日期須在今天起 ${config.maxAdvanceDays} 天內`
      : '借用日期不可早於今天')
  }
  if (endDate < startDate) return fail('結束日期不可早於開始日期')
  if (!config.openPeriods.includes(startPeriod) || !config.openPeriods.includes(endPeriod)) {
    return fail('包含未開放借用的時段')
  }

  // 每一天實際占用的節次；同日借用須開始不晚於結束
  const slots = dateRangeList(startDate, endDate).map(date => ({
    date,
    periods: daySlotPeriods(config.openPeriods, date, startDate, endDate, startPeriod, endPeriod),
  }))
  if (slots.some(s => s.periods.length === 0)) {
    return fail('時段範圍無效，結束時段不可早於開始時段')
  }
  const detail = loanTimeText({
    loan_date: startDate, end_date: endDate, periods: slots[0].periods,
    start_period: startPeriod, end_period: endPeriod,
  })

  if (groupId) {
    // ---- 群組借用（借 N 台）----
    // quantity 未指定＝整組全部成員（舊語意：全員可用才可借）；
    // 指定 N＝從可借池（可用狀態、未長借、該時段全程有空）挑編號最小的 N 台。
    const { data: group, error: groupError } = await supabaseAdmin
      .from('equipment_groups').select('id, status').eq('id', groupId).maybeSingle()
    if (groupError) return fail(`系統查詢失敗，請聯絡管理員：${groupError.message}`, 500)
    if (!group || group.status !== 'available') return fail('此群組目前無法借用')
    const { data: members } = await supabaseAdmin
      .from('equipment').select('id, status, asset_number').eq('group_id', groupId)
      .order('asset_number').order('id')
    if (!members || members.length === 0) return fail('此群組沒有成員設備')

    // 整組被長借 → 全部不可借；個別成員被長借 → 只排除該成員
    const [{ data: groupLong }, { data: memberLong }] = await Promise.all([
      supabaseAdmin.from('equipment_long_loans').select('id')
        .eq('group_id', groupId).eq('status', 'active').lte('start_date', endDate).limit(1),
      supabaseAdmin.from('equipment_long_loans').select('equipment_id')
        .in('equipment_id', members.map(m => m.id)).eq('status', 'active').lte('start_date', endDate),
    ])
    if ((groupLong?.length ?? 0) > 0) return fail('此群組為整組長期借用中，無法借用。')
    const longLoanedIds = new Set((memberLong ?? []).map(l => l.equipment_id as string))

    const quantity = opts.quantity
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
      return fail('借用台數無效')
    }
    if (quantity === undefined && (members.some(m => m.status !== 'available') || longLoanedIds.size > 0)) {
      return fail('群組內有設備維修中、停用或長期借用中，暫不開放整組借用。')
    }
    const pool = members.filter(m => m.status === 'available' && !longLoanedIds.has(m.id))
    const want = quantity ?? members.length
    if (pool.length < want) return fail(`此群組目前僅 ${pool.length} 台可供借用。`)

    // 從可借池挑編號最小的 N 台；剛好被搶（slot_taken）就重挑一次再試
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: takenRows, error: slotError } = await supabaseAdmin
        .from('equipment_loan_slots').select('equipment_id, loan_date, period')
        .in('equipment_id', pool.map(m => m.id))
        .gte('loan_date', startDate).lte('loan_date', endDate)
      if (slotError) return fail(`系統查詢失敗，請聯絡管理員：${slotError.message}`, 500)
      const taken = new Set((takenRows ?? []).map(r => `${r.equipment_id}|${r.loan_date}|${r.period}`))
      const free = pool.filter(m =>
        slots.every(s => s.periods.every(p => !taken.has(`${m.id}|${s.date}|${p}`)))
      )
      if (free.length < want) {
        return fail(`此時段僅剩 ${free.length} 台可借，請減少台數或換其他時段。`, 409)
      }
      const picked = free.slice(0, want).map(m => m.id)

      const { data: loanId, error } = await supabaseAdmin.rpc('reserve_equipment_group_loan', {
        p_group_id: groupId,
        p_teacher_id: teacherId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_start_period: startPeriod,
        p_end_period: endPeriod,
        p_slots: slots as never,
        p_unit_ids: picked,
      })
      if (error) {
        if (error.message.includes('slot_taken')) continue
        return fail(error.message, 500)
      }
      if (opts.seriesId) {
        await supabaseAdmin.from('equipment_loans').update({ series_id: opts.seriesId }).eq('id', String(loanId))
      }
      await logLoanEvent({
        loanId: String(loanId), groupId, teacherId,
        action: 'reserved', detail, actorId: opts.actorId, unitCount: picked.length,
      })
      return { ok: true, id: String(loanId) }
    }
    return fail('該時段的設備剛被其他老師借走，請重新查詢。', 409)
  }

  // ---- 單台借用 ----
  const { data: equip, error: equipError } = await supabaseAdmin
    .from('equipment').select('id, status, group_id').eq('id', equipmentId ?? '').maybeSingle()
  // 查詢失敗（如 migration 未執行造成欄位不存在）要如實回報，不可誤報為設備不可借
  if (equipError) return fail(`系統查詢失敗，請聯絡管理員：${equipError.message}`, 500)
  if (!equip || equip.status !== 'available') return fail('此設備目前無法借用')

  // 長期借用中（單台，或所屬群組整組被長借）的設備不可短期借用
  const { data: longLoan } = await supabaseAdmin
    .from('equipment_long_loans').select('id, start_date')
    .eq('equipment_id', equip.id).eq('status', 'active')
    .lte('start_date', endDate)
    .limit(1).maybeSingle()
  if (longLoan) return fail('此設備目前為長期借用中，無法短期借用。')
  if (equip.group_id) {
    const { data: groupLong } = await supabaseAdmin
      .from('equipment_long_loans').select('id')
      .eq('group_id', equip.group_id).eq('status', 'active').lte('start_date', endDate)
      .limit(1).maybeSingle()
    if (groupLong) return fail('此設備所屬群組為長期借用中，無法短期借用。')
  }

  // 交易式寫入：期間內任一格已被占用則整筆回滾（DB unique 防撞）
  const { data: loanId, error } = await supabaseAdmin.rpc('reserve_equipment_loan_range', {
    p_equipment_id: equip.id,
    p_teacher_id: teacherId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_start_period: startPeriod,
    p_end_period: endPeriod,
    p_slots: slots as never,
  })
  if (error) {
    if (error.message.includes('slot_taken')) {
      return fail('部分時段剛被其他老師借走，請重新選擇。', 409)
    }
    return fail(error.message, 500)
  }
  if (opts.seriesId) {
    await supabaseAdmin.from('equipment_loans').update({ series_id: opts.seriesId }).eq('id', String(loanId))
  }
  await logLoanEvent({
    loanId: String(loanId), equipmentId: equip.id, teacherId,
    action: 'reserved', detail, actorId: opts.actorId,
  })
  return { ok: true, id: String(loanId) }
}

// ---------- 「預約未借」計次 ----------

async function addNoShow(teacherId: string, n: number): Promise<void> {
  const { data: cur } = await supabaseAdmin.from('equipment_teacher_stats')
    .select('no_show_count').eq('teacher_id', teacherId).maybeSingle()
  await supabaseAdmin.from('equipment_teacher_stats').upsert({
    teacher_id: teacherId,
    no_show_count: (cur?.no_show_count ?? 0) + n,
    updated_at: new Date().toISOString(),
  })
}

/**
 * 掃描某老師的「預約未借」：到期日已過仍停在「已預約」且未計次的借用 → 標記計次並累加，
 * 回傳目前累計次數。老師載入借用頁與送出預約時各掃一次（無排程，惰性計算）。
 * 管理端歸零只清累計數，已標記的借用不會被重算。
 */
export async function sweepNoShowCount(teacherId: string): Promise<number> {
  const today = todayStr()
  const { data: stale } = await supabaseAdmin.from('equipment_loans')
    .select('id, loan_date, end_date')
    .eq('teacher_id', teacherId).eq('status', 'reserved').eq('no_show_counted', false)
  const expired = (stale ?? []).filter(l => (l.end_date ?? l.loan_date) < today)
  if (expired.length > 0) {
    await supabaseAdmin.from('equipment_loans')
      .update({ no_show_counted: true }).in('id', expired.map(l => l.id))
    await addNoShow(teacherId, expired.length)
  }
  const { data: stat } = await supabaseAdmin.from('equipment_teacher_stats')
    .select('no_show_count').eq('teacher_id', teacherId).maybeSingle()
  return stat?.no_show_count ?? 0
}

/** 管理端釋出「已到期」的預約＝預約未借，計次；未到期的提前釋出不算。 */
export async function markNoShowOnRelease(loan: {
  id: string
  teacher_id: string
  loan_date: string
  end_date: string | null
  no_show_counted?: boolean
}): Promise<void> {
  if (loan.no_show_counted) return
  if ((loan.end_date ?? loan.loan_date) >= todayStr()) return
  await supabaseAdmin.from('equipment_loans').update({ no_show_counted: true }).eq('id', loan.id)
  await addNoShow(loan.teacher_id, 1)
}
