// 超鐘簽到 API 共用（server-only）：計畫擁有權檢查。
// 計畫可能來自不同管理者：僅建立者（或 superadmin）可改；
// created_by NULL＝舊資料，視為共用。老師的跨計畫統計不受此限。
import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase/admin'
import type { AdminAccess } from './staff-server'
import { OT_WEEKLY_CAP, isCappedCategory, maxConcurrentSlots, otCategoryLabel } from './overtime'

export function canManagePlanRow(access: AdminAccess, createdBy: string | null): boolean {
  return access.role === 'superadmin' || !createdBy || createdBy === access.userId
}

/** 非計畫擁有者 → 回傳 403/404 回應；可管理 → null */
export async function forbidIfNotPlanOwner(access: AdminAccess, planId: string): Promise<NextResponse | null> {
  const { data } = await supabaseAdmin.from('overtime_plans')
    .select('created_by').eq('id', planId).maybeSingle()
  if (!data) return NextResponse.json({ error: '找不到計畫' }, { status: 404 })
  if (!canManagePlanRow(access, data.created_by)) {
    return NextResponse.json({ error: '這是其他管理者建立的計畫，僅建立者可修改' }, { status: 403 })
  }
  return null
}

export async function planIdOfTeacherRow(rowId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('overtime_teachers')
    .select('plan_id').eq('id', rowId).maybeSingle()
  return data?.plan_id ?? null
}

export async function planIdOfSlot(slotId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('overtime_slots')
    .select('teacher_row_id').eq('id', slotId).maybeSingle()
  if (!data) return null
  return planIdOfTeacherRow(data.teacher_row_id)
}

/** 同一人（跨計畫）的一筆減課時段＋實際生效區間（NULL 區段＝所屬計畫期程） */
export interface PersonSlotRow {
  id: string
  teacher_row_id: string
  weekday: number
  period: number
  start_date: string | null
  end_date: string | null
  eff: [string, string]
}

/**
 * 載入同一人所有清冊列（跨計畫）的減課時段；系統帳號比對 teacher_id、手動列比對姓名。
 * myPlan＝這筆清冊列所屬計畫的期程（找不到為 null）。
 */
export async function loadPersonSlots(row: { teacher_id: string | null; name: string; plan_id: string }) {
  let q = supabaseAdmin.from('overtime_teachers').select('id, plan_id')
  q = row.teacher_id ? q.eq('teacher_id', row.teacher_id) : q.eq('name', row.name).is('teacher_id', null)
  const { data: sameTeacher } = await q
  const rows = sameTeacher ?? []
  const rowIds = rows.map(r => r.id)
  const planIds = Array.from(new Set(rows.map(r => r.plan_id)))

  const [{ data: slots }, { data: plans }] = await Promise.all([
    supabaseAdmin.from('overtime_slots')
      .select('id, teacher_row_id, weekday, period, start_date, end_date').in('teacher_row_id', rowIds),
    supabaseAdmin.from('overtime_plans').select('id, start_date, end_date').in('id', planIds),
  ])
  const planOf = Object.fromEntries((plans ?? []).map(p => [p.id, p]))
  const planOfRow = Object.fromEntries(rows.map(r => [r.id, planOf[r.plan_id]]))

  const personSlots: PersonSlotRow[] = []
  for (const s of slots ?? []) {
    const p = planOfRow[s.teacher_row_id]
    if (p) personSlots.push({ ...s, eff: [s.start_date ?? p.start_date, s.end_date ?? p.end_date] })
  }
  return { myPlan: planOf[row.plan_id] ?? null, personSlots }
}

/** 每週 6 節是軟上限（試辦特殊情況可超過）：超過回傳提醒文字，未超過／不受限身分回傳 null */
export function overCapWarning(row: { name: string; category: string }, effs: [string, string][]): string | null {
  if (!isCappedCategory(row.category)) return null
  const peak = maxConcurrentSlots(effs)
  return peak > OT_WEEKLY_CAP
    ? `${row.name}（${otCategoryLabel(row.category)}）同一週已達 ${peak} 節，超過 ${OT_WEEKLY_CAP} 節上限（含其他計畫）`
    : null
}
