'use client'

// 示範模式 fetch 攔截：把設備借用相關 API 全部換成記憶體假資料，
// 讓真實 UI 元件在 /demo/* 頁面上不需登入、不碰資料庫就能完整互動。
// 僅供 Remotion 介紹影片截圖使用；正式環境的 /demo 頁面回 404。

import { DEFAULT_EQUIPMENT_CONFIG, addDays, daySlotPeriods, todayStr } from '@/lib/equipment'

/** 示範照片（資料 URL，模擬老師拍的設備照） */
const SAMPLE_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#cbd5e1"/><stop offset="1" stop-color="#64748b"/>
    </linearGradient></defs>
    <rect width="640" height="480" fill="url(#g)"/>
    <rect x="170" y="120" width="300" height="200" rx="12" fill="#1e293b"/>
    <rect x="185" y="135" width="270" height="150" rx="4" fill="#3b82f6" opacity="0.65"/>
    <rect x="250" y="330" width="140" height="14" rx="7" fill="#1e293b"/>
    <text x="320" y="430" font-size="28" text-anchor="middle" fill="#0f172a" font-family="sans-serif">設備現況照片（示範）</text>
  </svg>`)

const BORROW_CHECKLIST = [
  { label: '設備外觀無損壞', requiresPhoto: false },
  { label: '電源線與配件齊全', requiresPhoto: true },
]
const RETURN_CHECKLIST = [
  { label: '設備與配件已歸回原位', requiresPhoto: true },
]

const today = todayStr()

const EQUIPMENT = [
  ...[1, 2, 3, 4].map(n => ({
    id: `t${n}`,
    name: '平板電腦(教師機)',
    asset_number: `gpps-114-0${n}`,
    location: '資訊組充電車',
    peripherals: ['充電線', '保護套'],
    borrow_checklist: BORROW_CHECKLIST,
    return_checklist: RETURN_CHECKLIST,
    status: 'available',
    notes: '',
    sort_order: 0,
    group_id: 'g1',
  })),
  ...[1, 2, 3].map(n => ({
    id: `n${n}`,
    name: '筆記型電腦(教師機)',
    asset_number: `NB-0${n}`,
    location: '資訊組防潮櫃',
    peripherals: ['變壓器', '滑鼠'],
    borrow_checklist: BORROW_CHECKLIST,
    return_checklist: RETURN_CHECKLIST,
    status: 'available',
    notes: '',
    sort_order: 0,
    group_id: null,
  })),
  {
    id: 'c1',
    name: '攝影機',
    asset_number: '3000063',
    location: '資訊組防潮櫃',
    peripherals: ['腳架快拆板', '充電器'],
    borrow_checklist: BORROW_CHECKLIST,
    return_checklist: RETURN_CHECKLIST,
    status: 'available',
    notes: '',
    sort_order: 0,
    group_id: null,
  },
]

const GROUPS = [{
  id: 'g1',
  name: '平板充電車 A 車',
  borrow_checklist: [
    { label: '整車 4 台數量清點無誤', requiresPhoto: true },
    { label: '充電車電源線齊全', requiresPhoto: false },
  ],
  return_checklist: [{ label: '整車清點無誤並歸回原位', requiresPhoto: true }],
  member_ids: ['t1', 't2', 't3', 't4'],
}]

// ---- 可變狀態（互動後改變畫面用） ----
let demoLoan: Record<string, unknown> | null = null
let longDueDate = addDays(today, 5)
let renewals: Record<string, unknown>[] = []
let photoCounter = 0

function teacherHome(url: URL) {
  const from = url.searchParams.get('from') ?? today
  const to = url.searchParams.get('to') ?? from
  return {
    config: { ...DEFAULT_EQUIPMENT_CONFIG, today, maxDate: addDays(today, 14) },
    from,
    to,
    equipment: EQUIPMENT,
    groups: GROUPS,
    // NB-02 今天第3、4節已被借走，示範「部分不可借」
    occupied: { [today]: { n2: ['p3', 'p4'] } },
    myLoans: demoLoan ? [demoLoan] : [],
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 安裝 fetch 攔截（重複呼叫無妨） */
export function installDemoFetch() {
  if (typeof window === 'undefined') return
  const w = window as unknown as { __demoFetchInstalled?: boolean }
  if (w.__demoFetchInstalled) return
  w.__demoFetchInstalled = true

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(rawUrl, window.location.origin)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {}

    // ---------- 教師端 ----------
    if (path === '/api/teacher/equipment' && method === 'GET') {
      return json(teacherHome(url))
    }

    if (path === '/api/teacher/equipment/loans' && method === 'POST') {
      const config = DEFAULT_EQUIPMENT_CONFIG
      const equip = EQUIPMENT.find(e => e.id === body.equipment_id)
      const group = GROUPS.find(g => g.id === body.group_id)
      demoLoan = {
        id: 'demo-loan-1',
        equipment_id: equip?.id ?? null,
        group_id: group?.id ?? null,
        equipment_name: group ? `${group.name}（整組）` : `${equip?.name ?? ''}`,
        equipment_asset_number: group ? '' : equip?.asset_number ?? '',
        equipment_location: group ? '資訊組充電車' : equip?.location ?? '',
        loan_date: body.start_date,
        end_date: body.end_date,
        start_period: body.start_period,
        end_period: body.end_period,
        periods: daySlotPeriods(config.openPeriods, body.start_date, body.start_date, body.end_date, body.start_period, body.end_period),
        status: 'reserved',
      }
      return json({ ok: true, id: 'demo-loan-1' })
    }

    if (path === '/api/teacher/equipment/loans' && method === 'PATCH') {
      if (demoLoan) {
        if (body.action === 'cancel') demoLoan = null
        else if (body.action === 'borrow') demoLoan.status = 'borrowed'
        else if (body.action === 'return') demoLoan.status = 'returned'
      }
      return json({ ok: true })
    }

    if (path === '/api/teacher/equipment/photo' && method === 'POST') {
      photoCounter += 1
      return json({ path: `demo-photo-${photoCounter}`, url: SAMPLE_PHOTO })
    }

    if (path === '/api/teacher/equipment/long-loans' && method === 'GET') {
      return json({
        config: {
          renewalWeeks: 20,
          renewalNoticeDays: 7,
          maxPhotos: 5,
          agreements: {
            longterm: DEFAULT_EQUIPMENT_CONFIG.agreements.longterm,
            renewal: DEFAULT_EQUIPMENT_CONFIG.agreements.renewal,
          },
        },
        today,
        loans: [{
          id: 'demo-long-1',
          equipment_id: 'n3',
          group_id: null,
          teacher_id: 'demo-teacher',
          external_name: '',
          start_date: addDays(today, -120),
          due_date: longDueDate,
          status: 'active',
          notes: '',
          equipment_name: '筆記型電腦(教師機)',
          equipment_location: '資訊組防潮櫃',
          peripherals: ['變壓器', '滑鼠'],
          renewals,
          renewable: true,
          overdue: false,
        }],
      })
    }

    if (path === '/api/teacher/equipment/long-loans' && method === 'POST') {
      const newDue = addDays(longDueDate, 140)
      renewals = [{ id: 'demo-renewal-1', agreed_at: new Date().toISOString(), old_due_date: longDueDate, new_due_date: newDue }]
      longDueDate = newDue
      return json({ ok: true, new_due_date: newDue })
    }

    // ---------- 管理端 ----------
    if (path === '/api/admin/equipment-overview' && method === 'GET') {
      const entry = (over: Partial<Record<string, unknown>>) => ({
        id: 'x', status: 'borrowed', teacher_name: '', loan_date: today, end_date: today,
        start_period: 'p1', end_period: 'p4', periods: ['p1', 'p2', 'p3', 'p4'],
        overdue: false, is_group: false, group_name: '', ...over,
      })
      return json({
        today,
        rows: [
          { id: 't1', name: '平板電腦(教師機)', asset_number: 'gpps-114-01', location: '資訊組充電車', status: 'available', shortLoans: [entry({ id: 's1', teacher_name: '王小明', start_period: 'p2', end_period: 'p4', periods: ['p2', 'p3', 'p4'] })], longLoan: null },
          { id: 't2', name: '平板電腦(教師機)', asset_number: 'gpps-114-02', location: '資訊組充電車', status: 'available', shortLoans: [entry({ id: 's2', status: 'reserved', teacher_name: '林美惠', loan_date: addDays(today, 1), end_date: addDays(today, 1) })], longLoan: null },
          { id: 't3', name: '平板電腦(教師機)', asset_number: 'gpps-114-03', location: '資訊組充電車', status: 'available', shortLoans: [], longLoan: null },
          { id: 't4', name: '平板電腦(教師機)', asset_number: 'gpps-114-04', location: '資訊組充電車', status: 'available', shortLoans: [entry({ id: 's3', status: 'reserved', teacher_name: '張志成', is_group: true, group_name: '平板充電車 A 車' })], longLoan: null },
          { id: 'n1', name: '筆記型電腦(教師機)', asset_number: 'NB-01', location: '資訊組防潮櫃', status: 'available', shortLoans: [], longLoan: { borrower_name: '陳大文', is_external: false, start_date: addDays(today, -60), due_date: addDays(today, 80), overdue: false, is_group: false, group_name: '' } },
          { id: 'n2', name: '筆記型電腦(教師機)', asset_number: 'NB-02', location: '資訊組防潮櫃', status: 'available', shortLoans: [entry({ id: 's4', teacher_name: '李芳如', loan_date: addDays(today, -2), end_date: addDays(today, -2), overdue: true })], longLoan: null },
          { id: 'c1', name: '攝影機', asset_number: '3000063', location: '資訊組防潮櫃', status: 'available', shortLoans: [], longLoan: null },
        ],
      })
    }

    if (path === '/api/admin/equipment-loan-events' && method === 'GET') {
      const at = (h: number, m: number) => `${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
      const ev = (o: Record<string, unknown>) => ({
        id: String(Math.random()), loan_id: null, equipment_name: '', asset_number: '',
        teacher_name: '', action: 'reserved', detail: `${today}｜第2節、第3節`, actor_name: '', ...o,
      })
      return json({
        events: [
          ev({ id: 'e1', action: 'returned', equipment_name: '平板電腦(教師機)', asset_number: 'gpps-114-02', teacher_name: '林美惠', actor_name: '林美惠', created_at: at(14, 10) }),
          ev({ id: 'e2', action: 'borrowed', equipment_name: '攝影機', asset_number: '3000063', teacher_name: '張志成', actor_name: '張志成', created_at: at(13, 5) }),
          ev({ id: 'e3', action: 'reserved', equipment_name: '平板充電車 A 車（整組）', teacher_name: '張志成', actor_name: '張志成', created_at: at(12, 40), detail: `${addDays(today, 1)}｜第1節～第4節` }),
          ev({ id: 'e4', action: 'borrowed', equipment_name: '平板電腦(教師機)', asset_number: 'gpps-114-01', teacher_name: '王小明', actor_name: '王小明', created_at: at(10, 22) }),
          ev({ id: 'e5', action: 'cancelled', equipment_name: '筆記型電腦(教師機)', asset_number: 'NB-03', teacher_name: '李芳如', actor_name: '李芳如', created_at: at(9, 45) }),
          ev({ id: 'e6', action: 'reserved', equipment_name: '平板電腦(教師機)', asset_number: 'gpps-114-01', teacher_name: '王小明', actor_name: '王小明', created_at: at(8, 30) }),
        ],
        loanDetails: {},
        photoUrls: {},
      })
    }

    // 其餘（統計等）給空回應避免噴錯
    if (path.startsWith('/api/admin/equipment')) {
      return json({ teacherStats: [], equipmentStats: [], monthly: [], longOverdue: [], loans: [], photoUrls: {} })
    }

    return realFetch(input as RequestInfo, init)
  }
}
