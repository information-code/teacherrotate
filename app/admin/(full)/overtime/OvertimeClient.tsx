'use client'

// 超鐘簽到：儀表板／經費來源／教師清冊／不上課時段／生成簽到表 五個 TAB。
// 減課節數＝計畫期程內符合星期的日子，扣掉國定假日（holidays）與特殊不上課日。
import { useMemo, useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  OT_WEEKDAYS, OT_DAY_ZH, OT_PERIOD_ZH, OT_WEEKLY_CAP, isCappedCategory,
  otCategoryLabel, buildSkipSet, weekdayCounts, expandSessions, monthRange, money,
  type OtPlan, type OtTeacher, type OtSlot, type OtSkipDate, type OtHoliday,
} from '@/lib/overtime'
import { exportSigninPdf, exportRosterPdf, saveBlob, type SigninSheet, type RosterRow } from '@/lib/overtime-export'
import type { TeacherCourse } from '@/lib/overtime-courses'

interface ProfileOption { id: string; name: string; employment_type: string }

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

function parseIntOr(text: string, fallback: number): number {
  const n = Number(text.trim())
  return Number.isFinite(n) ? Math.round(n) : fallback
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
  const [planId, setPlanId] = useState<string>(initialPlans[0]?.id ?? '')

  const [message, setMessage] = useState('')
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }
  const [busy, setBusy] = useState('')
  const runBusy = async (msg: string, fn: () => Promise<void>) => {
    setBusy(msg)
    try {
      await fn()
    } catch (e) {
      flash(e instanceof Error ? e.message : '操作失敗')
    } finally {
      setBusy('')
    }
  }

  const skipSet = useMemo(() => buildSkipSet(holidays, skips), [holidays, skips])
  const today = todayStr()

  const selectedPlan = plans.find(p => p.id === planId) ?? null
  const planTeachers = teachers.filter(t => t.plan_id === planId)
  const slotsOf = (rowId: string) => slots.filter(s => s.teacher_row_id === rowId)
  /** 同一人跨計畫合計每週節數 */
  const weeklyCountOf = (t: OtTeacher) => {
    const ids = new Set(teachers.filter(x => teacherKey(x) === teacherKey(t)).map(x => x.id))
    return slots.filter(s => ids.has(s.teacher_row_id)).length
  }

  /** 計畫期程內總節數（全部教師、扣不上課日） */
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
    const payload = {
      id: planDraft.id || undefined,
      name: planDraft.name.trim(),
      start_date: planDraft.start_date,
      end_date: planDraft.end_date,
      rate: parseIntOr(planDraft.rateText, 0),
      budget: parseIntOr(planDraft.budgetText, 0),
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
        lunch_fee: data.lunch_fee, other_fee: data.other_fee, note: data.note,
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

  const addSlot = async (rowId: string, weekday: number, period: number, class_name: string, domain: string) => {
    await runBusy('新增時段中…', async () => {
      const data = await call('/api/admin/overtime/slots', 'POST', {
        teacher_row_id: rowId, weekday, period, class_name, domain,
      })
      setSlots(list => [...list, {
        id: data.id, teacher_row_id: data.teacher_row_id, weekday: data.weekday,
        period: data.period, class_name: data.class_name, domain: data.domain,
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
    new Set(teachers.filter(filter).map(teacherKey)).size
  const overtimeCount = distinctBy(t => isCappedCategory(t.category))
  const hourlyCount = distinctBy(t => !isCappedCategory(t.category))

  const planSelector = (
    <select className="input max-w-xs" value={planId} onChange={e => setPlanId(e.target.value)}>
      <option value="">— 選擇計畫 —</option>
      {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )

  return (
    <div className="space-y-4">
      {busy && <BusyOverlay text={busy} />}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">超鐘簽到</h1>
        {message && <span className="text-sm text-zinc-600" aria-live="polite">{message}</span>}
      </div>

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
              ['計畫數', String(plans.length)],
              ['超鐘點教師（正式＋代理）', `${overtimeCount} 人`],
              ['鐘點／外師', `${hourlyCount} 人`],
              ['每週減課節數合計', `${slots.length} 節`],
            ] as const).map(([label, value]) => (
              <div key={label} className="card !p-4">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
              </div>
            ))}
          </div>

          {plans.length === 0 && (
            <div className="card text-sm text-zinc-500">
              尚未建立任何計畫。請先到「經費來源」新增計畫經費。
            </div>
          )}

          {plans.map(p => {
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
                    ['總經費', p.budget > 0 ? `${money(p.budget)} 元` : '未設定'],
                    ['總人數', `${people} 人`],
                    ['總節數（期程內）', `${totalSessions} 節`],
                    ['總金額', `${money(totalAmount)} 元`],
                    ['剩餘金額', p.budget > 0 ? `${money(remain)} 元` : '—'],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="border border-zinc-200 rounded p-2">
                      <div className="text-xs text-zinc-500">{label}</div>
                      <div className={`mt-0.5 font-medium ${label === '剩餘金額' && p.budget > 0 && remain < 0 ? 'text-red-600' : 'text-zinc-900'}`}>{value}</div>
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
              <p className="mt-0.5 text-sm text-zinc-500">計畫經費名稱、期程與節薪；總經費供儀表板計算剩餘金額（可留 0）。</p>
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
                  <span className="text-xs text-zinc-500">總經費（元，0＝未設定）</span>
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
                  <th className="py-2 pr-3 text-right">總經費</th>
                  <th className="py-2 pr-3 text-right">清冊人數</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-zinc-400">尚未建立計畫</td></tr>
                )}
                {plans.map(p => (
                  <tr key={p.id} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 text-zinc-900">{p.name}</td>
                    <td className="py-2 pr-3 text-zinc-600 whitespace-nowrap">{p.start_date} ～ {p.end_date}</td>
                    <td className="py-2 pr-3 text-right">{money(p.rate)}</td>
                    <td className="py-2 pr-3 text-right">{p.budget > 0 ? money(p.budget) : '—'}</td>
                    <td className="py-2 pr-3 text-right">{teachers.filter(t => t.plan_id === p.id).length}</td>
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
          {selectedPlan && planTeachers.map(t => {
            const otherIds = new Set(
              teachers.filter(x => x.id !== t.id && teacherKey(x) === teacherKey(t)).map(x => x.id))
            const takenElsewhere = new Set(
              slots.filter(s => otherIds.has(s.teacher_row_id)).map(s => `${s.weekday}-${s.period}`))
            return (
              <TeacherCard
                key={t.id}
                teacher={t}
                slots={slotsOf(t.id)}
                weeklyCount={weeklyCountOf(t)}
                courses={t.teacher_id ? (teacherCourses[t.teacher_id] ?? []) : []}
                takenElsewhere={takenElsewhere}
                onSave={saveTeacher}
                onDelete={() => deleteTeacher(t)}
                onAddSlot={addSlot}
                onDeleteSlot={deleteSlot}
              />
            )
          })}
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
            {([['all', '全部'], ['formal', '正式'], ['substitute', '代理'], ['hourly', '鐘點'], ['foreign', '外師']] as const).map(([key, label]) => (
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

/**
 * 清冊教師卡：代扣款（文字輸入、存檔時解析）＋減課時段。
 * 時段以「該師的實際課務」點選勾選（課表已發布且為系統帳號）；
 * 其他計畫已勾的時段鎖定不可再選。無課務資料（手動人員／課表未發布）才退回手動輸入。
 */
function TeacherCard({
  teacher, slots, weeklyCount, courses, takenElsewhere, onSave, onDelete, onAddSlot, onDeleteSlot,
}: {
  teacher: OtTeacher
  slots: OtSlot[]
  weeklyCount: number
  courses: TeacherCourse[]
  takenElsewhere: Set<string>   // 同一人在其他計畫已勾選的「星期-節次」
  onSave: (id: string, patch: {
    labor_fee: number; health_fee: number; lunch_fee: number; other_fee: number; note: string
  }) => Promise<void>
  onDelete: () => void
  onAddSlot: (rowId: string, weekday: number, period: number, class_name: string, domain: string) => Promise<void>
  onDeleteSlot: (id: string) => void
}) {
  const [laborText, setLaborText] = useState(String(teacher.labor_fee))
  const [healthText, setHealthText] = useState(String(teacher.health_fee))
  const [lunchText, setLunchText] = useState(String(teacher.lunch_fee))
  const [otherText, setOtherText] = useState(String(teacher.other_fee))
  const [note, setNote] = useState(teacher.note)

  const [slotWeekday, setSlotWeekday] = useState(1)
  const [slotPeriod, setSlotPeriod] = useState(1)
  const [slotClass, setSlotClass] = useState('')
  const [slotDomain, setSlotDomain] = useState('')

  const capped = isCappedCategory(teacher.category)
  const dirty = parseIntOr(laborText, 0) !== teacher.labor_fee
    || parseIntOr(healthText, 0) !== teacher.health_fee
    || parseIntOr(lunchText, 0) !== teacher.lunch_fee
    || parseIntOr(otherText, 0) !== teacher.other_fee
    || note !== teacher.note

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-900">{teacher.name}</span>
          <span className="text-xs text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">
            {otCategoryLabel(teacher.category)}
          </span>
          <span className={`text-xs rounded px-1.5 py-0.5 border ${
            capped && weeklyCount > OT_WEEKLY_CAP ? 'border-red-300 text-red-600'
            : capped && weeklyCount === OT_WEEKLY_CAP ? 'border-amber-300 text-amber-700'
            : 'border-zinc-200 text-zinc-500'
          }`}>
            每週 {weeklyCount}{capped ? ` / ${OT_WEEKLY_CAP}` : ''} 節
          </span>
        </div>
        <button className="text-sm text-red-600 hover:text-red-700" onClick={onDelete}>移出清冊</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
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
        <label className="block flex-1 min-w-32">
          <span className="text-xs text-zinc-500">備註</span>
          <input className="input block w-full" value={note} onChange={e => setNote(e.target.value)} />
        </label>
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
          儲存
        </button>
      </div>

      <div className="border-t border-zinc-100 pt-3 space-y-2">
        {courses.length > 0 ? (
          <>
            <div className="text-xs text-zinc-500">
              減課時段：點選課務勾選（再點一次取消）；灰色＝已在其他計畫勾選
              {capped ? `，正式／代理每週上限 ${OT_WEEKLY_CAP} 節` : ''}。
            </div>
            <div className="flex flex-wrap gap-2">
              {courses.map(c => {
                const key = `${c.weekday}-${c.period}`
                const chosen = slots.find(s => s.weekday === c.weekday && s.period === c.period)
                const elsewhere = !chosen && takenElsewhere.has(key)
                const atCap = !chosen && capped && weeklyCount >= OT_WEEKLY_CAP
                const disabled = elsewhere || atCap
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    title={elsewhere ? '已在其他計畫勾選' : atCap ? `已達每週 ${OT_WEEKLY_CAP} 節上限` : undefined}
                    className={`border rounded px-2 py-1 text-sm transition-colors ${
                      chosen
                        ? 'border-zinc-800 bg-zinc-800 text-white'
                        : disabled
                          ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                          : 'border-zinc-300 text-zinc-700 hover:border-zinc-500'
                    }`}
                    onClick={() => {
                      if (chosen) onDeleteSlot(chosen.id)
                      else onAddSlot(teacher.id, c.weekday, c.period, c.class_name, c.domain)
                    }}
                  >
                    週{OT_DAY_ZH[c.weekday]} {OT_PERIOD_ZH[c.period]}　{c.class_name}　{c.domain}
                    {elsewhere && '（他計畫）'}
                  </button>
                )
              })}
            </div>
            {/* 不在課務清單上的既有時段（舊資料或手動加的）仍可移除 */}
            {slots.filter(s => !courses.some(c => c.weekday === s.weekday && c.period === s.period)).map(s => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-2 border border-amber-300 bg-amber-50 rounded px-2 py-1">
                  週{OT_DAY_ZH[s.weekday]} {OT_PERIOD_ZH[s.period]}
                  {s.class_name && `　${s.class_name}`}
                  {s.domain && `　${s.domain}`}
                  <button className="text-zinc-400 hover:text-red-600" onClick={() => onDeleteSlot(s.id)} aria-label="刪除時段">✕</button>
                </span>
                <span className="text-xs text-amber-600">不在課表課務中，請確認</span>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="text-xs text-zinc-500">
              減課時段（{teacher.teacher_id ? '課表尚未發布，暫以手動輸入' : '手動人員無課表，手動輸入'}；星期×節次不可重複）
            </div>
            <div className="flex flex-wrap gap-2">
              {slots.length === 0 && <span className="text-sm text-zinc-400">尚未設定</span>}
              {slots.map(s => (
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
                  await onAddSlot(teacher.id, slotWeekday, slotPeriod, slotClass.trim(), slotDomain.trim())
                  setSlotClass(''); setSlotDomain('')
                }}
              >
                新增時段
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
