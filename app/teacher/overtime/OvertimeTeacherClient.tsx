'use client'

// 教師端超鐘簽到：自己參與的計畫、每週減課時段、月份節數，下載個人簽到表 PDF。
// 只有個人簽到表（下載列印、簽名後繳紙本給行政人員）；清冊在管理端。
import { useMemo, useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import {
  OT_DAY_ZH, OT_PERIOD_ZH, otCategoryLabel, buildSkipSet, expandSessions, monthRange, money,
  type OtPlan, type OtTeacher, type OtSlot, type OtSkipDate, type OtHoliday,
} from '@/lib/overtime'
import { exportSigninPdf, saveBlob } from '@/lib/overtime-export'

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function OvertimeTeacherClient({
  myRows, plans, slots, skips, holidays,
}: {
  myRows: OtTeacher[]
  plans: OtPlan[]
  slots: OtSlot[]
  skips: OtSkipDate[]
  holidays: OtHoliday[]
}) {
  const [month, setMonth] = useState(currentMonth())
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const skipSet = useMemo(() => buildSkipSet(holidays, skips), [holidays, skips])
  const totalWeekly = slots.length

  const download = async (plan: OtPlan, row: OtTeacher) => {
    const range = monthRange(month)
    if (!range) { flash('月份格式無效'); return }
    const sessions = expandSessions(slots.filter(s => s.teacher_row_id === row.id), plan, range[0], range[1], skipSet, row.ranges)
    setBusy('產生簽到表 PDF…')
    try {
      const blob = await exportSigninPdf(plan, month, [{ teacher: row, sessions }], setBusy)
      saveBlob(blob, `簽到表_${plan.name}_${row.name}_${month}.pdf`)
      flash('簽到表已下載，請列印簽名後繳交紙本')
    } catch (e) {
      flash(e instanceof Error ? e.message : '下載失敗')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      {busy && <BusyOverlay text={busy} />}
      <div className="flex items-center justify-between">
        <h2 className="page-title">超鐘簽到</h2>
        {message && <span className="text-sm text-zinc-600" aria-live="polite">{message}</span>}
      </div>

      {myRows.length === 0 ? (
        <div className="card text-sm text-zinc-500 py-8 text-center">
          目前沒有參與任何超鐘點計畫。若有疑問請洽教務處。
        </div>
      ) : (
        <>
          <div className="card space-y-1 text-sm text-zinc-600">
            <div>
              您目前參與 <span className="font-medium text-zinc-900">{plans.length}</span> 個計畫，
              每週超鐘點合計 <span className="font-medium text-zinc-900">{totalWeekly}</span> 節。
            </div>
            <div className="text-xs text-zinc-400">
              下載該月個人簽到表 PDF，列印簽名後繳交紙本給行政人員；國定假日與特殊不上課日已自動跳過。
            </div>
            <label className="inline-flex items-center gap-2 pt-2">
              <span className="text-xs text-zinc-500">簽到表月份</span>
              <input type="month" className="input !w-auto" value={month} onChange={e => setMonth(e.target.value)} />
            </label>
          </div>

          {plans.map(plan => {
            const row = myRows.find(r => r.plan_id === plan.id)
            if (!row) return null
            const mySlots = slots.filter(s => s.teacher_row_id === row.id)
            const range = monthRange(month)
            const monthSessions = range
              ? expandSessions(mySlots, plan, range[0], range[1], skipSet, row.ranges)
              : []
            const monthPay = monthSessions.length * plan.rate
            return (
              <div key={plan.id} className="card space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-zinc-900">{plan.name}</h3>
                    <span className="text-xs text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">
                      {otCategoryLabel(row.category)}
                    </span>
                  </div>
                  <button className="btn-primary" onClick={() => download(plan, row)}>
                    ⬇ {Number(month.slice(5, 7))}月個人簽到表 PDF
                  </button>
                </div>
                <div className="text-sm text-zinc-500">
                  期程 {plan.start_date} ～ {plan.end_date}｜節薪 {money(plan.rate)} 元
                </div>
                {row.ranges.length > 0 && (
                  <div className="text-sm text-zinc-500">
                    超鐘點區間：{row.ranges.map(r => `${r.start} ～ ${r.end}`).join('、')}
                  </div>
                )}
                <div>
                  <div className="text-xs text-zinc-500 mb-1">每週減課時段（{mySlots.length} 節）</div>
                  <div className="flex flex-wrap gap-2">
                    {mySlots.length === 0 && <span className="text-sm text-zinc-400">尚未設定，請洽行政人員</span>}
                    {mySlots.map(s => (
                      <span key={s.id} className="border border-zinc-300 rounded px-2 py-1 text-sm">
                        週{OT_DAY_ZH[s.weekday]} {OT_PERIOD_ZH[s.period]}
                        {s.class_name && `　${s.class_name}`}
                        {s.domain && `　${s.domain}`}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-sm text-zinc-600">
                  {Number(month.slice(0, 4))} 年 {Number(month.slice(5, 7))} 月：
                  <span className="font-medium text-zinc-900">{monthSessions.length}</span> 節、
                  鐘點費 <span className="font-medium text-zinc-900">{money(monthPay)}</span> 元（未扣代扣款）
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
