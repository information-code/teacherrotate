'use client'

// 教師端超鐘簽到：自己參與的計畫、每週減課時段、各月節數，下載個人簽到表 PDF。
// 只有個人簽到表（下載列印、簽名後繳紙本給行政人員）；清冊在管理端。
// 每張計畫卡只列「有超鐘節次」的月份按鈕，點了直接下載該月；「全部下載」合併成一份 PDF（一月一頁）。
import { Fragment, useMemo, useState } from 'react'
import { BusyOverlay } from '@/components/ui/BusyOverlay'
import { monthsBetween } from '@/components/ui/MonthPicker'
import { cn } from '@/lib/utils'
import {
  OT_DAY_ZH, OT_PERIOD_ZH, otCategoryLabel, buildSkipSet, expandSessions, monthRange, money,
  type OtPlan, type OtTeacher, type OtSlot, type OtSkipDate, type OtHoliday, type OtSessionRow,
} from '@/lib/overtime'
import { exportSigninPdf, saveBlob } from '@/lib/overtime-export'

interface MonthStat { month: string; sessions: OtSessionRow[] }

/** 每週時段整理成文字：同星期、同班、同領域、同區段的節次合併成一行（週二 第六、七節） */
function slotLines(slots: OtSlot[]) {
  const map = new Map<string, { slot: OtSlot; periods: number[] }>()
  for (const s of slots) {
    const key = [s.weekday, s.class_name, s.domain, s.start_date ?? '', s.end_date ?? ''].join('|')
    const g = map.get(key)
    if (g) g.periods.push(s.period)
    else map.set(key, { slot: s, periods: [s.period] })
  }
  return Array.from(map, ([key, g]) => ({ key, slot: g.slot, periods: g.periods.sort((a, b) => a - b) }))
}

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
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const skipSet = useMemo(() => buildSkipSet(holidays, skips), [holidays, skips])
  const totalWeekly = slots.length
  const thisMonth = currentMonth()

  /** 下載簽到表：一個月一頁，多個月合併成一份 PDF */
  const download = async (plan: OtPlan, row: OtTeacher, stats: MonthStat[]) => {
    if (stats.length === 0) return
    setBusy('產生簽到表 PDF…')
    try {
      const sheets = stats.map(x => ({ teacher: row, sessions: x.sessions, month: x.month }))
      const blob = await exportSigninPdf(plan, stats[0].month, sheets, setBusy)
      const label = stats.length === 1 ? stats[0].month : '全部月份'
      saveBlob(blob, `簽到表_${plan.name}_${row.name}_${label}.pdf`)
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
              點計畫卡上的月份即可下載該月個人簽到表 PDF，列印簽名後繳交紙本給行政人員；國定假日與特殊不上課日已自動跳過。
            </div>
          </div>

          {plans.map(plan => {
            const row = myRows.find(r => r.plan_id === plan.id)
            if (!row) return null
            const mySlots = slots.filter(s => s.teacher_row_id === row.id)
            // 只留有超鐘節次的月份
            const monthStats: MonthStat[] = monthsBetween(plan.start_date, plan.end_date)
              .map(month => {
                const range = monthRange(month)
                return { month, sessions: range ? expandSessions(mySlots, plan, range[0], range[1], skipSet) : [] }
              })
              .filter(x => x.sessions.length > 0)
            const totalSessions = monthStats.reduce((n, x) => n + x.sessions.length, 0)
            return (
              <div key={plan.id} className="card space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-zinc-900">{plan.name}</h3>
                  <span className="text-xs text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">
                    {otCategoryLabel(row.category)}
                  </span>
                </div>
                <div className="text-sm text-zinc-500">
                  期程 {plan.start_date} ～ {plan.end_date}｜節薪 {money(plan.rate)} 元
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">每週減課時段（{mySlots.length} 節）</div>
                  {/* 純文字（不加框）：這裡只是顯示，避免看起來像按鈕 */}
                  {mySlots.length === 0 ? (
                    <span className="text-sm text-zinc-400">尚未設定，請洽行政人員</span>
                  ) : (
                    <ul className="space-y-0.5 text-sm text-zinc-700">
                      {slotLines(mySlots).map(({ key, slot: s, periods }) => (
                        <li key={key}>
                          週{OT_DAY_ZH[s.weekday]} 第{periods.map(p => OT_PERIOD_ZH[p].slice(1, -1)).join('、')}節
                          {s.class_name && `　${s.class_name}`}
                          {s.domain && `　${s.domain}`}
                          {s.start_date && (
                            <span className="text-xs text-zinc-400">
                              （{s.start_date.slice(5)}～{(s.end_date ?? '').slice(5)}）
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="border-t border-zinc-100 pt-3 space-y-2">
                  <div className="text-xs text-zinc-500">下載簽到表 PDF（點月份下載該月）</div>
                  {monthStats.length === 0 ? (
                    <span className="text-sm text-zinc-400">尚無超鐘節次</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {monthStats.map((x, i) => {
                        const y = Number(x.month.slice(0, 4))
                        const m = Number(x.month.slice(5, 7))
                        return (
                          <Fragment key={x.month}>
                            {/* 跨年時在每年第一個月前標年份 */}
                            {(i === 0 || x.month.slice(0, 4) !== monthStats[i - 1].month.slice(0, 4)) && (
                              <span className={cn('text-xs text-zinc-400', i > 0 && 'ml-1')}>{y}</span>
                            )}
                            <button
                              type="button"
                              className={cn(
                                'rounded border px-2.5 py-1 text-sm transition-colors hover:bg-zinc-50',
                                x.month === thisMonth
                                  ? 'border-zinc-800 font-medium text-zinc-900'
                                  : 'border-zinc-300 text-zinc-700 hover:border-zinc-500',
                              )}
                              title={`${y} 年 ${m} 月：${x.sessions.length} 節、鐘點費 ${money(x.sessions.length * plan.rate)} 元（未扣代扣款）`}
                              onClick={() => download(plan, row, [x])}
                            >
                              {m}月<span className="ml-1 text-xs text-zinc-400">{x.sessions.length}節</span>
                            </button>
                          </Fragment>
                        )
                      })}
                      <button
                        type="button"
                        className="btn-primary ml-1"
                        onClick={() => download(plan, row, monthStats)}
                      >
                        ⬇ 全部下載
                      </button>
                    </div>
                  )}
                  {monthStats.length > 0 && (
                    <div className="text-sm text-zinc-600">
                      期程合計 <span className="font-medium text-zinc-900">{totalSessions}</span> 節、
                      鐘點費 <span className="font-medium text-zinc-900">{money(totalSessions * plan.rate)}</span> 元（未扣代扣款）
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
