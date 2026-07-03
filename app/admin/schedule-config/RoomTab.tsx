'use client'

import { type Dispatch, type SetStateAction } from 'react'
import {
  ROOM_KIND_LABEL, SUBJECT_ROOM_PRESETS, classLabel,
  type ScheduleConfig, type RoomZone, type Room, type RoomKind,
} from '@/lib/scheduling'
import { GRADES } from '@/lib/allocation'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
}

function newRoom(): Room {
  return { id: crypto.randomUUID(), kind: 'class', classKey: '', name: '' }
}

/** 分頁四：教室設定。設定樓層×區域×相鄰教室（環狀/直排），教室填入班級或科任教室名稱。
 *  用途：一、排課知道哪些教室彼此接近；二、統計科任教室數（每間一張科任教室課表）。 */
export default function RoomTab({ config, setConfig, classCounts }: Props) {
  const zones = config.roomZones

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
      id: crypto.randomUUID(), floor: '', area: '', ring: false,
      rooms: Array.from({ length: 4 }, newRoom),
    }])
  }
  function removeZone(z: RoomZone) {
    const filled = z.rooms.filter(r => (r.kind === 'class' && r.classKey) || (r.kind === 'subject' && r.name)).length
    if (filled > 0 && !confirm(`區域「${z.area}${z.floor}」已填 ${filled} 間教室，確定刪除？`)) return
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

  // 小結：科任教室數、未安排教室的班級
  const subjectRooms = zones.flatMap(z => z.rooms.filter(r => r.kind === 'subject'))
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
          {subjectRooms.length > 0 && <span className="text-zinc-400">：{subjectRooms.map(r => r.name || '未命名').join('、')}</span>}
        </span>
        {allClasses.length > 0 && (
          <span className={`px-2 py-1 rounded-sm border ${unplacedClasses.length ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
            {unplacedClasses.length
              ? <>尚未安排教室的班級 {unplacedClasses.length}：{unplacedClasses.map(c => c.label).join('、')}</>
              : '✓ 所有班級都已安排教室'}
          </span>
        )}
      </div>

      {zones.length === 0 && (
        <div className="card text-sm text-zinc-400 text-center py-6">尚無教室區域，點「＋ 新增區域」開始（例如 A區 1樓 5間）。</div>
      )}

      {zones.map(z => (
        <div key={z.id} className="card p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input value={z.area} onChange={e => updateZone(z.id, { area: e.target.value })}
              placeholder="區域（如 A區）" className="input py-1 text-sm w-24" />
            <input value={z.floor} onChange={e => updateZone(z.id, { floor: e.target.value })}
              placeholder="樓層（如 1樓）" className="input py-1 text-sm w-24" />
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
                  <div className={`rounded-md border p-2 w-36 space-y-1 ${r.kind === 'subject' ? 'border-sky-300 bg-sky-50' : r.kind === 'none' ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-300 bg-white'}`}>
                    <div className="text-[10px] text-zinc-400">教室 {i + 1}</div>
                    <select value={r.kind}
                      onChange={e => updateRoom(z.id, r.id, { kind: e.target.value as RoomKind, classKey: '', name: '' })}
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
                    {r.kind === 'subject' && (
                      <input value={r.name} onChange={e => updateRoom(z.id, r.id, { name: e.target.value })}
                        placeholder="教室名稱" list="subject-room-presets" className="input py-0.5 text-xs w-full" />
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
    </div>
  )
}
