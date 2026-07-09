'use client'

import { SCHEDULE_DAYS, DAY_LABEL } from '@/lib/scheduling'

interface Props {
  periods: number[]                     // 節次列（例如 1~7）
  enabled?: (key: string) => boolean    // 該格是否可點（年段不可排課節 → 停用）；未提供＝全部可點
  isOn: (key: string) => boolean
  onToggle: (key: string) => void
  onLabel?: string                      // 選中格顯示文字
  onClass?: string                      // 選中格樣式
}

/** 課表樣式的時段選擇格：列＝節次、欄＝週一~五，點格切換。 */
export default function SlotGrid({ periods, enabled, isOn, onToggle, onLabel = '✓', onClass = 'bg-zinc-700 text-white border-zinc-700' }: Props) {
  return (
    <table className="w-full table-fixed border-collapse text-[11px]">
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
              const k = `${d}-${p}`
              const ok = enabled ? enabled(k) : true
              if (!ok) return <td key={d} className="p-0.5"><div className="w-full h-6 rounded-sm bg-zinc-100" /></td>
              const on = isOn(k)
              return (
                <td key={d} className="p-0.5">
                  <button type="button" onClick={() => onToggle(k)}
                    className={`w-full h-6 rounded-sm border text-[10px] ${on ? onClass : 'bg-zinc-50 text-zinc-300 border-zinc-200 hover:border-zinc-400'}`}>
                    {on ? onLabel : ''}
                  </button>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
