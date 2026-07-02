'use client'

import { useState } from 'react'
import { GRADE_LABEL, GRADES, type TeacherAllocation } from '@/lib/allocation'
import { AllocationPage } from '@/components/teacher/AllocationPage'
import type { HomeroomCtx } from '@/app/teacher/allocation/page'

interface Props {
  year: number
  closed: boolean
  subjectBase: number
  grades: Record<number, HomeroomCtx>
  allSubjects: string[]
  initial: TeacherAllocation
}

/**
 * 代理教師配課：與正式教師完全共用 AllocationPage，
 * 唯一差別是代理需自行選擇「身分（導師／科任）＋年級」。
 * 選好後把對應參數餵給 AllocationPage；切換選擇時以 key 重新掛載重新初始化。
 */
export function SubstituteAllocationPage({ year, closed, subjectBase, grades, allSubjects, initial }: Props) {
  const [picked, setPicked] = useState<'' | 'homeroom' | 'subject'>(
    initial.role === 'homeroom' || initial.role === 'subject' ? initial.role : ''
  )
  const [grade, setGrade] = useState<number | null>(initial.grade ?? null)
  const readOnly = (initial.locked ?? false) || closed

  const picker = (
    <div className="card p-4 space-y-3">
      <div>
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">身分（代理教師自選）</div>
        <div className="flex gap-2">
          {([['homeroom', '導師'], ['subject', '科任']] as const).map(([v, label]) => (
            <button key={v} disabled={readOnly} onClick={() => { setPicked(v); if (v === 'subject') setGrade(null) }}
              className={`px-4 py-1.5 text-sm rounded-sm border ${picked === v ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>{label}</button>
          ))}
        </div>
      </div>
      {picked === 'homeroom' && (
        <label className="flex items-center gap-2 text-sm"><span className="text-zinc-700">年級</span>
          <select value={grade ?? ''} disabled={readOnly} onChange={e => setGrade(e.target.value ? Number(e.target.value) : null)} className="input py-1 w-28">
            <option value="">請選擇</option>
            {GRADES.map(g => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}
          </select>
        </label>
      )}
    </div>
  )

  const ready = picked === 'subject' || (picked === 'homeroom' && !!grade)
  const work = picked === 'homeroom' ? '代理導師' : picked === 'subject' ? '代理科任' : ''
  const homeroom = picked === 'homeroom' && grade ? grades[grade] : null
  const base = picked === 'homeroom' ? (grade ? grades[grade].homeroomBase : null) : picked === 'subject' ? subjectBase : null

  return (
    <AllocationPage
      key={`${picked}-${grade ?? ''}`}
      year={year}
      role={ready ? (picked as 'homeroom' | 'subject') : 'none'}
      work={work}
      grade={picked === 'homeroom' ? grade : null}
      roleLabel={work || '代理教師'}
      base={base}
      homeroom={homeroom}
      allSubjects={allSubjects}
      closed={closed}
      initial={initial}
      substitutePicker={picker}
    />
  )
}
