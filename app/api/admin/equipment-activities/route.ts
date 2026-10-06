import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  computeAvailability,
  loadEquipmentConfig,
  loanUnitIds,
  logLoanEvent,
  reserveShortLoan,
} from '@/lib/equipment-server'
import { addDays, loanTimeText, orderedOpenPeriods, todayStr } from '@/lib/equipment'
import { hasPerms } from '@/lib/staff-server'

const DATE = /^\d{4}-\d{2}-\d{2}$/

// 一個活動可能拆成多筆（每項設備一筆、單台設備每台一筆），逐筆寫入需要較長時間
export const maxDuration = 60

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['equipment']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/**
 * 活動保留列表：近 90 天起的活動（同一活動的多筆以 series_id 合併）。
 * 回傳 activities: [{ id, name, start, end, state: ongoing|upcoming|past|cancelled, items: [{ label, qty }] }]
 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const today = todayStr()
  const [{ data: loans, error }, { data: equipment }, { data: groups }] = await Promise.all([
    supabaseAdmin.from('equipment_loans')
      .select('id, series_id, activity_name, status, loan_date, end_date, equipment_id, group_id, unit_ids')
      .is('teacher_id', null).in('status', ['held', 'cancelled'])
      .gte('loan_date', addDays(today, -90)).order('loan_date'),
    supabaseAdmin.from('equipment').select('id, name, group_id'),
    supabaseAdmin.from('equipment_groups').select('id, name'),
  ])
  if (error) {
    const hint = error.message.includes('activity_name') ? '（請先執行 migration 048）' : ''
    return NextResponse.json({ error: `系統查詢失敗：${error.message}${hint}` }, { status: 500 })
  }
  const equipName = new Map((equipment ?? []).map(e => [e.id, e.name]))
  const groupName = new Map((groups ?? []).map(g => [g.id, g.name]))
  const membersOf = new Map<string, string[]>()
  for (const e of equipment ?? []) {
    if (!e.group_id) continue
    const list = membersOf.get(e.group_id) ?? []
    list.push(e.id)
    membersOf.set(e.group_id, list)
  }

  type Row = NonNullable<typeof loans>[number]
  const byActivity = new Map<string, Row[]>()
  for (const l of loans ?? []) {
    const key = l.series_id ?? l.id
    const list = byActivity.get(key) ?? []
    list.push(l)
    byActivity.set(key, list)
  }
  const rank = { ongoing: 0, upcoming: 1, past: 2, cancelled: 3 }
  const activities = Array.from(byActivity).map(([id, list]) => {
    const start = list.reduce((m, l) => (l.loan_date < m ? l.loan_date : m), list[0].loan_date)
    const end = list.reduce((m, l) => {
      const due = l.end_date ?? l.loan_date
      return due > m ? due : m
    }, list[0].end_date ?? list[0].loan_date)
    const live = list.filter(l => l.status === 'held')
    const state: keyof typeof rank =
      live.length === 0 ? 'cancelled' : end < today ? 'past' : start > today ? 'upcoming' : 'ongoing'
    // 同一項設備合併成一列：群組顯示群組名、單台設備依名稱加總台數
    const qtyByLabel = new Map<string, number>()
    for (const l of live.length > 0 ? live : list) {
      const label = l.group_id
        ? groupName.get(l.group_id) ?? '（已刪除群組）'
        : equipName.get(l.equipment_id ?? '') ?? '（已刪除設備）'
      qtyByLabel.set(label, (qtyByLabel.get(label) ?? 0) + loanUnitIds(l, membersOf).length)
    }
    return {
      id,
      name: list[0].activity_name,
      start,
      end,
      state,
      items: Array.from(qtyByLabel).map(([label, qty]) => ({ label, qty })),
    }
  }).sort((a, b) =>
    rank[a.state] - rank[b.state] ||
    (a.state === 'past' || a.state === 'cancelled' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start))
  ).slice(0, 40)

  return NextResponse.json({ activities })
}

/**
 * 建立活動保留：活動名稱＋起訖日期（整天）＋設備清單，不需借用人、不走借用歸還手續。
 * body: { name, start_date, end_date, items: [{ group_id, quantity } | { type_name, quantity }] }
 * 群組借 N 台寫一筆；未編組的單台設備依編號挑 N 台、每台一筆。全部同一 series_id。
 * 任一項失敗就整個活動撤回（已寫入的刪除），避免只保留到一半。
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  const name = String(body?.name ?? '').trim().slice(0, 60)
  const startDate = String(body?.start_date ?? '')
  const endDate = String(body?.end_date ?? '')
  const items: { group_id?: string; type_name?: string; quantity?: number }[] = Array.isArray(body?.items) ? body.items : []
  const today = todayStr()
  if (!name) return NextResponse.json({ error: '請填寫活動名稱或事項' }, { status: 400 })
  if (!DATE.test(startDate) || !DATE.test(endDate) || startDate < today || endDate < startDate) {
    return NextResponse.json({ error: '日期無效（不可早於今天，結束不可早於開始）' }, { status: 400 })
  }
  if (endDate > addDays(startDate, 61)) return NextResponse.json({ error: '活動保留最長 62 天' }, { status: 400 })
  if (
    items.length === 0 ||
    items.some(i => !(i.group_id || i.type_name) || !Number.isInteger(i.quantity) || (i.quantity ?? 0) < 1)
  ) {
    return NextResponse.json({ error: '請選擇要保留的設備與台數' }, { status: 400 })
  }

  const config = await loadEquipmentConfig()
  const order = orderedOpenPeriods(config.openPeriods)
  const seriesId = crypto.randomUUID()
  const created: string[] = []
  const rollback = async (error: string, status = 409) => {
    if (created.length > 0) {
      await supabaseAdmin.from('equipment_loan_events').delete().in('loan_id', created)
      await supabaseAdmin.from('equipment_loans').delete().in('id', created)
    }
    return NextResponse.json({ error }, { status })
  }
  const base = {
    teacherId: null,
    activityName: name,
    startDate,
    endDate,
    startPeriod: order[0],
    endPeriod: order[order.length - 1],
    actorId: auth.user.id,
    seriesId,
    enforceMaxAdvance: false,
  }

  for (const item of items) {
    if (item.group_id) {
      const r = await reserveShortLoan({ ...base, groupId: item.group_id, quantity: item.quantity })
      if (!r.ok) return rollback(r.error, r.status)
      created.push(r.id)
      continue
    }
    const [occ] = await computeAvailability({ occurrences: [{ start: startDate, end: endDate }] })
    const free = occ.resources.find(r => r.key === `t:${item.type_name}`)?.free ?? []
    if (free.length < (item.quantity ?? 0)) {
      return rollback(`「${item.type_name}」這段期間只剩 ${free.length} 台可保留。`)
    }
    for (const unit of free.slice(0, item.quantity)) {
      const r = await reserveShortLoan({ ...base, equipmentId: unit.id })
      if (!r.ok) return rollback(r.error, r.status)
      created.push(r.id)
    }
  }
  return NextResponse.json({ ok: true, id: seriesId, created: created.length })
}

/**
 * 取消活動保留：該活動所有保留中的設備釋出時段。
 * body: { id（series_id）, action: 'cancel' }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, action } = await request.json()
  if (!id || action !== 'cancel' || !/^[0-9a-f-]{36}$/i.test(String(id))) {
    return NextResponse.json({ error: '缺少參數' }, { status: 400 })
  }

  const { data: loans } = await supabaseAdmin.from('equipment_loans')
    .select('id, equipment_id, group_id, unit_ids, activity_name, loan_date, end_date, start_period, end_period, periods')
    .or(`series_id.eq.${id},id.eq.${id}`).is('teacher_id', null).eq('status', 'held')
  if (!loans || loans.length === 0) return NextResponse.json({ error: '找不到這個活動，可能已經取消' }, { status: 404 })

  const ids = loans.map(l => l.id)
  const { error } = await supabaseAdmin.from('equipment_loans').update({
    status: 'cancelled',
    closed_by: auth.user.id,
    updated_at: new Date().toISOString(),
  }).in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabaseAdmin.from('equipment_loan_slots').delete().in('loan_id', ids)
  for (const l of loans) {
    await logLoanEvent({
      loanId: l.id, equipmentId: l.equipment_id, groupId: l.group_id, teacherId: null, activityName: l.activity_name,
      action: 'cancelled', detail: loanTimeText(l), actorId: auth.user.id,
      unitCount: Array.isArray(l.unit_ids) && l.unit_ids.length > 0 ? l.unit_ids.length : undefined,
    })
  }
  return NextResponse.json({ ok: true })
}
