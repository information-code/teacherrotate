'use client'

import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { DAY_LABEL, parseSlotKey, deriveNativeSessions, type ScheduleConfig } from '@/lib/scheduling'
import { GRADE_LABEL } from '@/lib/allocation'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  extraCourses: { lang: string; grade: number; hours: number }[]                 // 語別課（配課設定「設定二」）
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>        // 各師語別配課節數
  teacherNames: Record<string, string>
}

/** 分頁六：本土語場次。本土語鎖課格＝該班上閩南語的時間；語別課（手語／新住民語／原住民族語／客語）＝學生在那一節出來集合上課，
 *  場次由「該年級本土語鎖課時段 × 語別課」自動推導，每個時段都是候選場次，課務組定狀態。 */
export default function NativeTab({ config, setConfig, extraCourses, hoursByTeacher, teacherNames }: Props) {
  const derived = useMemo(() => deriveNativeSessions({ config, extraCourses, hoursByTeacher }), [config, extraCourses, hoursByTeacher])
  const grades = Array.from(new Set(derived.sessions.map(s => s.grade))).sort()
  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        本土語鎖課格（5 鎖課設定）＝該班上閩南語的時間；閩南語老師由科任配班指派、在原班上。
        其他語別的學生在那一節出來、集合到本土語言教室上課——場次由「該年級本土語鎖課時段 × 語別課（配課設定「設定二」）」自動推導。
        每個時段點狀態：<b>實體</b>＝老師到校（耗 1 節配課）、<b>直播</b>＝共學不具名（不耗）、<b>不開</b>＝該時段沒有這個語別的學生（不耗）。
        檢核＝實體場次數要等於該語別老師的配課節數。
      </p>
      {grades.length === 0 && (
        <div className="card text-sm text-zinc-400 text-center py-6">尚無場次——請先於「5 鎖課設定」鎖本土語時段，並於配課設定「設定二」建立語別課。</div>
      )}
      <NativeSessionsPanel config={config} setConfig={setConfig} extraCourses={extraCourses} hoursByTeacher={hoursByTeacher} teacherNames={teacherNames} />
    </div>
  )
}

/** 本土語場次面板：每個本土語時段都是候選場次，課務組點狀態——實體（老師到校，耗 1 節配課）／直播（共學不具名）／不開（此時段沒有該語別學生）。
 *  一致性：實體場次數 ＝ 該語別老師配課節數；不等就黃字。存於 config.nativeLang.states（實體＝不存）。 */
function NativeSessionsPanel({ config, setConfig, extraCourses, hoursByTeacher, teacherNames }: {
  config: ScheduleConfig; setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  extraCourses: { lang: string; grade: number; hours: number }[]
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>
  teacherNames: Record<string, string>
}) {
  const derived = useMemo(() => deriveNativeSessions({ config, extraCourses, hoursByTeacher }), [config, extraCourses, hoursByTeacher])
  const roomNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const z of config.roomZones) for (const r of z.rooms) if (r.kind === 'native') m[r.id] = (r.name || '本土語言教室') + r.no
    return m
  }, [config])
  const slotZh = (sl: string) => { const { day, period } = parseSlotKey(sl); return `${DAY_LABEL[day]}第${period}節` }
  const byGrade = new Map<number, Map<string, typeof derived.sessions>>()
  for (const s of derived.sessions) {
    const g = byGrade.get(s.grade) ?? new Map<string, typeof derived.sessions>()
    const arr = g.get(s.lang) ?? []
    arr.push(s); g.set(s.lang, arr); byGrade.set(s.grade, g)
  }
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
  const slotCount = (g: number) => {
    const cnt: Record<string, number> = {}
    for (const [ck2, cells] of Object.entries(config.lockCells)) {
      if (Number(ck2.split('-')[0]) !== g) continue
      for (const [sl, tid] of Object.entries(cells)) if (nativeTypeIds.has(tid)) cnt[sl] = (cnt[sl] ?? 0) + 1
    }
    return cnt
  }
  const hoursOf = (lang: string, g: number) => Object.values(hoursByTeacher).reduce((s2, m) => s2 + (Number(m[lang]?.[String(g)]) || 0), 0)
  function setState(key: string, st: 'physical' | 'stream' | 'cancelled') {
    setConfig(c => {
      const states = { ...c.nativeLang.states }
      if (st === 'physical') delete states[key]; else states[key] = st
      return { ...c, nativeLang: { states } }
    })
  }
  const grades = Array.from(byGrade.keys()).sort()
  if (grades.length === 0) return null
  return (
    <div className="card p-0 overflow-hidden">
      <div className="p-3 space-y-3">
        {grades.map(g => {
          const langs = byGrade.get(g)!
          const cnt = slotCount(g)
          const slots = Array.from(new Set(Array.from(langs.values()).flat().map(s => s.slot)))
            .sort((a, b) => { const A = parseSlotKey(a), B = parseSlotKey(b); return A.day - B.day || A.period - B.period })
          return (
            <div key={g}>
              <div className="text-xs font-semibold text-zinc-700 mb-1">{GRADE_LABEL[g]}
                <span className="ml-2 font-normal text-zinc-400">本土語鎖課時段：{slots.map(sl => `${slotZh(sl)}×${cnt[sl] ?? 0}班`).join('、') || '尚未鎖課'}</span>
              </div>
              <table className="table-base no-hover">
                <thead><tr><th className="min-w-[8rem]">語別</th><th className="w-20 text-center">配課</th>{slots.map(sl => <th key={sl} className="text-center">{slotZh(sl)}</th>)}<th className="w-24 text-center">檢核</th></tr></thead>
                <tbody>
                  {Array.from(langs.entries()).map(([lang, list]) => {
                    const hours = hoursOf(lang, g)
                    const physical = list.filter(s => s.state === 'physical').length
                    const ok = physical === hours
                    return (
                      <tr key={lang}>
                        <td className="font-medium text-zinc-800">{lang}</td>
                        <td className="text-center text-zinc-600">{hours} 節</td>
                        {slots.map(sl => {
                          const s = list.find(x => x.slot === sl)
                          if (!s) return <td key={sl} className="text-center text-zinc-300">—</td>
                          const key = `${sl}|${lang}|${g}`
                          const cls = s.state === 'physical' ? 'bg-emerald-600 text-white border-emerald-600' : s.state === 'stream' ? 'bg-sky-600 text-white border-sky-600' : 'bg-zinc-100 text-zinc-500 border-zinc-300'
                          const next = s.state === 'physical' ? 'stream' : s.state === 'stream' ? 'cancelled' : 'physical'
                          const sub = s.state === 'physical'
                            ? (s.teacherId ? (teacherNames[s.teacherId] ?? '？') : '未配課') + (s.roomId ? `・${roomNames[s.roomId]}` : '・教室不足')
                            : s.state === 'stream' ? '共學' : ''
                          const bad = s.state === 'physical' && (!s.teacherId || !s.roomId)
                          return (
                            <td key={sl} className="text-center">
                              <button onClick={() => setState(key, next)} title="點擊切換：實體 → 直播 → 不開"
                                className={`text-xs px-2 py-0.5 rounded-sm border ${cls}`}>{s.state === 'physical' ? '實體' : s.state === 'stream' ? '直播' : '不開'}</button>
                              {sub && <div className={`text-[10px] mt-0.5 ${bad ? 'text-red-500' : 'text-zinc-400'}`}>{sub}</div>}
                            </td>
                          )
                        })}
                        <td className={`text-center text-xs ${ok ? 'text-emerald-700' : 'text-amber-600'}`}>{ok ? '✓' : `實體 ${physical}／配 ${hours}`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}
