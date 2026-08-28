// 超鐘簽到 API 共用（server-only）：計畫擁有權檢查。
// 計畫可能來自不同管理者：僅建立者（或 superadmin）可改；
// created_by NULL＝舊資料，視為共用。老師的跨計畫統計不受此限。
import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase/admin'
import type { AdminAccess } from './staff-server'

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
