import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig, loanUnitIds } from '@/lib/equipment-server'
import {
  addDays,
  currentPeriod,
  daySlotPeriods,
  loanDueDate,
  loanTimeText,
  orderedOpenPeriods,
  periodsText,
  todayStr,
} from '@/lib/equipment'

const LOAN_SELECT =
  'id, equipment_id, group_id, unit_ids, teacher_id, activity_name, status, loan_date, end_date, ' +
  'start_period, end_period, periods, borrowed_at, returned_at'

interface Loan {
  id: string
  equipment_id: string | null
  group_id: string | null
  unit_ids: unknown
  teacher_id: string | null
  activity_name: string
  status: string
  loan_date: string
  end_date: string | null
  start_period: string | null
  end_period: string | null
  periods: string[]
  borrowed_at: string | null
  returned_at: string | null
}

type ItemStatus = 'out' | 'resv' | 'done' | 'noshow' | 'overdue' | 'held'

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
/** ISO 時間 → 台灣時間 HH:MM */
const clock = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(11, 16) : '')

/**
 * 借用總覽資料：管理端「今日總覽」與教師端「借用情況」共用。
 * requestedDate：設備課表要看的日期（預設今天）；其餘區塊一律以「現在」計算。
 * 回傳 { date, today, nowPeriod, openPeriods,
 *   kpi（今天）, alerts（需處理）, board（指定日期的設備課表）, dist（此刻設備分布）, long（長期借用摘要） }
 * 逾期未還的設備在今天以後的課表上整天顯示「逾期未還」（實體不在架上，也不開放預約）。
 */
export async function loadLendingBoard(requestedDate: string | null) {
  const config = await loadEquipmentConfig()
  const today = todayStr()
  const q = requestedDate ?? ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : today
  const order = orderedOpenPeriods(config.openPeriods)
  const nowKey = currentPeriod(config.openPeriods)

  const results = await Promise.all([
    supabaseAdmin.from('equipment').select('id, name, asset_number, status, group_id, location')
      .order('name').order('asset_number'),
    supabaseAdmin.from('equipment_groups').select('id, name, status').order('name'),
    // 進行中：已預約、借用中、活動保留
    supabaseAdmin.from('equipment_loans').select(LOAN_SELECT).in('status', ['reserved', 'borrowed', 'held']),
    // 課表日期當天有占用的（含已歸還／結案）：借用日在 62 天內且 ≤ 當天，再用到期日過濾（跨日借用最長 62 天）
    supabaseAdmin.from('equipment_loans').select(LOAN_SELECT)
      .gte('loan_date', addDays(date, -62)).lte('loan_date', date)
      .in('status', ['reserved', 'borrowed', 'returned', 'closed', 'held']),
    supabaseAdmin.from('equipment_long_loans')
      .select('id, equipment_id, group_id, teacher_id, external_name, due_date').eq('status', 'active'),
    supabaseAdmin.from('profiles').select('id, name, email'),
    supabaseAdmin.from('equipment_teacher_stats').select('teacher_id, no_show_count').gt('no_show_count', 0),
    supabaseAdmin.from('equipment_renewals').select('long_loan_id, old_due_date'),
  ])
  const failed = results.find(r => r.error)?.error
  if (failed) {
    const hint = failed.message.includes('activity_name') ? '（請先執行 migration 048）' : ''
    return { ok: false as const, error: `系統查詢失敗：${failed.message}${hint}` }
  }
  const [eqRes, grRes, activeRes, dayRes, longRes, profRes, statRes, renewRes] = results
  const equipment = eqRes.data as { id: string; name: string; asset_number: string; status: string; group_id: string | null; location: string }[]
  const groups = grRes.data as { id: string; name: string; status: string }[]
  const active = activeRes.data as unknown as Loan[]
  const dayLoans = dayRes.data as unknown as Loan[]
  const longs = longRes.data as { id: string; equipment_id: string | null; group_id: string | null; teacher_id: string | null; external_name: string; due_date: string }[]
  const profiles = profRes.data as { id: string; name: string | null; email: string | null }[]
  const stats = statRes.data as { teacher_id: string; no_show_count: number }[]
  const renewals = renewRes.data as { long_loan_id: string; old_due_date: string }[]

  const equipById = new Map(equipment.map(e => [e.id, e]))
  const groupById = new Map(groups.map(g => [g.id, g]))
  const membersOf = new Map<string, string[]>()
  for (const e of equipment) {
    if (!e.group_id) continue
    const list = membersOf.get(e.group_id) ?? []
    list.push(e.id)
    membersOf.set(e.group_id, list)
  }
  const profileName = new Map(profiles.map(p => [p.id, p.name ?? p.email ?? '']))

  const unitsOf = (l: Loan) => loanUnitIds(l, membersOf)
  const isActivity = (l: Loan) => !l.teacher_id
  const whoOf = (l: Loan) => (l.teacher_id ? profileName.get(l.teacher_id) ?? '（未知）' : l.activity_name)
  const labelOf = (l: Loan) => {
    if (l.equipment_id) {
      const e = equipById.get(l.equipment_id)
      return e ? `${e.name}${e.asset_number ? ` #${e.asset_number}` : ''}` : '（已刪除設備）'
    }
    const n = unitsOf(l).length
    const all = (membersOf.get(l.group_id ?? '') ?? []).length
    return `${groupById.get(l.group_id ?? '')?.name ?? '（已刪除群組）'} ${n === all ? `整組 ${n} 台` : `${n} 台`}`
  }
  /** 這筆借用在某天占用的節次（依固定順序） */
  const periodsOn = (l: Loan, d: string): string[] => {
    const due = loanDueDate(l)
    if (due === l.loan_date) return order.filter(k => l.periods.includes(k))
    return daySlotPeriods(config.openPeriods, d, l.loan_date, due, l.start_period ?? '', l.end_period ?? '')
  }
  /** 今天的預約：開始節次已到（老師該來拿了） */
  const startedToday = (l: Loan) => {
    if (!nowKey) return false
    const first = periodsOn(l, today)[0]
    return first !== undefined && order.indexOf(first) <= order.indexOf(nowKey)
  }
  const isNoShow = (l: Loan) =>
    l.status === 'reserved' && (l.loan_date < today || (l.loan_date === today && startedToday(l)))
  const msgVars = (l: Loan) => {
    const due = loanDueDate(l)
    return {
      teacher: whoOf(l),
      equipment: labelOf(l),
      date: due === l.loan_date ? l.loan_date : `${l.loan_date}～${due}`,
      periods: due === l.loan_date ? periodsText(l.periods) : '',
    }
  }
  const rowKeyOf = (l: Loan) => {
    if (l.group_id) return `g:${l.group_id}`
    const e = equipById.get(l.equipment_id ?? '')
    if (e?.group_id) return `g:${e.group_id}`
    return `t:${e?.name ?? '（已刪除設備）'}`
  }
  const overdueLoans = active.filter(l => l.status === 'borrowed' && loanDueDate(l) < today)

  // ---------- 設備課表（指定日期） ----------
  interface BoardItem {
    id: string
    row: string
    who: string
    activity: boolean
    qty: number
    unit: string
    s: number
    e: number
    status: ItemStatus
    note: string
    time: string
  }
  const itemsOn = (d: string): BoardItem[] => {
    const items: BoardItem[] = []
    const push = (l: Loan, idx: number[], status: ItemStatus, note: string) => {
      // 舊資料單日可能跳節（如第2、4節），拆成連續區段各畫一段
      let start = 0
      for (let i = 1; i <= idx.length; i++) {
        if (i < idx.length && idx[i] === idx[i - 1] + 1) continue
        items.push({
          id: l.id, row: rowKeyOf(l), who: whoOf(l), activity: isActivity(l), qty: unitsOf(l).length,
          unit: l.equipment_id ? equipById.get(l.equipment_id)?.asset_number ?? '' : '',
          s: idx[start], e: idx[i - 1], status, note, time: loanTimeText(l),
        })
        start = i
      }
    }
    for (const l of dayLoans) {
      const due = loanDueDate(l)
      if (d < l.loan_date || d > due) continue
      if ((l.status === 'returned' || l.status === 'closed') && d > today) continue
      const idx = periodsOn(l, d).map(k => order.indexOf(k)).filter(i => i >= 0).sort((a, b) => a - b)
      if (idx.length === 0) continue
      let status: ItemStatus
      let note = ''
      if (l.status === 'held') status = 'held'
      else if (l.status === 'returned' || l.status === 'closed') {
        status = 'done'
        note = l.returned_at ? `${clock(l.returned_at)} ${l.status === 'closed' ? '管理者結案' : '歸還'}` : ''
      } else if (l.status === 'borrowed') {
        status = 'out'
        note = l.borrowed_at ? `${clock(l.borrowed_at)} 取用` : ''
      } else {
        status = d < today || (d === today && (l.loan_date < today || startedToday(l))) ? 'noshow' : 'resv'
      }
      push(l, idx, status, note)
    }
    // 逾期未還：今天起每天整天都還在借用人手上
    if (d >= today) {
      for (const l of overdueLoans) {
        push(l, order.map((_, i) => i), 'overdue',
          `${l.loan_date} 借出，已逾期 ${daysBetween(loanDueDate(l), today)} 天`)
      }
    }
    return items
  }

  const boardItems = itemsOn(date)
  const shortable = (e: (typeof equipment)[number]) => e.status !== 'retired'
  const rows: { key: string; kind: 'group' | 'type'; name: string; sub: string; total: number }[] = []
  for (const g of groups) {
    const members = (membersOf.get(g.id) ?? []).map(id => equipById.get(id)!).filter(shortable)
    if (members.length === 0) continue
    const place = members.find(m => m.location)?.location ?? ''
    rows.push({ key: `g:${g.id}`, kind: 'group', name: g.name, sub: [place, `${members.length} 台`].filter(Boolean).join(' · '), total: members.length })
  }
  const typeCount = new Map<string, number>()
  for (const e of equipment) {
    if (!e.group_id && shortable(e)) typeCount.set(e.name, (typeCount.get(e.name) ?? 0) + 1)
  }
  const busyTypes = new Set(boardItems.map(i => i.row))
  const idleTypes: string[] = []
  for (const [name, count] of Array.from(typeCount)) {
    if (busyTypes.has(`t:${name}`)) rows.push({ key: `t:${name}`, kind: 'type', name, sub: `${count} 台`, total: count })
    else idleTypes.push(name)
  }

  // ---------- 今天的指標 ----------
  const todayByLoan = new Map<string, ItemStatus>()
  for (const i of itemsOn(today)) {
    if (i.activity || i.status === 'overdue') continue
    todayByLoan.set(i.id, i.status)
  }
  const countStatus = (s: ItemStatus) => Array.from(todayByLoan.values()).filter(v => v === s).length

  const longUnit = new Set<string>()
  let longInternal = 0
  let longExternal = 0
  for (const l of longs) {
    const ids = l.equipment_id ? [l.equipment_id] : membersOf.get(l.group_id ?? '') ?? []
    ids.forEach(id => longUnit.add(id))
    if (l.teacher_id) longInternal += ids.length
    else longExternal += ids.length
  }
  const outUnit = new Set<string>()
  const overdueUnit = new Set<string>()
  const heldUnit = new Set<string>()
  for (const l of active) {
    if (l.status === 'borrowed') {
      unitsOf(l).forEach(id => outUnit.add(id))
      if (loanDueDate(l) < today) unitsOf(l).forEach(id => overdueUnit.add(id))
    }
    if (l.status === 'held' && l.loan_date <= today && loanDueDate(l) >= today) {
      unitsOf(l).forEach(id => { outUnit.add(id); heldUnit.add(id) })
    }
  }

  // ---------- 需處理 ----------
  const reservedAhead = active.filter(l => l.status === 'reserved' && loanDueDate(l) >= today)
  const alerts = [
    ...overdueLoans.map(l => {
      const units = new Set(unitsOf(l))
      return {
        kind: 'overdue' as const, loanId: l.id, who: whoOf(l), label: labelOf(l), time: loanTimeText(l),
        days: daysBetween(loanDueDate(l), today),
        // 這批設備後面還有人預約：逾期不還，他們會拿不到
        affected: reservedAhead.filter(r => unitsOf(r).some(id => units.has(id))).length,
        vars: msgVars(l),
      }
    }).sort((a, b) => b.days - a.days),
    ...active.filter(isNoShow).map(l => ({
      kind: 'noshow' as const, loanId: l.id, who: whoOf(l), label: labelOf(l), time: loanTimeText(l),
      days: daysBetween(l.loan_date, today), vars: msgVars(l),
    })).sort((a, b) => ((a.days === 0) !== (b.days === 0) ? (a.days === 0 ? -1 : 1) : b.days - a.days)),
    ...longs.filter(l => l.due_date < today).map(l => ({
      kind: 'longOverdue' as const, loanId: l.id,
      who: l.teacher_id ? profileName.get(l.teacher_id) ?? '（未知）' : `${l.external_name}（系統外）`,
      label: l.equipment_id
        ? (() => { const e = equipById.get(l.equipment_id!); return e ? `${e.name}${e.asset_number ? ` #${e.asset_number}` : ''}` : '（已刪除設備）' })()
        : `${groupById.get(l.group_id ?? '')?.name ?? '（已刪除群組）'} 整組`,
      time: `到期 ${l.due_date}`, days: daysBetween(l.due_date, today),
    })).sort((a, b) => b.days - a.days),
    ...(config.noShowLimit > 0
      ? stats.filter(s => s.no_show_count >= config.noShowLimit).map(s => ({
          kind: 'blocked' as const, teacherId: s.teacher_id, who: profileName.get(s.teacher_id) ?? '（未知）',
          count: s.no_show_count, limit: config.noShowLimit,
        }))
      : []),
  ]

  // ---------- 此刻設備分布 ----------
  interface Dist { name: string; total: number; long: number; short: number; maint: number; overdue: number; held: number; carts: { id: string; name: string; total: number; long: number; short: number; maint: number; overdue: number }[] }
  const dist = new Map<string, Dist>()
  const stateOf = (e: (typeof equipment)[number]) =>
    e.status === 'maintenance' ? 'maint' : longUnit.has(e.id) ? 'long' : outUnit.has(e.id) ? 'short' : 'avail'
  for (const e of equipment) {
    if (e.status === 'retired') continue
    const t = dist.get(e.name) ?? { name: e.name, total: 0, long: 0, short: 0, maint: 0, overdue: 0, held: 0, carts: [] }
    t.total++
    const st = stateOf(e)
    if (st !== 'avail') t[st]++
    if (overdueUnit.has(e.id)) t.overdue++
    if (heldUnit.has(e.id)) t.held++
    dist.set(e.name, t)
  }
  for (const g of groups) {
    const members = (membersOf.get(g.id) ?? []).map(id => equipById.get(id)!).filter(e => e.status !== 'retired')
    if (members.length === 0) continue
    const cart = { id: g.id, name: g.name, total: members.length, long: 0, short: 0, maint: 0, overdue: 0 }
    for (const m of members) {
      const st = stateOf(m)
      if (st !== 'avail') cart[st]++
      if (overdueUnit.has(m.id)) cart.overdue++
    }
    dist.get(members[0].name)?.carts.push(cart)
  }

  // ---------- 長期借用摘要 ----------
  const typeTotal = new Map(Array.from(dist.values()).map(t => [t.name, t.total]))
  const longByType = new Map<string, number>()
  for (const id of Array.from(longUnit)) {
    const name = equipById.get(id)?.name
    if (name) longByType.set(name, (longByType.get(name) ?? 0) + 1)
  }
  // 續借潮：半年內到期最多的那一天（同數取較早）
  const dueCount = new Map<string, number>()
  for (const l of longs) {
    if (l.due_date >= today && l.due_date <= addDays(today, 183)) dueCount.set(l.due_date, (dueCount.get(l.due_date) ?? 0) + 1)
  }
  let wave: { due: string; pending: number; renewed: number; opensOn: string; daysToOpen: number; daysToDue: number } | null = null
  for (const [due, n] of Array.from(dueCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const renewed = new Set(renewals.filter(r => r.old_due_date === due).map(r => r.long_loan_id)).size
    const opensOn = addDays(due, -config.renewalNoticeDays)
    wave = { due, pending: n, renewed, opensOn, daysToOpen: daysBetween(today, opensOn), daysToDue: daysBetween(today, due) }
    break
  }

  return {
    ok: true as const,
    data: {
      date,
      today,
      nowPeriod: nowKey,
      openPeriods: order,
      kpi: {
        today: {
          total: todayByLoan.size,
          out: countStatus('out'),
          resv: countStatus('resv'),
          done: countStatus('done'),
          noshow: countStatus('noshow'),
        },
        outNow: outUnit.size,
        overdueNow: overdueUnit.size,
        heldNow: heldUnit.size,
        long: { total: longUnit.size, internal: longInternal, external: longExternal, overdue: longs.filter(l => l.due_date < today).length },
      },
      alerts,
      board: { rows, items: boardItems, idleTypes },
      dist: Array.from(dist.values()).sort((a, b) => b.total - a.total),
      long: {
        byType: Array.from(longByType).map(([name, count]) => ({ name, count, typeTotal: typeTotal.get(name) ?? count }))
          .sort((a, b) => b.count - a.count),
        wave,
      },
    },
  }
}

export type LendingBoardData = Extract<Awaited<ReturnType<typeof loadLendingBoard>>, { ok: true }>['data']
