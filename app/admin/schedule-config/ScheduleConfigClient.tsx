'use client'

import { useState, useRef, useEffect } from 'react'
import {
  SCHEDULE_DAYS, DAY_LABEL, BANDS, BAND_LABEL, BAND_GRADES,
  classKey, classLabel, type ScheduleConfig, type Band,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import SubjectAssignTab from './SubjectAssignTab'
import RoomTab from './RoomTab'
import LockTab from './LockTab'
import OffTab from './OffTab'
import type { GradeSubject, HomeroomTeacher, NeedsRef, OffTeacher, SubjectTeacher } from './page'

interface Props {
  year: number
  initialConfig: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  homerooms: HomeroomTeacher[]
  subjectTeachers: SubjectTeacher[]
  offTeachers: OffTeacher[]
  needsRefs: NeedsRef[]
}

type TabKey = 'time' | 'homeroom' | 'subject' | 'room' | 'lock' | 'off' | 'weight'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'time', label: '1 年段可排課時間' },
  { key: 'homeroom', label: '2 導師配班' },
  { key: 'subject', label: '3 科任配班' },
  { key: 'room', label: '4 教室設定' },
  { key: 'lock', label: '5 鎖課設定' },
  { key: 'off', label: '6 不排課標記' },
  { key: 'weight', label: '7 權重設定' },
]

export default function ScheduleConfigClient({ year, initialConfig, classCounts, gradeSubjects, homerooms, subjectTeachers, offTeachers, needsRefs }: Props) {
  const [config, setConfig] = useState<ScheduleConfig>(initialConfig)
  const [tab, setTab] = useState<TabKey>('time')
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

  // 排課需求「避開子女就讀年段」：teacherId → 年級列表（配班下拉顯示警告用）
  const avoidMap: Record<string, number[]> = {}
  for (const n of needsRefs) if (n.avoidChildGrades.length) avoidMap[n.teacherId] = n.avoidChildGrades

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">排課設定 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span></h2>
          <p className="text-xs text-zinc-400">設定排課規劃的所有前置條件。修改即自動儲存。</p>
        </div>
        {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
        {saveStatus === 'saved' && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
      </div>

      {/* 分頁列 */}
      <div className="border-b border-zinc-200 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t.key
                ? 'border-zinc-700 text-zinc-800 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 一、年段可排課時間 ── */}
      {tab === 'time' && (
        <section className="space-y-3">
          <p className="text-xs text-zinc-400">點格切換；亮色＝可排課、灰色＝不排（半天/午休/彈性）。</p>
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
      )}

      {/* ── 二、導師配班 ── */}
      {tab === 'homeroom' && (
        <section className="space-y-3">
          <p className="text-xs text-zinc-400">指定每個班級的導師（排課時導師教自己班的配課科目）。</p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {GRADES.map(g => {
              const count = classCounts[g] ?? 0
              const list = homerooms.filter(h => h.grade === g)
              const avoided = list.filter(h => avoidMap[h.id]?.includes(g))
              return (
                <div key={g} className="card p-3 space-y-2">
                  <div className="text-sm font-semibold text-zinc-700">{GRADE_LABEL[g]}
                    <span className="text-xs font-normal text-zinc-400 ml-1">{count} 班 · {list.length} 位導師</span>
                  </div>
                  {avoided.length > 0 && (
                    <p className="text-[11px] text-amber-600">⚠ 排課需求—子女就讀此年段：{avoided.map(h => h.name).join('、')}（選擇時請留意，仍可指派）</p>
                  )}
                  {count === 0
                    ? <p className="text-xs text-zinc-400">尚未於配課設定設定班級數。</p>
                    : Array.from({ length: count }, (_, i) => {
                      const val = config.classTeacher[classKey(g, i)] ?? ''
                      const warned = Boolean(val && avoidMap[val]?.includes(g))
                      return (
                        <label key={i} className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-600 w-14 flex-shrink-0">{classLabel(g, i)}</span>
                          <select value={val} onChange={e => setClassTeacher(g, i, e.target.value)}
                            className={`input py-1 text-sm flex-1 ${warned ? 'border-amber-400 text-amber-700 bg-amber-50' : ''}`}>
                            <option value="">未指定</option>
                            {list.map(h => {
                              const warn = avoidMap[h.id]?.includes(g)
                              return <option key={h.id} value={h.id} style={warn ? { color: '#b45309' } : undefined}>{h.name}{warn ? '（⚠ 子女在此年段）' : ''}</option>
                            })}
                          </select>
                        </label>
                      )
                    })}
                  {count > 0 && list.length !== count && <p className="text-[11px] text-amber-600">導師人數（{list.length}）與班級數（{count}）不一致。</p>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 三、科任配班 ── */}
      {tab === 'subject' && (
        <SubjectAssignTab
          config={config} setConfig={setConfig}
          classCounts={classCounts} gradeSubjects={gradeSubjects}
          subjectTeachers={subjectTeachers} homerooms={homerooms}
          avoidMap={avoidMap}
        />
      )}

      {/* ── 四、教室設定 ── */}
      {tab === 'room' && (
        <RoomTab config={config} setConfig={setConfig} classCounts={classCounts} />
      )}

      {/* ── 五、鎖課設定 ── */}
      {tab === 'lock' && (
        <LockTab config={config} setConfig={setConfig} classCounts={classCounts} gradeSubjects={gradeSubjects} />
      )}

      {/* ── 六、不排課標記 ── */}
      {tab === 'off' && (
        <OffTab config={config} setConfig={setConfig} offTeachers={offTeachers} needsRefs={needsRefs} />
      )}

      {/* ── 七、權重設定（佔位） ── */}
      {tab === 'weight' && (
        <div className="card p-6 space-y-2 text-sm text-zinc-500">
          <div className="font-semibold text-zinc-700">權重設定（規劃中）</div>
          <p className="text-xs text-zinc-400">
            此分頁將於規格討論後實作，預計涵蓋排課的軟性偏好與優先順序，例如：
          </p>
          <ul className="text-xs text-zinc-400 list-disc pl-5 space-y-0.5">
            <li>主科（國數）優先排上午的權重</li>
            <li>同科分散到不同天的強度</li>
            <li>教師連堂／空堂平衡</li>
            <li>各項限制違反時的取捨順序</li>
          </ul>
        </div>
      )}
    </div>
  )
}
