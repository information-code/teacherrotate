'use client'

import { useState, useRef, useEffect } from 'react'
import {
  SCHEDULE_DAYS, DAY_LABEL, BANDS, BAND_LABEL, BAND_GRADES,
  classKey, classLabel, type ScheduleConfig, type Band,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import type { HomeroomTeacher } from './page'

interface Props {
  year: number
  initialConfig: ScheduleConfig
  classCounts: Record<number, number>
  homerooms: HomeroomTeacher[]
}

export default function ScheduleConfigClient({ year, initialConfig, classCounts, homerooms }: Props) {
  const [config, setConfig] = useState<ScheduleConfig>(initialConfig)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  // 自動儲存（debounce）
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setSaveStatus('saving')
    const t = setTimeout(async () => {
      try {
        await fetch('/api/admin/schedule-config', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, config }),
        })
        setSaveStatus('saved')
      } catch { setSaveStatus('idle') }
    }, 600)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  function toggleCell(band: Band, day: number, period: number) {
    setConfig(c => {
      const k = `${day}-${period}`
      const grid = c.bands[band]
      return { ...c, bands: { ...c.bands, [band]: { ...grid, teachable: { ...grid.teachable, [k]: !grid.teachable[k] } } } }
    })
  }
  function setClassTeacher(grade: number, index: number, teacherId: string) {
    setConfig(c => ({ ...c, classTeacher: { ...c.classTeacher, [classKey(grade, index)]: teacherId } }))
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">排課設定 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span></h2>
          <p className="text-xs text-zinc-400">設定各年段可排課時段與導師配班，作為排課規劃的依據。修改即自動儲存。</p>
        </div>
        {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
        {saveStatus === 'saved' && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
      </div>

      {/* ── 一、年段可排課時段 ── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700">一、年段可排課時段 <span className="text-xs font-normal text-zinc-400 ml-1">點格切換；亮色＝可排課、灰色＝不排（半天/午休/彈性）</span></h3>
        <div className="grid gap-4 md:grid-cols-3">
          {BANDS.map(band => {
            const grid = config.bands[band]
            const periods = Array.from({ length: grid.periodsPerDay }, (_, i) => i + 1)
            return (
              <div key={band} className="card p-3 space-y-2">
                <div className="text-sm font-semibold text-zinc-700">{BAND_LABEL[band]}
                  <span className="text-xs font-normal text-zinc-400 ml-1">{BAND_GRADES[band].map(g => GRADE_LABEL[g]).join('、')}</span>
                </div>
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className="w-8 text-zinc-400 font-normal"></th>
                      {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map(p => (
                      <tr key={p}>
                        <td className="text-zinc-400 text-center">{p}</td>
                        {SCHEDULE_DAYS.map(d => {
                          const on = grid.teachable[`${d}-${p}`]
                          return (
                            <td key={d} className="p-0.5">
                              <button onClick={() => toggleCell(band, d, p)}
                                className={`w-full h-6 rounded-sm border text-[10px] ${on ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-zinc-50 text-zinc-300 border-zinc-200'}`}>
                                {on ? '✓' : ''}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="text-zinc-400 text-center text-[10px]">計</td>
                      {SCHEDULE_DAYS.map(d => {
                        const cnt = periods.filter(p => grid.teachable[`${d}-${p}`]).length
                        return <td key={d} className="text-center text-zinc-500 pt-1">{cnt}</td>
                      })}
                    </tr>
                  </tfoot>
                </table>
                <div className="text-[11px] text-zinc-400 text-right">每週可排 {periods.reduce((s, p) => s + SCHEDULE_DAYS.filter(d => grid.teachable[`${d}-${p}`]).length, 0)} 節</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 二、導師配班 ── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700">二、導師配班 <span className="text-xs font-normal text-zinc-400 ml-1">指定每個班級的導師（排課時導師教自己班的配課科目）</span></h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {GRADES.map(g => {
            const count = classCounts[g] ?? 0
            const list = homerooms.filter(h => h.grade === g)
            return (
              <div key={g} className="card p-3 space-y-2">
                <div className="text-sm font-semibold text-zinc-700">{GRADE_LABEL[g]}
                  <span className="text-xs font-normal text-zinc-400 ml-1">{count} 班 · {list.length} 位導師</span>
                </div>
                {count === 0
                  ? <p className="text-xs text-zinc-400">尚未於配課設定設定班級數。</p>
                  : Array.from({ length: count }, (_, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-600 w-14 flex-shrink-0">{classLabel(g, i)}</span>
                      <select value={config.classTeacher[classKey(g, i)] ?? ''} onChange={e => setClassTeacher(g, i, e.target.value)} className="input py-1 text-sm flex-1">
                        <option value="">未指定</option>
                        {list.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                      </select>
                    </label>
                  ))}
                {count > 0 && list.length !== count && <p className="text-[11px] text-amber-600">導師人數（{list.length}）與班級數（{count}）不一致。</p>}
              </div>
            )
          })}
        </div>
      </section>

      <p className="text-xs text-zinc-400">特殊占用（本土語固定時段、學年共同不排課、種子班封鎖、教師排課需求）將於下一階段加入；目前可先預覽時段與配班。</p>
    </div>
  )
}
