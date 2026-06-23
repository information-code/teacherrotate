'use client'

import { useState, type ReactNode } from 'react'
import { GRADES, GRADE_LABEL, type SchedulingNeeds } from '@/lib/allocation'

export interface ReasonResult { principleReason: string; specialtyReason: string }

// ── 排課需求頁（第三頁，移送課發會審議）──
export function SchedulingNeedsCard({ value, onChange, readOnly }: { value: SchedulingNeeds; onChange: (v: SchedulingNeeds) => void; readOnly: boolean }) {
  const set = (patch: Partial<SchedulingNeeds>) => onChange({ ...value, ...patch })
  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-700">排課需求</h3>
      <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">下列事項將移送<strong>課發會－排配課會議審議</strong>。</div>
      <div className="space-y-2.5 text-sm text-zinc-700">
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.officialLeave} disabled={readOnly} onChange={e => set({ officialLeave: e.target.checked })} className="w-4 h-4" />公假進修</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.counselingGroup} disabled={readOnly} onChange={e => set({ counselingGroup: e.target.checked })} className="w-4 h-4" />輔導團共同不排課</label>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2"><input type="checkbox" checked={value.avoidChildGrade} disabled={readOnly} onChange={e => set({ avoidChildGrade: e.target.checked, avoidChildGradeValue: e.target.checked ? value.avoidChildGradeValue : null })} className="w-4 h-4" />避免授課子女班級年段</label>
          {value.avoidChildGrade && (
            <select value={value.avoidChildGradeValue ?? ''} disabled={readOnly} onChange={e => set({ avoidChildGradeValue: e.target.value ? Number(e.target.value) : null })} className="input py-1 text-sm w-28">
              <option value="">請選擇年級</option>
              {GRADES.map(g => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}
            </select>
          )}
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-2"><input type="checkbox" checked={value.other} disabled={readOnly} onChange={e => set({ other: e.target.checked, otherText: e.target.checked ? value.otherText : '' })} className="w-4 h-4" />其他</label>
          {value.other && <textarea value={value.otherText} disabled={readOnly} onChange={e => set({ otherText: e.target.value })} rows={2} className="input w-full" placeholder="請說明" />}
        </div>
      </div>
    </div>
  )
}

// ── 警告理由 + 證照 modal（第一頁→第二頁之間）──
export function ReasonCertModal({ needPrinciple, needSpecialty, certSubjects, initial, onCancel, onDone }: {
  needPrinciple: boolean
  needSpecialty: boolean
  certSubjects: string[]
  initial: { principleReason?: string; specialtyReason?: string }
  onCancel: () => void
  onDone: (r: ReasonResult) => void
}) {
  const [principleReason, setPrincipleReason] = useState(initial.principleReason ?? '')
  const [specialtyReason, setSpecialtyReason] = useState(initial.specialtyReason ?? '')
  const [cert, setCert] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pages = [
    ...(needPrinciple ? ['principle'] : []),
    ...(needSpecialty ? ['specialty'] : []),
    ...(certSubjects.length ? ['cert'] : []),
  ]
  const [idx, setIdx] = useState(0)
  const page = pages[idx]
  const isLast = idx === pages.length - 1

  function next() {
    setErr(null)
    if (page === 'principle' && !principleReason.trim()) { setErr('請填寫理由'); return }
    if (page === 'specialty' && !specialtyReason.trim()) { setErr('請填寫理由'); return }
    if (page === 'cert' && !cert) { setErr('請勾選確認具備證照'); return }
    if (isLast) { onDone({ principleReason, specialtyReason }); return }
    setIdx(i => i + 1)
  }

  return (
    <Shell title={`配課提醒 ${idx + 1} / ${pages.length}`}>
      <div className="min-h-[7rem] text-sm text-zinc-700 space-y-3">
        {page === 'principle' && <>
          <p className="text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">您已調整「導師原則配課」，請填寫理由。您的理由將提交至<strong>課發會－排配課會議討論決議</strong>。</p>
          <textarea value={principleReason} onChange={e => setPrincipleReason(e.target.value)} className="input w-full" rows={3} placeholder="請說明調整原則配課的理由（必填）" />
        </>}
        {page === 'specialty' && <>
          <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">您已調整「專長配課」，請填寫理由。您的理由將成為<strong>課務組排配課的依據</strong>。</p>
          <textarea value={specialtyReason} onChange={e => setSpecialtyReason(e.target.value)} className="input w-full" rows={3} placeholder="請說明調整專長配課的理由（必填）" />
        </>}
        {page === 'cert' && <>
          <p>您的配課含 <strong>{certSubjects.join('、')}</strong>，此科目需該科證照方可授課。是否確認具備該科目之相關證照？</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={cert} onChange={e => setCert(e.target.checked)} className="w-4 h-4" /><span>我確認具備上述科目之相關證照</span></label>
        </>}
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <Buttons proceedLabel={isLast ? '下一步' : '繼續'} onProceed={next} onCancel={onCancel} />
    </Shell>
  )
}

// ── 注意事項確認 modal（送出鎖定前）──
export function ConfirmNotesModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const NOTES = [
    '導師原則上需配課國語、數學、班級學年活動、自主學習。',
    '任課任何領域都須依照課程計畫進行課程實施（符合教學正常化）。',
    '同一領域若有兩位以上老師任教，進度與課程內涵需做橫向聯繫與討論，確保學生學習品質。',
  ]
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Shell title="送出前確認">
      <div className="text-sm text-zinc-700 space-y-3">
        <div className="text-xs font-semibold text-zinc-500">注意事項</div>
        <ol className="list-decimal pl-5 space-y-1">{NOTES.map((n, i) => <li key={i}>{n}</li>)}</ol>
        <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="w-4 h-4" /><span>我已閱讀注意事項並同意遵守</span></label>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <Buttons proceedLabel="同意並送出" onProceed={() => { if (!ack) { setErr('請勾選「我已閱讀注意事項並同意遵守」'); return } onConfirm() }} onCancel={onCancel} cancelLabel="不同意" />
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-4">
        <h3 className="font-semibold text-zinc-900">{title}</h3>
        {children}
      </div>
    </div>
  )
}
// 反直覺：proceed 在左+次要灰；cancel 在右+主要深
function Buttons({ proceedLabel, onProceed, onCancel, cancelLabel = '取消' }: { proceedLabel: string; onProceed: () => void; onCancel: () => void; cancelLabel?: string }) {
  return (
    <div className="flex items-center justify-end gap-3 pt-1">
      <button onClick={onProceed} className="btn-secondary text-sm">{proceedLabel}</button>
      <button onClick={onCancel} className="btn-primary text-sm">{cancelLabel}</button>
    </div>
  )
}
