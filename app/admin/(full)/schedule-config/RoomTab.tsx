'use client'

import { useState, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  ROOM_KIND_LABEL, SUBJECT_ROOM_PRESETS, NATIVE_LANGS, classLabel, roomLabel, SCHEDULE_DAYS, DAY_LABEL, BANDS,
  type ScheduleConfig, type RoomZone, type Room, type RoomKind,
} from '@/lib/scheduling'
import { GRADES, orderSubjectNames } from '@/lib/allocation'
import type { GradeSubject, SubjectTeacher } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  subjectTeachers: SubjectTeacher[]
}

function newRoom(): Room {
  return { id: crypto.randomUUID(), kind: 'class', classKey: '', name: '', no: '', subject: '', managerIds: [], langs: [], offSlots: [], offNote: '' }
}

/** 分頁四：教室設定。設定樓層×區域×相鄰教室（環狀/直排），教室填入班級或科任教室名稱。
 *  用途：一、排課知道哪些教室彼此接近；二、統計科任教室數（每間一張科任教室課表）。 */
export default function RoomTab({ config, setConfig, classCounts, gradeSubjects, subjectTeachers }: Props) {
  const managerOptions = [...subjectTeachers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  const zones = config.roomZones
  // 顯示依「區域＋樓層」自然排序（A1、A2、A3、B2…；新增的區域不會掉到最後面）
  const sortedZones = [...zones].sort((a, b) =>
    `${a.area}${a.floor}`.localeCompare(`${b.area}${b.floor}`, 'zh-Hant', { numeric: true }))
  const [dragging, setDragging] = useState<{ zid: string; rid: string } | null>(null)
  const [offEdit, setOffEdit] = useState<{ zid: string; rid: string } | null>(null)   // 科任教室不排課時段 modal
  const paint = useRef<boolean | null>(null)   // 拖曳塗抹：true＝標成不排課、false＝清除
  const subjectOptions = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => (gradeSubjects[g] ?? []).map(s => s.name)))))

  // 全部班級與已被指派的班級（跨全部區域，擋重複）
  const allClasses: { key: string; label: string }[] = []
  for (const g of GRADES) for (let i = 0; i < (classCounts[g] ?? 0); i++) {
    allClasses.push({ key: `${g}-${i}`, label: classLabel(g, i) })
  }
  const usedClass: Record<string, boolean> = {}
  for (const z of zones) for (const r of z.rooms) if (r.kind === 'class' && r.classKey) usedClass[r.classKey] = true

  function updateZones(fn: (zs: RoomZone[]) => RoomZone[]) {
    setConfig(c => ({ ...c, roomZones: fn(c.roomZones) }))
  }
  function updateZone(id: string, patch: Partial<RoomZone>) {
    updateZones(zs => zs.map(z => z.id === id ? { ...z, ...patch } : z))
  }
  function addZone() {
    updateZones(zs => [...zs, {
      id: crypto.randomUUID(), floor: '', area: '', district: '', ring: false,
      rooms: Array.from({ length: 4 }, newRoom),
    }])
  }
  function removeZone(z: RoomZone) {
    const filled = z.rooms.filter(r => (r.kind === 'class' && r.classKey) || (r.kind === 'subject' && r.name)).length
    if (filled > 0 && !confirm(`「${z.area}棟 ${z.floor}」已填 ${filled} 間教室，確定刪除？`)) return
    updateZones(zs => zs.filter(x => x.id !== z.id))
  }
  function setRoomCount(z: RoomZone, n: number) {
    const count = Math.max(0, Math.min(30, Math.floor(n) || 0))
    if (count < z.rooms.length) {
      const removed = z.rooms.slice(count).filter(r => (r.kind === 'class' && r.classKey) || (r.kind === 'subject' && r.name))
      if (removed.length > 0 && !confirm(`縮減教室數將移除 ${removed.length} 間已填的教室，確定？`)) return
      updateZone(z.id, { rooms: z.rooms.slice(0, count) })
    } else if (count > z.rooms.length) {
      updateZone(z.id, { rooms: [...z.rooms, ...Array.from({ length: count - z.rooms.length }, newRoom)] })
    }
  }
  function updateRoom(zid: string, rid: string, patch: Partial<Room>) {
    updateZones(zs => zs.map(z => z.id !== zid ? z : {
      ...z, rooms: z.rooms.map(r => r.id === rid ? { ...r, ...patch } : r),
    }))
  }
  /** 把教室移到同區的另一個位置（拖曳／◀▶ 共用）。 */
  function moveRoom(zid: string, from: number, to: number) {
    updateZones(zs => zs.map(z => {
      if (z.id !== zid || from === to || to < 0 || to >= z.rooms.length) return z
      const rooms = [...z.rooms]
      const [m] = rooms.splice(from, 1)
      rooms.splice(to, 0, m)
      return { ...z, rooms }
    }))
  }
  /** 拖曳經過另一間教室時即時交換位置。 */
  function dragOverRoom(z: RoomZone, targetIdx: number) {
    if (!dragging || dragging.zid !== z.id) return
    const from = z.rooms.findIndex(r => r.id === dragging.rid)
    if (from >= 0 && from !== targetIdx) moveRoom(z.id, from, targetIdx)
  }

  // 小結：科任／本土語言教室數、未安排教室的班級
  const subjectRooms = zones.flatMap(z => z.rooms.filter(r => r.kind === 'subject'))
  const nativeRooms = zones.flatMap(z => z.rooms.filter(r => r.kind === 'native'))
  const unplacedClasses = allClasses.filter(c => !usedClass[c.key])

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        設定各樓層區域的相鄰教室（例如「A區 1樓 5間」），並填入使用的班級或科任教室名稱。
        排課會把同區教室視為彼此接近；每間科任教室會產生一張科任教室課表。
      </p>

      {/* 小結 */}
      <div className="flex gap-2 flex-wrap text-xs">
        <span className="px-2 py-1 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200">
          科任教室 <b>{subjectRooms.length}</b> 間（需 {subjectRooms.length} 張科任教室課表）
          {subjectRooms.length > 0 && <span className="text-zinc-400">：{subjectRooms.map(r => roomLabel(r) || '未命名').join('、')}</span>}
        </span>
        {nativeRooms.length > 0 && (
          <span className="px-2 py-1 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200">
            本土語言教室 <b>{nativeRooms.length}</b> 間
            <span className="text-zinc-400">：{nativeRooms.map(r => `${r.name || '本土語言教室'}${r.no}`).join('、')}</span>
          </span>
        )}
        {allClasses.length > 0 && (
          <span className={`px-2 py-1 rounded-sm border ${unplacedClasses.length ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
            {unplacedClasses.length
              ? <>尚未安排教室的班級 {unplacedClasses.length}：{unplacedClasses.map(c => c.label).join('、')}</>
              : '✓ 所有班級都已安排教室'}
          </span>
        )}
      </div>

      <datalist id="district-names">
        {Array.from(new Set(zones.map(z => z.district).filter(Boolean))).map(b => <option key={b} value={b} />)}
      </datalist>
      {zones.length === 0 && (
        <div className="card text-sm text-zinc-400 text-center py-6">尚無教室區域，點「＋ 新增區域」開始（例如 A區 1樓 5間）。</div>
      )}

      {sortedZones.map(z => (
        <div key={z.id} className="card p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input value={z.area} onChange={e => updateZone(z.id, { area: e.target.value })}
              placeholder="棟（如 A）" title="建築物代號（A～G）" className="input py-1 text-sm w-24" />
            <input value={z.floor} onChange={e => updateZone(z.id, { floor: e.target.value })}
              placeholder="樓層（如 1樓）" className="input py-1 text-sm w-24" />
            <input value={z.district} onChange={e => updateZone(z.id, { district: e.target.value })} list="district-names"
              placeholder="區（選填，如 AB區）" title="校園分區：同一區的幾棟填同一個名字。老師在同一區的棟之間跑班可以接受，「同半天跨區來回」只罰跨區；留空＝這棟自成一區"
              className="input py-1 text-sm w-28" />
            <label className="flex items-center gap-1 text-xs text-zinc-500">
              教室數
              <input type="number" min={0} max={30} value={z.rooms.length}
                onChange={e => setRoomCount(z, Number(e.target.value))} className="input py-1 text-sm w-16 text-center" />
            </label>
            <div className="flex rounded-sm border border-zinc-200 overflow-hidden text-xs">
              <button onClick={() => updateZone(z.id, { ring: false })}
                className={`px-2 py-1 ${!z.ring ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-500'}`}>直排</button>
              <button onClick={() => updateZone(z.id, { ring: true })}
                className={`px-2 py-1 ${z.ring ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-500'}`}>環狀</button>
            </div>
            <span className="text-[11px] text-zinc-400">{z.ring ? '環狀：第一間與最後一間也相鄰' : '直排：第一間與最後一間距離最遠'}</span>
            <button onClick={() => removeZone(z)} className="btn btn-danger text-xs py-0.5 ml-auto">刪除區域</button>
          </div>

          {z.rooms.length > 0 && (
            <div className="flex gap-2 flex-wrap items-stretch">
              {z.rooms.map((r, i) => (
                <div key={r.id} className="flex items-center gap-1">
                  <div
                    onDragOver={e => { e.preventDefault(); dragOverRoom(z, i) }}
                    onDrop={e => e.preventDefault()}
                    className={`rounded-md border p-2 w-36 space-y-1 ${dragging?.rid === r.id ? 'opacity-40 border-dashed' : ''} ${r.kind === 'subject' ? 'border-sky-300 bg-sky-50' : r.kind === 'native' ? 'border-teal-300 bg-teal-50' : r.kind === 'none' ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-300 bg-white'}`}>
                    <div
                      draggable
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragging({ zid: z.id, rid: r.id }) }}
                      onDragEnd={() => setDragging(null)}
                      className="flex items-center text-[10px] text-zinc-400 cursor-grab active:cursor-grabbing select-none"
                      title="拖曳調整順序">
                      <span className="mr-1">⠿</span>教室 {i + 1}
                      {r.kind === 'subject' && (
                        <button draggable={false} onClick={e => { e.stopPropagation(); setOffEdit({ zid: z.id, rid: r.id }) }}
                          title="科任教室不排課時段：該時段教室另有用途（收器材、收筆電、借給生活老師…），排課不使用此教室"
                          className={`ml-1 px-1 rounded-sm text-[11px] leading-none ${r.offSlots.length ? 'text-rose-600 hover:text-rose-700' : 'text-zinc-400 hover:text-zinc-700'}`}>
                          ⚙{r.offSlots.length > 0 && <span className="ml-0.5">{r.offSlots.length}</span>}
                        </button>
                      )}
                      <span className="ml-auto flex gap-0.5">
                        <button draggable={false} onClick={e => { e.stopPropagation(); moveRoom(z.id, i, i - 1) }} disabled={i === 0}
                          className="px-0.5 text-zinc-300 hover:text-zinc-600 disabled:opacity-30" title="往前移">◀</button>
                        <button draggable={false} onClick={e => { e.stopPropagation(); moveRoom(z.id, i, i + 1) }} disabled={i === z.rooms.length - 1}
                          className="px-0.5 text-zinc-300 hover:text-zinc-600 disabled:opacity-30" title="往後移">▶</button>
                      </span>
                    </div>
                    <select value={r.kind}
                      onChange={e => updateRoom(z.id, r.id, { kind: e.target.value as RoomKind, classKey: '', name: '', no: '' })}
                      className="input py-0.5 text-xs w-full">
                      {(Object.keys(ROOM_KIND_LABEL) as RoomKind[]).map(k => <option key={k} value={k}>{ROOM_KIND_LABEL[k]}</option>)}
                    </select>
                    {r.kind === 'class' && (
                      <select value={r.classKey} onChange={e => updateRoom(z.id, r.id, { classKey: e.target.value })}
                        className="input py-0.5 text-xs w-full">
                        <option value="">選擇班級…</option>
                        {allClasses.map(c => (
                          <option key={c.key} value={c.key} disabled={usedClass[c.key] && r.classKey !== c.key}>
                            {c.label}{usedClass[c.key] && r.classKey !== c.key ? '（已安排）' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.kind === 'native' && (
                      <>
                        <div className="flex gap-1">
                          <input value={r.name} onChange={e => updateRoom(z.id, r.id, { name: e.target.value })}
                            placeholder="名稱（空＝本土語言教室）" className="input py-0.5 text-xs flex-1 min-w-0" />
                          <input value={r.no} onChange={e => updateRoom(z.id, r.id, { no: e.target.value })}
                            placeholder="編號" title="同名多間時填編號（如 一、二）" className="input py-0.5 text-xs w-10 px-1 text-center" />
                        </div>
                        <div className="flex gap-0.5 flex-wrap" title="可排語別：非清單內的語別不可排；都不勾＝任何語別皆可">
                          {NATIVE_LANGS.map(lang => {
                            const on = r.langs.includes(lang)
                            return (
                              <button key={lang} type="button"
                                onClick={() => updateRoom(z.id, r.id, { langs: on ? r.langs.filter(x => x !== lang) : [...r.langs, lang] })}
                                className={`text-[9px] px-1 py-0 rounded-sm border ${on ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-zinc-400 border-zinc-200'}`}>
                                {lang.replace('（', '').replace('）', '')}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                    {r.kind === 'subject' && (
                      <>
                        <div className="flex gap-1">
                          <input value={r.name} onChange={e => updateRoom(z.id, r.id, { name: e.target.value })}
                            placeholder="教室名稱" list="subject-room-presets" className="input py-0.5 text-xs flex-1 min-w-0" />
                          <input value={r.no} onChange={e => updateRoom(z.id, r.id, { no: e.target.value })}
                            placeholder="編號" title="同名多間時填編號（如 一、二）" className="input py-0.5 text-xs w-10 px-1 text-center" />
                        </div>
                        <select value={r.subject} onChange={e => updateRoom(z.id, r.id, { subject: e.target.value })}
                          title="對應科目：排課據此計算教室衝突與走動成本" className="input py-0.5 text-xs w-full">
                          <option value="">不綁科目</option>
                          {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {/* 管理教師可多位：已選的列成標籤（點 × 移除），下拉再加人 */}
                        <div className="space-y-1">
                          {r.managerIds.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {r.managerIds.map(id => (
                                <span key={id} className="inline-flex items-center gap-0.5 text-[11px] px-1 py-0.5 bg-zinc-100 border border-zinc-200 rounded-sm">
                                  {managerOptions.find(t => t.id === id)?.name ?? id}
                                  <button onClick={() => updateRoom(z.id, r.id, { managerIds: r.managerIds.filter(x => x !== id) })}
                                    title="移除此管理教師" className="text-zinc-400 hover:text-red-500">×</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <select value="" onChange={e => { const v = e.target.value; if (v && !r.managerIds.includes(v)) updateRoom(z.id, r.id, { managerIds: [...r.managerIds, v] }) }}
                            title="管理教師：排課時此教室優先給管理教師的課使用；可加多位" className="input py-0.5 text-xs w-full">
                            <option value="">{r.managerIds.length ? '＋ 再加一位管理教師' : '無管理教師'}</option>
                            {managerOptions.filter(t => !r.managerIds.includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  {i < z.rooms.length - 1 && <span className="text-zinc-300 text-xs">—</span>}
                  {z.ring && i === z.rooms.length - 1 && z.rooms.length > 2 && <span className="text-zinc-300 text-[10px]">⟲ 接回教室1</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="flex justify-end">
        <button onClick={addZone} className="btn btn-primary text-sm py-1">＋ 新增區域</button>
      </div>

      <datalist id="subject-room-presets">
        {SUBJECT_ROOM_PRESETS.map(s => <option key={s} value={s} />)}
      </datalist>

      {/* ── 科任教室不排課時段 modal ── */}
      {offEdit && (() => {
        const z = zones.find(x => x.id === offEdit.zid); const r = z?.rooms.find(x => x.id === offEdit.rid)
        if (!z || !r) return null
        // 全年段皆不可排的格（如週三下午）灰掉不能點
        const teachable = (d: number, q: number) => BANDS.some(b => config.bands[b].teachable[`${d}-${q}`])
        const off = new Set(r.offSlots)
        const setSlots = (next: Set<string>) => updateRoom(z.id, r.id, { offSlots: Array.from(next).sort() })
        const toggle = (k: string, force?: boolean) => {
          const next = new Set(off)
          const on = force ?? !next.has(k)
          if (on) next.add(k); else next.delete(k)
          setSlots(next)
        }
        const close = () => { setOffEdit(null); paint.current = null }
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={close} onMouseUp={() => { paint.current = null }}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-zinc-900">{roomLabel(r) || '科任教室'} · 不排課時段
                    {r.subject && <span className="ml-2 text-xs font-normal text-zinc-500">{r.subject}</span>}
                  </h3>
                  <p className="text-xs text-zinc-500">點格子標記「不排課」（可按住拖曳連續標記）。該時段教室另有用途，排課引擎視為教室不存在、不會排任何課進來。</p>
                </div>
                <button onClick={close} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>
              <table className="w-full table-fixed border-collapse text-xs select-none">
                <thead>
                  <tr>
                    <th className="w-8 text-zinc-400 font-normal"></th>
                    {SCHEDULE_DAYS.map(d => <th key={d} className="py-1 text-zinc-500 font-normal">{DAY_LABEL[d].slice(1)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 7].map(q => (
                    <tr key={q}>
                      <th className="text-zinc-400 font-normal">{q}</th>
                      {SCHEDULE_DAYS.map(d => {
                        const k = `${d}-${q}`
                        const can = teachable(d, q)
                        const on = off.has(k)
                        return (
                          <td key={d} className="p-0.5">
                            <div
                              onMouseDown={() => { if (!can) return; paint.current = !on; toggle(k, !on) }}
                              onMouseEnter={() => { if (!can || paint.current === null) return; if (off.has(k) !== paint.current) toggle(k, paint.current) }}
                              title={!can ? '全年段皆非可排課時段' : on ? '不排課（點擊取消）' : '可排（點擊標記為不排課）'}
                              className={`h-8 rounded-sm border flex items-center justify-center ${
                                !can ? 'bg-zinc-100 border-zinc-200 text-zinc-300 cursor-not-allowed'
                                : on ? 'bg-rose-100 border-rose-300 text-rose-700 cursor-pointer'
                                : 'bg-white border-zinc-200 hover:border-zinc-400 cursor-pointer'}`}>
                              {!can ? '' : on ? '不排' : ''}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 whitespace-nowrap">備註</span>
                <input value={r.offNote} onChange={e => updateRoom(z.id, r.id, { offNote: e.target.value })}
                  placeholder="例：第 4、7 節收器材；週三下午借給生活老師" className="input py-1 text-xs flex-1" />
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-zinc-500">已標記 <b className="text-zinc-800">{off.size}</b> 格</span>
                <span className="flex gap-2">
                  <button onClick={() => setSlots(new Set())} disabled={!off.size} className="btn-secondary text-xs disabled:opacity-40">清除全部</button>
                  <button onClick={close} className="btn-primary text-xs">完成</button>
                </span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
