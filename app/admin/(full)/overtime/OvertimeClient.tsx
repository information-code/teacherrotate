'use client'

// 超鐘簽到：儀表板／經費來源／教師清冊／不上課時段／生成簽到表 五個 TAB。
// 減課節數＝計畫期程內符合星期的日子，扣掉國定假日（holidays）與特殊不上課日。
import { useMemo, useRef, useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  OT_CATEGORIES, OT_WEEKDAYS, OT_DAY_ZH, OT_PERIOD_ZH, OT_WEEKLY_CAP, isCappedCategory,
  otCategoryLabel, buildSkipSet, weekdayCounts, expandSessions, monthRange, money,
  slotEffRange, rangesOverlap, maxConcurrentSlots,
  type OtPlan, type OtTeacher, type OtSlot, type OtSkipDate, type OtHoliday, type OtRange,
} from '@/lib/overtime'
import { exportSigninPdf, exportRosterPdf, saveBlob, type SigninSheet, type RosterRow } from '@/lib/overtime-export'
import type { TeacherCourse } from '@/lib/overtime-courses'

interface ProfileOption { id: string; name: string; employment_type: string }

/** 同一人（跨計畫）的一筆減課時段＋實際生效區間，供衝突與上限判斷 */
interface PersonSlot {
  id: string
  teacher_row_id: string
  weekday: number
  period: number
  eff: [string, string]
}

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '操作失敗')
  return data
}

/** 金額字串正規化：全形數字轉半形、去逗號與空白 */
function cleanNumberText(text: string): string {
  return text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s]/g, '')
}

function parseIntOr(text: string, fallback: number): number {
  const cleaned = cleanNumberText(text)
  if (!cleaned) return fallback
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/** 嚴格版：空字串＝0，內容無法解析回傳 null（呼叫端提示錯誤，不靜默歸零） */
function parseIntStrict(text: string): number | null {
  const cleaned = cleanNumberText(text)
  if (!cleaned) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 同一人跨計畫的識別鍵（系統帳號用 id、手動列用姓名） */
const teacherKey = (t: OtTeacher) => t.teacher_id ?? `name:${t.name}`

export default function OvertimeClient({
  initialPlans, initialTeachers, initialSlots, initialSkips, holidays, profileOptions, teacherCourses,
}: {
  initialPlans: OtPlan[]
  initialTeachers: OtTeacher[]
  initialSlots: OtSlot[]
  initialSkips: OtSkipDate[]
  holidays: OtHoliday[]
  profileOptions: ProfileOption[]
  teacherCourses: Record<string, TeacherCourse[]>   // profile id → 週課務（課表未發布時為空）
}) {
  const [plans, setPlans] = useState<OtPlan[]>(initialPlans)
  const [teachers, setTeachers] = useState<OtTeacher[]>(initialTeachers)
  const [slots, setSlots] = useState<OtSlot[]>(initialSlots)
  const [skips, setSkips] = useState<OtSkipDate[]>(initialSkips)
  const [tab, setTab] = useState<'dashboard' | 'plans' | 'roster' | 'skips' | 'export'>('dashboard')
  const [planId, setPlanId] = useState<string>(
    initialPlans.find(p => p.mine !== false)?.id ?? '')

  // 訊息：一般訊息 4 秒自動消失；錯誤改紅色橫幅常駐（手動關），避免存檔失敗沒被看到
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const flashSeq = useRef(0)
  const flash = (text: string, error = false) => {
    const id = ++flashSeq.current
    setMessage({ text, error })
    if (!error) setTimeout(() => { if (flashSeq.current === id) setMessage(null) }, 4000)
  }
  const [busy, setBusy] = useState('')
  const runBusy = async (msg: string, fn: () => Promise<void>) => {
    setBusy(msg)
    try {
      await fn()
    } catch (e) {
      flash(`儲存失敗：${e instanceof Error ? e.message : '操作失敗'}`, true)
    } finally {
      setBusy('')
    }
  }

  const skipSet = useMemo(() => buildSkipSet(holidays, skips), [holidays, skips])
  const today = todayStr()

  // 計畫互不相碰：畫面只列自己可管理的計畫（superadmin＝全部）；
  // 但同一位老師的統計（personSlotsOf 的重疊與上限）仍掃全部計畫。
  const visiblePlans = plans.filter(p => p.mine !== false)
  const visiblePlanIds = new Set(visiblePlans.map(p => p.id))
  const planIdOfRow = Object.fromEntries(teachers.map(t => [t.id, t.plan_id]))

  const selectedPlan = plans.find(p => p.id === planId) ?? null
  const planTeachers = teachers.filter(t => t.plan_id === planId)
  const slotsOf = (rowId: string) => slots.filter(s => s.teacher_row_id === rowId)
  const planById = Object.fromEntries(plans.map(p => [p.id, p]))
  /** 同一人（跨計畫）所有時段＋各自生效區間 */
  const personSlotsOf = (t: OtTeacher): PersonSlot[] => {
    const rowPlan: Record<string, OtPlan | undefined> = {}
    for (const x of teachers) if (teacherKey(x) === teacherKey(t)) rowPlan[x.id] = planById[x.plan_id]
    return slots
      .filter(s => s.teacher_row_id in rowPlan && rowPlan[s.teacher_row_id])
      .map(s => ({
        id: s.id, teacher_row_id: s.teacher_row_id, weekday: s.weekday, period: s.period,
        eff: slotEffRange(s, rowPlan[s.teacher_row_id]!),
      }))
  }

  /** 計畫期程內總節數（全部教師、扣不上課日、各時段限各自生效區段） */
  const planTotalSessions = (plan: OtPlan) => {
    let total = 0
    for (const t of teachers.filter(x => x.plan_id === plan.id)) {
      total += expandSessions(slotsOf(t.id), plan, plan.start_date, plan.end_date, skipSet).length
    }
    return total
  }

  // ───────────── 經費來源 ─────────────
  const [planDraft, setPlanDraft] = useState<{
    id: string; name: string; start_date: string; end_date: string; rateText: string; budgetText: string
  } | null>(null)

  const savePlan = async () => {
    if (!planDraft) return
    const isCreate = !planDraft.id
    const rate = parseIntStrict(planDraft.rateText)
    const budget = parseIntStrict(planDraft.budgetText)
    if (rate === null) { flash('節薪請輸入數字', true); return }
    if (budget === null) { flash('總預算請輸入數字', true); return }
    const payload = {
      id: planDraft.id || undefined,
      name: planDraft.name.trim(),
      start_date: planDraft.start_date,
      end_date: planDraft.end_date,
      rate,
      budget,
    }
    await runBusy('儲存計畫中…', async () => {
      const data = await call('/api/admin/overtime/plans', isCreate ? 'POST' : 'PUT', payload)
      const saved: OtPlan = {
        id: data.id, name: data.name, start_date: data.start_date,
        end_date: data.end_date, rate: data.rate, budget: data.budget,
      }
      setPlans(list => {
        const next = isCreate ? [...list, saved] : list.map(p => (p.id === saved.id ? saved : p))
        return next.sort((a, b) => a.start_date.localeCompare(b.start_date))
      })
      if (!planId) setPlanId(saved.id)
      setPlanDraft(null)
      flash('計畫已儲存')
    })
  }

  const deletePlan = async (p: OtPlan) => {
    const count = teachers.filter(t => t.plan_id === p.id).length
    if (!confirm(`確定刪除「${p.name}」？清冊 ${count} 位教師與其減課時段會一併刪除。`)) return
    await runBusy('刪除計畫中…', async () => {
      await call(`/api/admin/overtime/plans?id=${p.id}`, 'DELETE')
      const removedRows = new Set(teachers.filter(t => t.plan_id === p.id).map(t => t.id))
      setPlans(list => list.filter(x => x.id !== p.id))
      setTeachers(list => list.filter(t => t.plan_id !== p.id))
      setSlots(list => list.filter(s => !removedRows.has(s.teacher_row_id)))
      if (planId === p.id) setPlanId('')
      flash('計畫已刪除')
    })
  }

  // ───────────── 教師清冊 ─────────────
  const [addMode, setAddMode] = useState<'profile' | 'manual'>('profile')
  const [addProfileId, setAddProfileId] = useState('')
  const [addName, setAddName] = useState('')

  const addTeacher = async () => {
    if (!selectedPlan) return
    const profile = addMode === 'profile' ? profileOptions.find(p => p.id === addProfileId) : null
    const name = addMode === 'profile' ? (profile?.name ?? '') : addName.trim()
    if (!name) { flash(addMode === 'profile' ? '請選擇教師' : '請填寫教師姓名'); return }
    await runBusy('新增教師中…', async () => {
      const data = await call('/api/admin/overtime/teachers', 'POST', {
        plan_id: selectedPlan.id,
        teacher_id: profile?.id ?? null,
        name,
      })
      setTeachers(list => [...list, {
        id: data.id, plan_id: data.plan_id, teacher_id: data.teacher_id, name: data.name,
        category: data.category, labor_fee: data.labor_fee, health_fee: data.health_fee,
        lunch_fee: data.lunch_fee, other_fee: data.other_fee, note: data.note, ranges: [],
      }])
      setAddProfileId(''); setAddName('')
      flash('已加入清冊')
    })
  }

  const saveTeacher = async (id: string, patch: {
    labor_fee: number; health_fee: number; lunch_fee: number; other_fee: number; note: string
  }) => {
    await runBusy('儲存中…', async () => {
      await call('/api/admin/overtime/teachers', 'PUT', { id, ...patch })
      setTeachers(list => list.map(t => (t.id === id ? { ...t, ...patch } : t)))
      flash('已儲存')
    })
  }

  const deleteTeacher = async (t: OtTeacher) => {
    if (!confirm(`確定將「${t.name}」移出清冊？其減課時段會一併刪除。`)) return
    await runBusy('移除中…', async () => {
      await call(`/api/admin/overtime/teachers?id=${t.id}`, 'DELETE')
      setTeachers(list => list.filter(x => x.id !== t.id))
      setSlots(list => list.filter(s => s.teacher_row_id !== t.id))
      flash('已移出清冊')
    })
  }

  const addSlot = async (
    rowId: string, weekday: number, period: number, class_name: string, domain: string,
    start_date: string | null, end_date: string | null,
  ) => {
    await runBusy('新增時段中…', async () => {
      const data = await call('/api/admin/overtime/slots', 'POST', {
        teacher_row_id: rowId, weekday, period, class_name, domain, start_date, end_date,
      })
      setSlots(list => [...list, {
        id: data.id, teacher_row_id: data.teacher_row_id, weekday: data.weekday,
        period: data.period, class_name: data.class_name, domain: data.domain,
        start_date: data.start_date, end_date: data.end_date,
      }].sort((a, b) => a.weekday - b.weekday || a.period - b.period))
      flash('時段已新增')
    })
  }

  const deleteSlot = async (id: string) => {
    await runBusy('刪除時段中…', async () => {
      await call(`/api/admin/overtime/slots?id=${id}`, 'DELETE')
      setSlots(list => list.filter(s => s.id !== id))
      flash('時段已刪除')
    })
  }

  // ───────────── 不上課時段 ─────────────
  const [skipDate, setSkipDate] = useState('')
  const [skipName, setSkipName] = useState('')

  const addSkip = async () => {
    if (!skipDate) { flash('請選擇日期'); return }
    await runBusy('新增不上課日中…', async () => {
      const data = await call('/api/admin/overtime/skip-dates', 'POST', { date: skipDate, name: skipName.trim() })
      setSkips(list => [...list.filter(s => s.date !== data.date), { id: data.id, date: data.date, name: data.name }]
        .sort((a, b) => a.date.localeCompare(b.date)))
      setSkipDate(''); setSkipName('')
      flash('已新增不上課日')
    })
  }

  const deleteSkip = async (s: OtSkipDate) => {
    await runBusy('刪除中…', async () => {
      await call(`/api/admin/overtime/skip-dates?id=${s.id}`, 'DELETE')
      setSkips(list => list.filter(x => x.id !== s.id))
      flash('已刪除')
    })
  }

  // ───────────── 生成簽到表 ─────────────
  const [exportMonth, setExportMonth] = useState(today.slice(0, 7))

  const monthSessionsOf = (plan: OtPlan) => {
    const range = monthRange(exportMonth)
    if (!range) return new Map<string, ReturnType<typeof expandSessions>>()
    const map = new Map<string, ReturnType<typeof expandSessions>>()
    for (const t of teachers.filter(x => x.plan_id === plan.id)) {
      map.set(t.id, expandSessions(slotsOf(t.id), plan, range[0], range[1], skipSet))
    }
    return map
  }

  const downloadSignin = async () => {
    if (!selectedPlan) { flash('請先選擇計畫'); return }
    const sessions = monthSessionsOf(selectedPlan)
    const sheets: SigninSheet[] = planTeachers.map(t => ({ teacher: t, sessions: sessions.get(t.id) ?? [] }))
    if (sheets.length === 0) { flash('此計畫清冊沒有教師'); return }
    await runBusy('產生簽到表 PDF…', async () => {
      const blob = await exportSigninPdf(selectedPlan, exportMonth, sheets, setBusy)
      saveBlob(blob, `簽到表_${selectedPlan.name}_${exportMonth}.pdf`)
      flash('簽到表已下載')
    })
  }

  const downloadRoster = async () => {
    if (!selectedPlan) { flash('請先選擇計畫'); return }
    const sessions = monthSessionsOf(selectedPlan)
    const rows: RosterRow[] = planTeachers.map(t => ({ teacher: t, count: (sessions.get(t.id) ?? []).length }))
    if (rows.length === 0) { flash('此計畫清冊沒有教師'); return }
    await runBusy('產生清冊 PDF…', async () => {
      const blob = await exportRosterPdf(selectedPlan, exportMonth, rows, today, setBusy)
      saveBlob(blob, `清冊_${selectedPlan.name}_${exportMonth}.pdf`)
      flash('清冊已下載')
    })
  }

  // ───────────── 儀表板統計 ─────────────
  const distinctBy = (filter: (t: OtTeacher) => boolean) =>
    new Set(teachers.filter(t => visiblePlanIds.has(t.plan_id)).filter(filter).map(teacherKey)).size
  const overtimeCount = distinctBy(t => isCappedCategory(t.category))
  const hourlyCount = distinctBy(t => !isCappedCategory(t.category))
  const visibleSlotCount = slots.filter(s => visiblePlanIds.has(planIdOfRow[s.teacher_row_id] ?? '')).length

  const planSelector = (
    <select className="input max-w-xs" value={planId} onChange={e => setPlanId(e.target.value)}>
      <option value="">— 選擇計畫 —</option>
      {visiblePlans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )

  return (
    <div className="space-y-4">
      {busy && <BusyOverlay text={busy} />}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">超鐘簽到</h1>
        {message && !message.error && (
          <span className="text-sm text-zinc-600" aria-live="polite">{message.text}</span>
        )}
      </div>
      {message?.error && (
        <div className="flex items-start justify-between gap-3 border border-red-300 bg-red-50 text-red-700 text-sm rounded px-3 py-2" role="alert">
          <span>{message.text}</span>
          <button className="text-red-400 hover:text-red-700 flex-shrink-0" onClick={() => setMessage(null)} aria-label="關閉">✕</button>
        </div>
      )}

      <div className="flex border-b border-zinc-200 overflow-x-auto">
        {([
          ['dashboard', '儀表板'],
          ['plans', '經費來源'],
          ['roster', '教師清冊'],
          ['skips', '不上課時段'],
          ['export', '生成簽到表'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === key
                ? 'border-zinc-800 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ============ 儀表板 ============ */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              ['計畫數', String(visiblePlans.length)],
              ['超鐘點教師（正式＋代理）', `${overtimeCount} 人`],
              ['鐘點／外師', `${hourlyCount} 人`],
              ['減課時段數合計', `${visibleSlotCount} 節`],
            ] as const).map(([label, value]) => (
              <div key={label} className="card !p-4">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
              </div>
            ))}
          </div>

          {visiblePlans.length === 0 && (
            <div className="card text-sm text-zinc-500">
              尚未建立任何計畫。請先到「經費來源」新增計畫經費。
            </div>
          )}

          {visiblePlans.map(p => {
            const counts = weekdayCounts(p.start_date, p.end_date, skipSet)
            const totalSessions = planTotalSessions(p)
            const totalAmount = totalSessions * p.rate
            const remain = p.budget - totalAmount
            const daysLeft = Math.ceil((Date.parse(p.end_date) - Date.parse(today)) / 86400000)
            const people = teachers.filter(t => t.plan_id === p.id).length
            return (
              <div key={p.id} className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-medium text-zinc-900">{p.name}</h2>
                  <span className={`text-sm ${daysLeft < 0 ? 'text-zinc-400' : daysLeft <= 30 ? 'text-red-600' : 'text-zinc-500'}`}>
                    {daysLeft < 0 ? '計畫已結束' : `距計畫結束還有 ${daysLeft} 天`}
                  </span>
                </div>
                <div className="text-sm text-zinc-500">
                  期程 {p.start_date} ～ {p.end_date}｜節薪 {money(p.rate)} 元
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  {([
                    ['總人數', `${people} 人`],
                    ['總節數', `${totalSessions} 節`],
                    ['總支出', `${money(totalAmount)} 元`],
                    ['總預算', p.budget > 0 ? `${money(p.budget)} 元` : '未設定'],
                    ['剩餘款', p.budget > 0 ? `${money(remain)} 元` : '—'],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="border border-zinc-200 rounded p-2">
                      <div className="text-xs text-zinc-500">{label}</div>
                      <div className={`mt-0.5 font-medium ${label === '剩餘款' && p.budget > 0 && remain < 0 ? 'text-red-600' : 'text-zinc-900'}`}>{value}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">期程內各星期可授課日數（已扣除不上課日）</div>
                  <div className="flex gap-2 text-sm">
                    {OT_WEEKDAYS.map(w => (
                      <div key={w} className="border border-zinc-200 rounded px-3 py-1.5">
                        週{OT_DAY_ZH[w]}　<span className="font-medium">{counts[w - 1]}</span> 天
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ============ 經費來源 ============ */}
      {tab === 'plans' && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-zinc-900">計畫經費</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                計畫經費名稱、期程與節薪；總預算供儀表板計算剩餘款（可留 0）。
                各管理者只看到自己建立的計畫（最高管理者可見全部）；教師的同週上限與重複檢查仍跨全部計畫合併計算。
              </p>
            </div>
            <button className="btn-secondary" onClick={() => setPlanDraft({
              id: '', name: '', start_date: '', end_date: '', rateText: '405', budgetText: '0',
            })}>
              新增計畫
            </button>
          </div>

          {planDraft && (
            <div className="border border-zinc-300 rounded p-4 space-y-3 bg-zinc-50">
              <div className="grid md:grid-cols-2 gap-3">
                <label className="block md:col-span-2">
                  <span className="text-xs text-zinc-500">計畫經費名稱</span>
                  <input className="input w-full" value={planDraft.name}
                    onChange={e => setPlanDraft({ ...planDraft, name: e.target.value })}
                    placeholder="例：數位精進計畫-…減課鐘點費" />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">期程開始</span>
                  <input type="date" className="input w-full" value={planDraft.start_date}
                    onChange={e => setPlanDraft({ ...planDraft, start_date: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">期程結束</span>
                  <input type="date" className="input w-full" value={planDraft.end_date}
                    onChange={e => setPlanDraft({ ...planDraft, end_date: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">節薪（元）</span>
                  <input className="input w-full" inputMode="numeric" value={planDraft.rateText}
                    onChange={e => setPlanDraft({ ...planDraft, rateText: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-xs text-zinc-500">總預算（元，0＝未設定）</span>
                  <input className="input w-full" inputMode="numeric" value={planDraft.budgetText}
                    onChange={e => setPlanDraft({ ...planDraft, budgetText: e.target.value })} />
                </label>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={savePlan}>儲存</button>
                <button className="btn-secondary" onClick={() => setPlanDraft(null)}>取消</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                  <th className="py-2 pr-3">計畫經費名稱</th>
                  <th className="py-2 pr-3">期程</th>
                  <th className="py-2 pr-3 text-right">節薪</th>
                  <th className="py-2 pr-3 text-right">總預算</th>
                  <th className="py-2 pr-3 text-right">清冊人數</th>
                  <th className="py-2 pr-3">建立者</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visiblePlans.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-zinc-400">尚未建立計畫</td></tr>
                )}
                {visiblePlans.map(p => (
                  <tr key={p.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 text-zinc-900">{p.name}</td>
                    <td className="py-2 pr-3 text-zinc-600 whitespace-nowrap">{p.start_date} ～ {p.end_date}</td>
                    <td className="py-2 pr-3 text-right">{money(p.rate)}</td>
                    <td className="py-2 pr-3 text-right">{p.budget > 0 ? money(p.budget) : '—'}</td>
                    <td className="py-2 pr-3 text-right">{teachers.filter(t => t.plan_id === p.id).length}</td>
                    <td className="py-2 pr-3 text-zinc-500">{p.created_by_name || '—'}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button className="text-zinc-600 hover:text-zinc-900 mr-3" onClick={() => setPlanDraft({
                        id: p.id, name: p.name, start_date: p.start_date, end_date: p.end_date,
                        rateText: String(p.rate), budgetText: String(p.budget),
                      })}>編輯</button>
                      <button className="text-red-600 hover:text-red-700" onClick={() => deletePlan(p)}>刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============ 教師清冊 ============ */}
      {tab === 'roster' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-medium text-zinc-900">減課計畫</h2>
              {planSelector}
            </div>
            {!selectedPlan && <p className="text-sm text-zinc-500">請先選擇計畫（沒有的話先到「經費來源」新增）。</p>}
            {selectedPlan && (
              <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
                <label className="block">
                  <span className="text-xs text-zinc-500">來源</span>
                  <select className="input block" value={addMode} onChange={e => setAddMode(e.target.value as 'profile' | 'manual')}>
                    <option value="profile">系統教師</option>
                    <option value="manual">手動輸入（鐘點人員）</option>
                  </select>
                </label>
                {addMode === 'profile' ? (
                  <label className="block">
                    <span className="text-xs text-zinc-500">教師</span>
                    <TeacherPicker
                      options={profileOptions}
                      value={addProfileId}
                      onSelect={p => setAddProfileId(p?.id ?? '')}
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="text-xs text-zinc-500">姓名</span>
                    <input className="input block" value={addName} onChange={e => setAddName(e.target.value)} />
                  </label>
                )}
                <button className="btn-primary" onClick={addTeacher}>加入清冊</button>
                <span className="text-xs text-zinc-400 pb-2">
                  身分依帳號資料聘任別自動帶入；正式／代理每人每週上限 {OT_WEEKLY_CAP} 節（跨計畫合計），鐘點／外師與手動輸入無上限。
                </span>
              </div>
            )}
          </div>

          {selectedPlan && planTeachers.length === 0 && (
            <div className="card text-sm text-zinc-400">此計畫清冊尚無教師。</div>
          )}
          {selectedPlan && planTeachers.map(t => (
            <TeacherCard
              key={t.id}
              teacher={t}
              plan={selectedPlan}
              slots={slotsOf(t.id)}
              personSlots={personSlotsOf(t)}
              courses={t.teacher_id ? (teacherCourses[t.teacher_id] ?? []) : []}
              onSave={saveTeacher}
              onDelete={() => deleteTeacher(t)}
              onAddSlot={addSlot}
              onDeleteSlot={deleteSlot}
            />
          ))}
        </div>
      )}

      {/* ============ 不上課時段 ============ */}
      {tab === 'skips' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <div>
              <h2 className="font-medium text-zinc-900">特殊不上課日</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                校內活動、停課等特殊日期；產出簽到表時該日會跳過減課。
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs text-zinc-500">日期</span>
                <input type="date" className="input block" value={skipDate} onChange={e => setSkipDate(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">說明</span>
                <input className="input block" value={skipName} onChange={e => setSkipName(e.target.value)} placeholder="例：校慶運動會" />
              </label>
              <button className="btn-primary" onClick={addSkip}>新增</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {skips.length === 0 && <span className="text-sm text-zinc-400">尚無特殊不上課日</span>}
              {skips.map(s => (
                <span key={s.id} className="inline-flex items-center gap-2 border border-zinc-300 rounded px-2 py-1 text-sm">
                  {s.date}{s.name && `　${s.name}`}
                  <button className="text-zinc-400 hover:text-red-600" onClick={() => deleteSkip(s)} aria-label="刪除">✕</button>
                </span>
              ))}
            </div>
          </div>

          <div className="card space-y-2">
            <div>
              <h2 className="font-medium text-zinc-900">國定假日（自動跳過）</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                由「行事曆管理」的假日維護同步（政府行政機關辦公日曆表）；放假日產出時自動跳過，這裡僅供檢視。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {holidays.filter(h => h.is_holiday).length === 0 && (
                <span className="text-sm text-zinc-400">尚無假日資料，請先到「行事曆管理」同步年度假日。</span>
              )}
              {holidays.filter(h => h.is_holiday).map(h => (
                <span key={h.date} className="inline-flex items-center gap-1 border border-zinc-200 bg-zinc-50 rounded px-2 py-1 text-sm text-zinc-600">
                  {h.date}{h.name && `　${h.name}`}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ 生成簽到表 ============ */}
      {tab === 'export' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <div>
              <h2 className="font-medium text-zinc-900">生成簽到表</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                選擇計畫與月份：個人簽到表（一師一頁）或清冊（同計畫全體、含代扣款與實領薪資）。
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs text-zinc-500">計畫</span>
                <div>{planSelector}</div>
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">月份</span>
                <input type="month" className="input block" value={exportMonth} onChange={e => setExportMonth(e.target.value)} />
              </label>
              <button className="btn-primary" onClick={downloadSignin}>⬇ 個人簽到表 PDF</button>
              <button className="btn-secondary" onClick={downloadRoster}>⬇ 鐘點費清冊 PDF</button>
            </div>
          </div>

          {selectedPlan && (
            <div className="card space-y-2">
              <h3 className="text-sm font-medium text-zinc-900">{exportMonth} 預覽</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                      <th className="py-2 pr-3">姓名</th>
                      <th className="py-2 pr-3 text-right">節數</th>
                      <th className="py-2 pr-3 text-right">鐘點費</th>
                      <th className="py-2 pr-3 text-right">代扣合計</th>
                      <th className="py-2 pr-3 text-right">實領薪資</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const sessions = monthSessionsOf(selectedPlan)
                      let tc = 0, tp = 0, tn = 0
                      const rows = planTeachers.map(t => {
                        const count = (sessions.get(t.id) ?? []).length
                        const pay = count * selectedPlan.rate
                        const deduct = t.labor_fee + t.health_fee + t.lunch_fee + t.other_fee
                        tc += count; tp += pay; tn += pay - deduct
                        return (
                          <tr key={t.id} className="border-b border-zinc-100">
                            <td className="py-1.5 pr-3">{t.name}</td>
                            <td className="py-1.5 pr-3 text-right">{count}</td>
                            <td className="py-1.5 pr-3 text-right">{money(pay)}</td>
                            <td className="py-1.5 pr-3 text-right">{deduct ? money(deduct) : '—'}</td>
                            <td className="py-1.5 pr-3 text-right">{money(pay - deduct)}</td>
                          </tr>
                        )
                      })
                      return (
                        <>
                          {rows}
                          {rows.length === 0 && (
                            <tr><td colSpan={5} className="py-4 text-center text-zinc-400">此計畫清冊沒有教師</td></tr>
                          )}
                          {rows.length > 0 && (
                            <tr className="font-medium">
                              <td className="py-1.5 pr-3">合計</td>
                              <td className="py-1.5 pr-3 text-right">{tc}</td>
                              <td className="py-1.5 pr-3 text-right">{money(tp)}</td>
                              <td className="py-1.5 pr-3 text-right" />
                              <td className="py-1.5 pr-3 text-right">{money(tn)}</td>
                            </tr>
                          )}
                        </>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 教師搜尋下拉：打字過濾姓名＋正式／代理篩選、點選帶入（人多時比原生 select 好找） */
function TeacherPicker({ options, value, onSelect }: {
  options: ProfileOption[]
  value: string
  onSelect: (p: ProfileOption | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [empFilter, setEmpFilter] = useState('all')
  const selected = options.find(o => o.id === value) ?? null
  const q = query.trim()
  const matches = options.filter(o =>
    (empFilter === 'all' || o.employment_type === empFilter)
    && (!q || o.name.includes(q)))
  const SHOW_MAX = 80
  return (
    <div className="relative">
      <input
        className="input block w-56"
        placeholder="輸入姓名搜尋…"
        value={open ? query : (selected?.name ?? '')}
        onFocus={() => { setOpen(true); setQuery('') }}
        onBlur={() => setOpen(false)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-56 max-h-64 overflow-y-auto border border-zinc-300 bg-white rounded shadow-md">
          <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-zinc-100 sticky top-0 bg-white">
            {([['all', '全部'], ...OT_CATEGORIES.map(c => [c.value, c.label])] as [string, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`px-2 py-0.5 text-xs rounded border ${
                  empFilter === key ? 'border-zinc-700 bg-zinc-800 text-white' : 'border-zinc-200 text-zinc-500 hover:text-zinc-700'
                }`}
                onMouseDown={e => { e.preventDefault(); setEmpFilter(key) }}
              >
                {label}
              </button>
            ))}
          </div>
          {matches.length === 0 && (
            <div className="px-3 py-2 text-sm text-zinc-400">沒有符合的教師</div>
          )}
          {matches.slice(0, SHOW_MAX).map(p => (
            <button
              key={p.id}
              type="button"
              className={`flex w-full items-center justify-between text-left px-3 py-1.5 text-sm hover:bg-zinc-100 ${
                p.id === value ? 'bg-zinc-50 font-medium' : ''
              }`}
              onMouseDown={e => {
                e.preventDefault()   // 先於 blur 觸發，避免選單先關掉
                onSelect(p)
                setQuery('')
                setOpen(false)
              }}
            >
              <span>{p.name}</span>
              <span className="text-xs text-zinc-400">{otCategoryLabel(p.employment_type)}</span>
            </button>
          ))}
          {matches.length > SHOW_MAX && (
            <div className="px-3 py-1.5 text-xs text-zinc-400">還有 {matches.length - SHOW_MAX} 位，請輸入姓名縮小範圍</div>
          )}
        </div>
      )}
    </div>
  )
}


/** 區段 key（null＝全期程） */
const secKey = (start: string | null, end: string | null) => `${start ?? ''}|${end ?? ''}`

interface CardSection { start: string | null; end: string | null }

/**
 * 清冊教師卡（可收合，預設收合）。順序：
 * (1) 超鐘點時間區段——一個區段一組減課時段（時段掛在區段上，各區段可不同）
 * (2) 其他費用 (3) 備註。
 * 課務點選勾選；同一人「重疊區段」已勾的星期節次鎖定（含其他計畫）；
 * 正式／代理同一週同時生效最多 6 節（不重疊的區段可各自用滿）。
 * 無課務資料（手動人員／課表未發布）退回手動輸入。
 */
function TeacherCard({
  teacher, plan, slots, personSlots, courses, onSave, onDelete, onAddSlot, onDeleteSlot,
}: {
  teacher: OtTeacher
  plan: OtPlan
  slots: OtSlot[]
  personSlots: PersonSlot[]
  courses: TeacherCourse[]
  onSave: (id: string, patch: {
    labor_fee: number; health_fee: number; lunch_fee: number; other_fee: number; note: string
  }) => Promise<void>
  onDelete: () => void
  onAddSlot: (
    rowId: string, weekday: number, period: number, class_name: string, domain: string,
    start: string | null, end: string | null,
  ) => Promise<void>
  onDeleteSlot: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<OtRange[]>([])   // 本次新增、還沒勾任何時段的區段
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [laborText, setLaborText] = useState(String(teacher.labor_fee))
  const [healthText, setHealthText] = useState(String(teacher.health_fee))
  const [lunchText, setLunchText] = useState(String(teacher.lunch_fee))
  const [otherText, setOtherText] = useState(String(teacher.other_fee))
  const [note, setNote] = useState(teacher.note)
  // 手動輸入（無課務資料時）
  const [slotWeekday, setSlotWeekday] = useState(1)
  const [slotPeriod, setSlotPeriod] = useState(1)
  const [slotClass, setSlotClass] = useState('')
  const [slotDomain, setSlotDomain] = useState('')

  const capped = isCappedCategory(teacher.category)
  const personEffs = personSlots.map(p => p.eff)
  const maxWeekly = maxConcurrentSlots(personEffs)
  const dirty = parseIntOr(laborText, 0) !== teacher.labor_fee
    || parseIntOr(healthText, 0) !== teacher.health_fee
    || parseIntOr(lunchText, 0) !== teacher.lunch_fee
    || parseIntOr(otherText, 0) !== teacher.other_fee
    || note !== teacher.note

  // 區段清單：由既有時段推導＋本次待勾選的；都沒有時給一個全期程預設
  const sectionMap = new Map<string, CardSection>()
  for (const s of slots) sectionMap.set(secKey(s.start_date, s.end_date), { start: s.start_date, end: s.end_date })
  for (const r of pending) {
    if (!sectionMap.has(secKey(r.start, r.end))) sectionMap.set(secKey(r.start, r.end), r)
  }
  if (sectionMap.size === 0) sectionMap.set(secKey(null, null), { start: null, end: null })
  const sections = Array.from(sectionMap.values())
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
  const sectionSlots = (sec: CardSection) =>
    slots.filter(s => secKey(s.start_date, s.end_date) === secKey(sec.start, sec.end))
  const secLabel = (sec: CardSection) =>
    sec.start ? `${sec.start} ～ ${sec.end}` : `全期程（${plan.start_date} ～ ${plan.end_date}）`

  // 收合標題列的區段摘要（只列有時段的）
  const usedSections = sections.filter(sec => sectionSlots(sec).length > 0)
  const summary = usedSections.length === 0 || (usedSections.length === 1 && usedSections[0].start === null)
    ? '全期程'
    : usedSections.map(sec => (sec.start ? `${sec.start.slice(5)}～${sec.end!.slice(5)}` : '全期程')).join('、')

  const addRange = () => {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return
    setPending(list => [...list, { start: rangeStart, end: rangeEnd }])
    setRangeStart(''); setRangeEnd('')
  }

  return (
    <div className="card !p-4 space-y-3">
      {/* 標題列：點擊展開／收合 */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-400 text-xs w-3">{open ? '▾' : '▸'}</span>
          <span className="font-medium text-zinc-900">{teacher.name}</span>
          <span className="text-xs text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">
            {otCategoryLabel(teacher.category)}
          </span>
          <span className="text-xs text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">
            本計畫 {slots.length} 節
          </span>
          {capped && (
            <span className={`text-xs rounded px-1.5 py-0.5 border ${
              maxWeekly > OT_WEEKLY_CAP ? 'border-red-300 text-red-600'
              : maxWeekly === OT_WEEKLY_CAP ? 'border-amber-300 text-amber-700'
              : 'border-zinc-200 text-zinc-500'
            }`}>
              同週最多 {maxWeekly} / {OT_WEEKLY_CAP} 節
            </span>
          )}
          <span className="text-xs text-zinc-400">區段：{summary}</span>
        </div>
        <button
          className="text-sm text-red-600 hover:text-red-700"
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          移出清冊
        </button>
      </div>

      {open && (<>
      {/* (1) 超鐘點時間區段：一個區段一組減課時段 */}
      <div className="border-t border-zinc-100 pt-3 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium text-zinc-800">超鐘點時間區段與減課時段</span>
          <span className="text-xs text-zinc-400">
            每個區段可勾選不同的減課時段；
            {courses.length > 0
              ? '點選課務勾選、再點一次取消；灰色＝重疊區段已勾選（含其他計畫）'
              : (teacher.teacher_id ? '課表尚未發布，暫以手動輸入' : '手動人員無課表，手動輸入')}
            {capped ? `；同一週最多 ${OT_WEEKLY_CAP} 節` : ''}
          </span>
        </div>

        {sections.map(sec => {
          const sSlots = sectionSlots(sec)
          const secEff: [string, string] = [sec.start ?? plan.start_date, sec.end ?? plan.end_date]
          const removable = sSlots.length === 0 && sections.length > 1
          const wouldExceed = capped && maxConcurrentSlots([...personEffs, secEff]) > OT_WEEKLY_CAP
          return (
            <div key={secKey(sec.start, sec.end)} className="border border-zinc-200 rounded p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-700">{secLabel(sec)}</span>
                {removable && (
                  <button
                    className="text-xs text-zinc-400 hover:text-red-600"
                    onClick={() => setPending(list => list.filter(r => secKey(r.start, r.end) !== secKey(sec.start, sec.end)))}
                  >
                    移除區段
                  </button>
                )}
              </div>

              {courses.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {courses.map(c => {
                    const chosen = sSlots.find(s => s.weekday === c.weekday && s.period === c.period)
                    const conflict = !chosen && personSlots.some(ps =>
                      ps.weekday === c.weekday && ps.period === c.period
                      && rangesOverlap(ps.eff[0], ps.eff[1], secEff[0], secEff[1]))
                    const capLock = !chosen && !conflict && wouldExceed
                    const disabled = conflict || capLock
                    return (
                      <button
                        key={`${c.weekday}-${c.period}`}
                        type="button"
                        disabled={disabled}
                        title={conflict ? '重疊的時間區段已勾選這個星期節次（含其他計畫）'
                          : capLock ? `加入後同一週會超過 ${OT_WEEKLY_CAP} 節` : undefined}
                        className={`border rounded px-2 py-1 text-sm transition-colors ${
                          chosen
                            ? 'border-zinc-800 bg-zinc-800 text-white'
                            : disabled
                              ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                              : 'border-zinc-300 text-zinc-700 hover:border-zinc-500'
                        }`}
                        onClick={() => {
                          if (chosen) onDeleteSlot(chosen.id)
                          else onAddSlot(teacher.id, c.weekday, c.period, c.class_name, c.domain, sec.start, sec.end)
                        }}
                      >
                        週{OT_DAY_ZH[c.weekday]} {OT_PERIOD_ZH[c.period]}　{c.class_name}　{c.domain}
                      </button>
                    )
                  })}
                  {/* 不在課務清單上的既有時段（舊資料或手動加的）仍可移除 */}
                  {sSlots.filter(s => !courses.some(c => c.weekday === s.weekday && c.period === s.period)).map(s => (
                    <span key={s.id} className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 rounded px-2 py-1 text-sm" title="不在課表課務中，請確認">
                      週{OT_DAY_ZH[s.weekday]} {OT_PERIOD_ZH[s.period]}
                      {s.class_name && `　${s.class_name}`}
                      {s.domain && `　${s.domain}`}
                      <button className="text-zinc-400 hover:text-red-600" onClick={() => onDeleteSlot(s.id)} aria-label="刪除時段">✕</button>
                    </span>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {sSlots.length === 0 && <span className="text-sm text-zinc-400">尚未設定</span>}
                    {sSlots.map(s => (
                      <span key={s.id} className="inline-flex items-center gap-2 border border-zinc-300 rounded px-2 py-1 text-sm">
                        週{OT_DAY_ZH[s.weekday]} {OT_PERIOD_ZH[s.period]}
                        {s.class_name && `　${s.class_name}`}
                        {s.domain && `　${s.domain}`}
                        <button className="text-zinc-400 hover:text-red-600" onClick={() => onDeleteSlot(s.id)} aria-label="刪除時段">✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="text-xs text-zinc-500">星期</span>
                      <select className="input block" value={slotWeekday} onChange={e => setSlotWeekday(Number(e.target.value))}>
                        {OT_WEEKDAYS.map(w => <option key={w} value={w}>週{OT_DAY_ZH[w]}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-zinc-500">節次</span>
                      <select className="input block" value={slotPeriod} onChange={e => setSlotPeriod(Number(e.target.value))}>
                        {[1, 2, 3, 4, 5, 6, 7].map(p => <option key={p} value={p}>{OT_PERIOD_ZH[p]}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs text-zinc-500">班級</span>
                      <input className="input block w-24" value={slotClass} onChange={e => setSlotClass(e.target.value)} placeholder="604" />
                    </label>
                    <label className="block">
                      <span className="text-xs text-zinc-500">領域</span>
                      <input className="input block w-28" value={slotDomain} onChange={e => setSlotDomain(e.target.value)} placeholder="數學" />
                    </label>
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        await onAddSlot(teacher.id, slotWeekday, slotPeriod, slotClass.trim(), slotDomain.trim(), sec.start, sec.end)
                        setSlotClass(''); setSlotDomain('')
                      }}
                    >
                      新增時段
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}

        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input !w-auto" value={rangeStart} aria-label="區段開始"
            min={plan.start_date} max={plan.end_date}
            onChange={e => setRangeStart(e.target.value)} />
          <span className="text-sm text-zinc-400">～</span>
          <input type="date" className="input !w-auto" value={rangeEnd} aria-label="區段結束"
            min={plan.start_date} max={plan.end_date}
            onChange={e => setRangeEnd(e.target.value)} />
          <button
            className="btn-secondary"
            disabled={!rangeStart || !rangeEnd || rangeStart > rangeEnd}
            onClick={addRange}
          >
            新增時間區段
          </button>
          <span className="text-xs text-zinc-400">先加區段、再到區段裡勾時段；沒勾任何時段的區段重新整理後會消失</span>
        </div>
      </div>

      {/* (2) 其他費用 ＋ (3) 備註：同一個 PUT，一顆儲存 */}
      <div className="border-t border-zinc-100 pt-3 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium text-zinc-800">其他費用</span>
          <span className="text-xs text-zinc-400">個人負擔代扣款，清冊 PDF 會列出並自實領扣除</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {([
            ['勞保費', laborText, setLaborText],
            ['健保費', healthText, setHealthText],
            ['午餐費代扣', lunchText, setLunchText],
            ['其他扣款', otherText, setOtherText],
          ] as const).map(([label, value, setter]) => (
            <label key={label} className="block">
              <span className="text-xs text-zinc-500">{label}</span>
              <input className="input block w-24" inputMode="numeric" value={value} onChange={e => setter(e.target.value)} />
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-100 pt-3 space-y-2">
        <div className="text-sm font-medium text-zinc-800">備註</div>
        <div className="flex items-end gap-2">
          <input className="input flex-1" value={note} placeholder="顯示於清冊 PDF 的備註欄"
            onChange={e => setNote(e.target.value)} />
          <button
            className={dirty ? 'btn-primary' : 'btn-secondary'}
            disabled={!dirty}
            onClick={() => onSave(teacher.id, {
              labor_fee: parseIntOr(laborText, 0),
              health_fee: parseIntOr(healthText, 0),
              lunch_fee: parseIntOr(lunchText, 0),
              other_fee: parseIntOr(otherText, 0),
              note,
            })}
          >
            儲存費用與備註
          </button>
        </div>
      </div>
      </>)}
    </div>
  )
}

