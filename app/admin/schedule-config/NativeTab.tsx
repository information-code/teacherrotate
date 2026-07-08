'use client'

import { useMemo, type Dispatch, type SetStateAction } from 'react'
import {
  NATIVE_LANGS, HOMEROOM_SELF, parseSlotKey, roomLabel, classLabel,
  type ScheduleConfig, type NativeSession,
} from '@/lib/scheduling'
import type { OffTeacher, SubjectTeacher } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  subjectTeachers: SubjectTeacher[]
  offTeachers: OffTeacher[]
}

const DAY_ZH = ['', '一', '二', '三', '四', '五']
const slotZh = (s: string) => { const { day, period } = parseSlotKey(s); return `週${DAY_ZH[day]}第${period}節` }

/** 分頁六：本土語設定。
 *  上：老師語別（每人一個；自動列出配到本土語的老師）。
 *  下：本土語開課表——列＝本土語鎖課時段（來源：鎖課設定的本土語名目）、欄＝本土語言教室；
 *      每格 關閉（預設）→ 實體（必填授課老師）→ 共學（直播、不具名）。
 *  閩南語走科任配班（有指派＝實體顯示老師、未指派＝該班直播共學），不在此開課表。 */
export default function NativeTab({ config, setConfig, subjectTeachers, offTeachers }: Props) {
  const nameOf = (id: string) => offTeachers.find(t => t.id === id)?.name ?? subjectTeachers.find(t => t.id === id)?.name ?? '？'

  // 配到本土語的老師（科任配班的本土語指派 ∪ 配課有本土語節數者 ∪ 已設過語別者）
  const nativeTeacherIds = useMemo(() => {
    const set = new Set<string>()
    for (const [k, v] of Object.entries(config.subjectClassTeacher)) {
      if (k.endsWith('|本土語') && v && v !== HOMEROOM_SELF) set.add(v)
    }
    for (const t of subjectTeachers) {
      if (Object.values(t.hours['本土語'] ?? {}).some(n => Number(n) > 0)) set.add(t.id)
    }
    for (const id of Object.keys(config.nativeLang.teacherLang)) set.add(id)
    return Array.from(set).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'zh-Hant'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.subjectClassTeacher, config.nativeLang.teacherLang, subjectTeachers, offTeachers])

  // 本土語鎖課時段（全校聯集）＋各時段被鎖的班級
  const nativeSlots = useMemo(() => {
    const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
    const bySlot = new Map<string, string[]>()
    for (const [ck, cells] of Object.entries(config.lockCells)) {
      for (const [slot, tid] of Object.entries(cells)) {
        if (!nativeTypeIds.has(tid)) continue
        const [g, i] = ck.split('-').map(Number)
        bySlot.set(slot, [...(bySlot.get(slot) ?? []), classLabel(g, i)])
      }
    }
    return Array.from(bySlot.entries())
      .sort((a, b) => { const A = parseSlotKey(a[0]), B = parseSlotKey(b[0]); return A.day - B.day || A.period - B.period })
  }, [config.lockCells, config.lockTypes])

  // 本土語言教室
  const nativeRooms = useMemo(() => {
    const out: { id: string; label: string; langs: string[] }[] = []
    for (const z of config.roomZones) for (const r of z.rooms) {
      if (r.kind === 'native') out.push({ id: r.id, label: (r.name || '本土語言教室') + r.no, langs: r.langs })
    }
    return out
  }, [config.roomZones])

  function setTeacherLang(id: string, lang: string) {
    setConfig(c => {
      const teacherLang = { ...c.nativeLang.teacherLang }
      if (lang) teacherLang[id] = lang; else delete teacherLang[id]
      return { ...c, nativeLang: { ...c.nativeLang, teacherLang } }
    })
  }
  function setSession(key: string, next: NativeSession | null) {
    setConfig(c => {
      const sessions = { ...c.nativeLang.sessions }
      if (next) sessions[key] = next; else delete sessions[key]
      return { ...c, nativeLang: { ...c.nativeLang, sessions } }
    })
  }

  /** 該語別可指派的老師（設定為此語別者）。 */
  const teachersOfLang = (lang: string) =>
    Object.entries(config.nativeLang.teacherLang).filter(([, l]) => l === lang).map(([id]) => id)

  return (
    <div className="space-y-4 max-w-5xl">
      <p className="text-xs text-zinc-400">
        閩南語走科任配班：有指派老師的班＝實體（班級課表顯示老師名）、未指派＝該班直播共學。
        其他語別在下方開課表指定「哪個本土語時段、哪間教室、開哪個語別」；老師臨時異動時在此切換實體／共學或關閉。
      </p>

      {/* 一、老師語別 */}
      <div className="card p-3 space-y-2">
        <div className="text-sm font-semibold text-zinc-700">一、老師語別
          <span className="text-xs font-normal text-zinc-400 ml-2">每位老師一個語別；名單自動列出配到本土語的老師</span>
        </div>
        {nativeTeacherIds.length === 0 && <p className="text-xs text-zinc-400">尚無配到本土語的老師（請先於科任配班或配課統計設定）。</p>}
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {nativeTeacherIds.map(id => {
            const lang = config.nativeLang.teacherLang[id] ?? ''
            return (
              <label key={id} className={`flex items-center gap-2 text-sm rounded-sm border px-2 py-1 ${lang ? 'border-zinc-200' : 'border-amber-300 bg-amber-50'}`}>
                <span className="flex-1 min-w-0 truncate text-zinc-700">{nameOf(id)}</span>
                <select value={lang} onChange={e => setTeacherLang(id, e.target.value)} className="input py-0.5 text-xs w-32">
                  <option value="">未設定</option>
                  {NATIVE_LANGS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )
          })}
        </div>
      </div>

      {/* 二、本土語開課表 */}
      <div className="card p-3 space-y-2">
        <div className="text-sm font-semibold text-zinc-700">二、本土語開課表
          <span className="text-xs font-normal text-zinc-400 ml-2">列＝本土語鎖課時段（來源：鎖課設定）、欄＝本土語言教室；預設關閉＝不開課</span>
        </div>
        {nativeSlots.length === 0 && (
          <p className="text-xs text-amber-600">尚無本土語鎖課時段——請先到「鎖課設定」建立勾選「本土語鎖課」的名目，並在各班課表鎖定本土語時段。</p>
        )}
        {nativeRooms.length === 0 && nativeSlots.length > 0 && (
          <p className="text-xs text-amber-600">尚無本土語言教室——請先到「教室設定」新增（種類選本土語言教室）。</p>
        )}
        {nativeSlots.length > 0 && nativeRooms.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">時段（鎖課班級）</th>
                  {nativeRooms.map(r => (
                    <th key={r.id} className="text-center whitespace-nowrap">
                      {r.label}
                      {r.langs.length > 0 && <div className="text-[9px] font-normal text-zinc-400">{r.langs.join('、')}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nativeSlots.map(([slot, classes]) => (
                  <tr key={slot}>
                    <td className="whitespace-nowrap align-top">
                      <div className="font-medium text-zinc-800">{slotZh(slot)}</div>
                      <div className="text-[10px] text-zinc-400 max-w-40">{classes.join('、')}</div>
                    </td>
                    {nativeRooms.map(r => {
                      const key = `${slot}|${r.id}`
                      const s = config.nativeLang.sessions[key]
                      const allowedLangs = r.langs.length ? NATIVE_LANGS.filter(l => r.langs.includes(l)) : NATIVE_LANGS
                      const cycle = () => {
                        if (!s) setSession(key, { mode: 'physical', lang: allowedLangs[0] ?? '', teacherId: '' })
                        else if (s.mode === 'physical') setSession(key, { ...s, mode: 'stream', teacherId: '' })
                        else setSession(key, null)
                      }
                      return (
                        <td key={r.id} className="text-center align-top">
                          <div className="inline-flex flex-col items-stretch gap-1 min-w-28">
                            <button onClick={cycle}
                              className={`text-xs px-2 py-1 rounded-sm border ${!s
                                ? 'bg-zinc-50 text-zinc-400 border-zinc-200'
                                : s.mode === 'physical'
                                  ? 'bg-teal-600 text-white border-teal-600'
                                  : 'bg-violet-600 text-white border-violet-600'}`}>
                              {!s ? '關閉' : s.mode === 'physical' ? '實體' : '直播共學'}
                            </button>
                            {s && (
                              <select value={s.lang} onChange={e => setSession(key, { ...s, lang: e.target.value, teacherId: '' })} className="input py-0.5 text-[11px]">
                                <option value="">選語別…</option>
                                {allowedLangs.map(l => <option key={l} value={l}>{l}</option>)}
                              </select>
                            )}
                            {s?.mode === 'physical' && (
                              <select value={s.teacherId} onChange={e => setSession(key, { ...s, teacherId: e.target.value })}
                                className={`input py-0.5 text-[11px] ${!s.teacherId ? 'border-amber-400' : ''}`}>
                                <option value="">選老師…</option>
                                {teachersOfLang(s.lang).map(id => <option key={id} value={id}>{nameOf(id)}</option>)}
                              </select>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-zinc-400">
          點狀態鈕循環：關閉 → 實體 → 直播共學 → 關閉。實體必選授課老師（清單＝該語別的老師）；
          共學不具名。老師臨時無法到課 → 切共學或關閉（學生回原班上閩南語）；找到老師 → 切實體補人。
        </p>
      </div>
    </div>
  )
}
