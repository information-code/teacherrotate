'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import {
  SCHEDULE_DAYS, DAY_LABEL, BANDS, BAND_LABEL, BAND_GRADES,
  classKey, classLabel, parseSlotKey, homeroomLockSlots, type ScheduleConfig, type Band,
} from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'
import SubjectAssignTab from './SubjectAssignTab'
import ForeignTab from './ForeignTab'
import RoomTab from './RoomTab'
import LockTab from './LockTab'
import NativeTab from './NativeTab'
import OffTab from './OffTab'
import WeightTab from './WeightTab'
import type { GradeSubject, HomeroomTeacher, NeedsRef, OffTeacher, SubjectTeacher } from './page'

interface Props {
  year: number
  initialTab?: string
  initialConfig: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  homerooms: HomeroomTeacher[]
  homeroomSupply: Record<number, Record<string, number>>   // 導師自上供給（年級→科目→節數）
  homeroomBreakdown: Record<string, Record<string, number>> // 各導師自上節數（teacherId→科目→節數）
  subjectTeachers: SubjectTeacher[]
  offTeachers: OffTeacher[]
  needsRefs: NeedsRef[]
  allNames: Record<string, string>   // 全教師名單（含已不具身分者）：顯示殘留指派用
  foreignProfiles: { id: string; name: string }[]   // 聘任別＝外師的帳號
  extraCourses: { lang: string; grade: number; hours: number }[]                     // 語別課（本土語場次推導）
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>            // 各師語別配課節數
}

type TabKey = 'time' | 'homeroom' | 'subject' | 'room' | 'lock' | 'native' | 'off' | 'weight' | 'foreign'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'time', label: '1 年段可排課時間' },
  { key: 'homeroom', label: '2 導師配班' },
  { key: 'subject', label: '3 科任配班' },
  { key: 'room', label: '4 教室設定' },
  { key: 'lock', label: '5 鎖課設定' },
  { key: 'native', label: '6 本土語場次' },
  { key: 'off', label: '7 排課/不排課標記' },
  { key: 'foreign', label: '8 外師設定' },
  { key: 'weight', label: '9 權重設定' },
]

export default function ScheduleConfigClient({ year, initialTab, initialConfig, classCounts, gradeSubjects, homerooms, homeroomSupply, homeroomBreakdown, subjectTeachers, offTeachers, needsRefs, allNames, foreignProfiles, extraCourses, hoursByTeacher }: Props) {
  const [config, setConfig] = useState<ScheduleConfig>(initialConfig)
  const [tab, setTab] = useState<TabKey>(TABS.some(t => t.key === initialTab) ? initialTab as TabKey : 'time')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // 自動儲存（debounce）
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setSaveStatus('saving')
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/schedule-config', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, config }),
        })
        setSaveStatus(res.ok ? 'saved' : 'error')
      } catch { setSaveStatus('error') }
    }, 600)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  // 儲存未完成（或失敗）時，離開頁面要確認，避免變更遺失
  useUnsavedGuard(saveStatus === 'saving' || saveStatus === 'error')

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

  // 導師「自己要上」的鎖課（種子班國數班會等；本土語那種不是她上的不算）落在她本人的不排課時段
  const hrLockOff = useMemo(() => {
    const offOf: Record<string, Set<string>> = {}
    for (const o of config.personalOff) {
      if (o.mode !== 'off' || !o.teacherId) continue
      const set = offOf[o.teacherId] ??= new Set<string>()
      for (const sl of o.slots) set.add(sl)
    }
    const out: string[] = []
    for (const [ck, tid] of Object.entries(config.classTeacher)) {
      const off = tid ? offOf[tid] : undefined
      if (!off) continue
      const [g, i] = ck.split('-').map(Number)
      for (const sl of homeroomLockSlots(config, g, i, homeroomBreakdown[tid])) {
        if (!off.has(sl)) continue
        const t = config.lockTypes.find(x => x.id === config.lockCells[ck]?.[sl])
        const { day, period } = parseSlotKey(sl)
        out.push(`${classLabel(g, i)}（${allNames[tid] ?? ''}） ${DAY_LABEL[day]}第 ${period} 節 ${t?.subject || t?.label || '鎖課'}`)
      }
    }
    return out
  }, [config, homeroomBreakdown, allNames])

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">排課設定 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span></h2>
          <p className="text-xs text-zinc-400">設定排課規劃的所有前置條件。修改即自動儲存。</p>
        </div>
        {saveStatus === 'saving' && <span className="text-xs text-zinc-500">儲存中…</span>}
        {saveStatus === 'saved' && <span className="text-xs text-green-600">✓ 已自動儲存</span>}
        {saveStatus === 'error' && <span className="text-xs text-red-600">⚠ 儲存失敗，請檢查網路（變更尚未寫入，請勿離開）</span>}
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
          <p className="text-xs text-zinc-400">指定每個班級的導師（排課時導師教自己班的配課科目）。已被選走的導師不會再出現在其他班的下拉。</p>
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
                  {list.some(h => h.gradeGuessed) && (
                    <p className="text-[11px] text-amber-600">⚠ 年級未填、依職稱暫列此年段：{list.filter(h => h.gradeGuessed).map(h => h.name).join('、')}（請至工作紀錄補年級）</p>
                  )}
                  {count === 0
                    ? <p className="text-xs text-zinc-400">尚未於配課設定設定班級數。</p>
                    : Array.from({ length: count }, (_, i) => {
                      const val = config.classTeacher[classKey(g, i)] ?? ''
                      const warned = Boolean(val && avoidMap[val]?.includes(g))
                      // 殘留指派：存的值已不在此年段導師名單（如異動為育嬰留停）→ 如實顯示並標紅，避免看起來像未指定
                      const stale = Boolean(val && !list.some(h => h.id === val))
                      // 已被其他班選走的導師不再出現在下拉
                      const usedElsewhere = new Set(
                        Array.from({ length: count }, (_, j) => j)
                          .filter(j => j !== i)
                          .map(j => config.classTeacher[classKey(g, j)] ?? '')
                          .filter(Boolean),
                      )
                      return (
                        <label key={i} className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-600 w-14 flex-shrink-0">{classLabel(g, i)}</span>
                          <select value={val} onChange={e => setClassTeacher(g, i, e.target.value)}
                            className={`input py-1 text-sm flex-1 ${stale ? 'border-red-400 text-red-700 bg-red-50' : warned ? 'border-amber-400 text-amber-700 bg-amber-50' : ''}`}>
                            <option value="">未指定</option>
                            {stale && <option value={val}>⚠ {allNames[val] ?? '未知帳號'}（已不具此年段導師身分，請改選）</option>}
                            {list.filter(h => h.id === val || !usedElsewhere.has(h.id)).map(h => {
                              const warn = avoidMap[h.id]?.includes(g)
                              return <option key={h.id} value={h.id} style={warn || h.gradeGuessed ? { color: '#b45309' } : undefined}>{h.name}{warn ? '（⚠ 子女在此年段）' : ''}{h.gradeGuessed ? '（⚠ 年級未填）' : ''}</option>
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
          subjectTeachers={subjectTeachers} homerooms={homerooms} homeroomSupply={homeroomSupply} homeroomBreakdown={homeroomBreakdown}
          avoidMap={avoidMap} allNames={allNames} year={year}
        />
      )}

      {/* ── 四、教室設定 ── */}
      {tab === 'room' && (
        <RoomTab config={config} setConfig={setConfig} classCounts={classCounts} gradeSubjects={gradeSubjects} subjectTeachers={subjectTeachers} />
      )}

      {/* 鎖課與不排課互相打架時，在這兩頁就先講——不用等到排課精靈才發現 */}
      {(tab === 'lock' || tab === 'off') && hrLockOff.length > 0 && (
        <div className="card border-amber-300 bg-amber-50 p-3 space-y-1">
          <div className="text-sm font-semibold text-amber-800">⚠ 導師自己要上的鎖課，排在她本人的不排課時段</div>
          <p className="text-xs text-amber-700">
            鎖課把課釘死在那一節，不排課又說那一節不能上，兩者互相牴觸——排課引擎兩邊都動不了，
            只能請您擇一調整：把鎖課改到別節（
            <button onClick={() => setTab('lock')} className="underline underline-offset-2">5 鎖課設定</button>
            ），或取消該格的個人不排課（
            <button onClick={() => setTab('off')} className="underline underline-offset-2">7 排課/不排課標記</button>
            ）。
          </p>
          <ul className="text-xs text-amber-800 list-disc pl-5">
            {hrLockOff.map(x => <li key={x}>{x}</li>)}
          </ul>
        </div>
      )}

      {/* ── 五、鎖課設定 ── */}
      {tab === 'lock' && (
        <LockTab config={config} setConfig={setConfig} classCounts={classCounts} gradeSubjects={gradeSubjects}  year={year}/>
      )}

      {/* ── 六、本土語場次 ── */}
      {tab === 'native' && (
        <NativeTab config={config} setConfig={setConfig} extraCourses={extraCourses} hoursByTeacher={hoursByTeacher} teacherNames={allNames} />
      )}

      {/* ── 七、排課/不排課標記 ── */}
      {tab === 'off' && (
        <OffTab config={config} setConfig={setConfig} offTeachers={offTeachers} needsRefs={needsRefs} />
      )}

      {/* ── 八、外師設定（協同英語）── */}
      {tab === 'foreign' && (
        <ForeignTab config={config} setConfig={setConfig} classCounts={classCounts} gradeSubjects={gradeSubjects} foreignProfiles={foreignProfiles} />
      )}

      {/* ── 九、權重設定 ── */}
      {tab === 'weight' && (
        <WeightTab config={config} setConfig={setConfig} gradeSubjects={gradeSubjects} />
      )}
    </div>
  )
}
