'use client'

import { useState } from 'react'
import { NumberInput } from '@/components/ui/NumberInput'

export interface WizardResult {
  principleReason: string
  specialtyReason: string
  overtimeHours: number
  overtimeSubjects: string[]
  acknowledged: true
}

interface Props {
  needPrinciple: boolean
  needSpecialty: boolean
  certSubjects: string[]            // 配課含這些需證照科目（>0）；空陣列＝跳過證照頁
  overtimeSubjectOptions: string[]  // 第4頁可勾選的科目（該年級全科）
  initial: { principleReason?: string; specialtyReason?: string; overtimeHours?: number; overtimeSubjects?: string[] }
  onCancel: () => void
  onConfirm: (r: WizardResult) => void
}

const NOTES = [
  '導師原則上需配課國語、數學、班級學年活動、自主學習。',
  '任課任何領域都須依照課程計畫進行課程實施（符合教學正常化）。',
  '同一領域若有兩位以上老師任教，進度與課程內涵需做橫向聯繫與討論，確保學生學習品質。',
]

export function AllocationSubmitWizard({ needPrinciple, needSpecialty, certSubjects, overtimeSubjectOptions, initial, onCancel, onConfirm }: Props) {
  const [principleReason, setPrincipleReason] = useState(initial.principleReason ?? '')
  const [specialtyReason, setSpecialtyReason] = useState(initial.specialtyReason ?? '')
  const [cert, setCert] = useState(false)
  const [overtimeHours, setOvertimeHours] = useState(initial.overtimeHours ?? 0)
  const [overtimeSubjects, setOvertimeSubjects] = useState<string[]>(initial.overtimeSubjects ?? [])
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pages: string[] = [
    ...(needPrinciple ? ['principle'] : []),
    ...(needSpecialty ? ['specialty'] : []),
    ...(certSubjects.length ? ['cert'] : []),
    'overtime',
    'notes',
  ]
  const [idx, setIdx] = useState(0)
  const page = pages[idx]
  const isLast = idx === pages.length - 1

  function next() {
    setErr(null)
    if (page === 'principle' && !principleReason.trim()) { setErr('請填寫理由'); return }
    if (page === 'specialty' && !specialtyReason.trim()) { setErr('請填寫理由'); return }
    if (page === 'cert' && !cert) { setErr('請勾選確認具備證照'); return }
    if (page === 'notes' && !ack) { setErr('請勾選「我已閱讀注意事項並同意遵守」'); return }
    if (isLast) { onConfirm({ principleReason, specialtyReason, overtimeHours, overtimeSubjects, acknowledged: true }); return }
    setIdx(i => i + 1)
  }
  function toggleOt(s: string) { setOvertimeSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]) }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-zinc-900">送出前確認 <span className="text-xs font-normal text-zinc-400 ml-1">{idx + 1} / {pages.length}</span></h3>
        </div>

        <div className="min-h-[8rem] text-sm text-zinc-700 space-y-3">
          {page === 'principle' && (
            <>
              <p className="text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">您已調整「導師原則配課」，請填寫理由。您的理由將提交至<strong>課發會－排配課會議討論決議</strong>。</p>
              <textarea value={principleReason} onChange={e => setPrincipleReason(e.target.value)} className="input w-full" rows={3} placeholder="請說明調整原則配課的理由（必填）" />
            </>
          )}
          {page === 'specialty' && (
            <>
              <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">您已調整「專長配課」，請填寫理由。您的理由將成為<strong>課務組排配課的依據</strong>。</p>
              <textarea value={specialtyReason} onChange={e => setSpecialtyReason(e.target.value)} className="input w-full" rows={3} placeholder="請說明調整專長配課的理由（必填）" />
            </>
          )}
          {page === 'cert' && (
            <>
              <p>您的配課含 <strong>{certSubjects.join('、')}</strong>，此科目需該科證照方可授課。是否確認具備該科目之相關證照？</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={cert} onChange={e => setCert(e.target.checked)} className="w-4 h-4" /><span>我確認具備上述科目之相關證照</span></label>
            </>
          )}
          {page === 'overtime' && (
            <>
              <label className="flex items-center gap-2"><span>您願意超鐘點幾節課？</span>
                <NumberInput min={0} value={overtimeHours} onChange={setOvertimeHours} className="input w-16 text-center py-0.5" /></label>
              {overtimeHours > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-zinc-500">您願意支援哪些科目？（可複選）</p>
                  <div className="flex flex-wrap gap-2">
                    {overtimeSubjectOptions.map(s => (
                      <label key={s} className={`px-2 py-1 border rounded-sm text-xs cursor-pointer ${overtimeSubjects.includes(s) ? 'border-zinc-500 bg-zinc-100' : 'border-zinc-200'}`}>
                        <input type="checkbox" checked={overtimeSubjects.includes(s)} onChange={() => toggleOt(s)} className="w-3.5 h-3.5 mr-1" />{s}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {page === 'notes' && (
            <>
              <div className="text-xs font-semibold text-zinc-500">注意事項</div>
              <ol className="list-decimal pl-5 space-y-1 text-sm">{NOTES.map((n, i) => <li key={i}>{n}</li>)}</ol>
              <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="w-4 h-4" /><span>我已閱讀注意事項並同意遵守</span></label>
            </>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        {/* 反直覺：繼續/同意 在左且次要灰；取消/不同意 在右且主要深 */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button onClick={next} className="btn-secondary text-sm">{isLast ? '同意並送出' : '繼續'}</button>
          <button onClick={onCancel} className="btn-primary text-sm">{isLast ? '不同意' : '取消'}</button>
        </div>
      </div>
    </div>
  )
}
