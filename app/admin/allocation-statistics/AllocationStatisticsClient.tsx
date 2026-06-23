'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { NumberInput } from '@/components/ui/NumberInput'
import { GRADES, GRADE_LABEL, REDUCTIONS, REDUCTION_LABEL, adminKind, ADMIN_KIND_ORDER, subjectAreaOf, orderSubjectNames, type Reduction } from '@/lib/allocation'
import type { TeacherStat, GradeMeta } from './page'

interface Props {
  year: number
  phase: 'open' | 'closed'
  teachers: TeacherStat[]
  gradesMeta: Record<number, GradeMeta>
  demandByGradeSubject: Record<number, Record<string, number>>
}

export default function AllocationStatisticsClient({ year, phase, teachers: initial, gradesMeta, demandByGradeSubject }: Props) {
  const router = useRouter()
  const [teachers, setTeachers] = useState<TeacherStat[]>(initial)
  const [reduction, setReduction] = useState<Reduction>(0)
  const [view, setView] = useState<string>('1') // '1'..'6' | 'subj:<領域>' | 'admin'
  const [savingId, setSavingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const teachersRef = useRef(teachers)
  useEffect(() => { teachersRef.current = teachers }, [teachers])
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  function scheduleSave(id: string) {
    if (timers.current[id]) clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(async () => {
      const t = teachersRef.current.find(x => x.id === id)
      if (!t) return
      setSavingId(id)
      try {
        await fetch('/api/admin/allocation', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacher_id: id, data: t.data }),
        })
      } finally { setSavingId(null) }
    }, 600)
  }
  function updateTeacher(id: string, fn: (d: TeacherStat['data']) => TeacherStat['data']) {
    setTeachers(ts => ts.map(t => (t.id === id ? { ...t, data: fn(t.data) } : t)))
    scheduleSave(id)
  }

  async function setPhase(next: 'open' | 'closed') {
    const msg = next === 'closed'
      ? `截止 ${year} 學年度配課？\n\n老師端的配課選填將立即轉為唯讀。`
      : `重新開放 ${year} 學年度配課？`
    if (!confirm(msg)) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocation_phase: next }),
      })
      if (!res.ok) { alert('操作失敗，請稍後再試'); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  const rkey = String(reduction)
  const SUBJECT_ORDER = ['生活', '英語', '社會', '自然', '體育', '視覺藝術', '表演藝術', '音樂']
  const subjectTabs = Array.from(new Set(teachers.filter(t => t.role === 'subject').map(t => subjectAreaOf(t.work)))).filter(Boolean)
    .sort((a, b) => {
      const ia = SUBJECT_ORDER.indexOf(a), ib = SUBJECT_ORDER.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'zh-Hant')
    })
  const adminTeachers = teachers.filter(t => t.role === 'admin')
    .sort((a, b) => ADMIN_KIND_ORDER[adminKind(a.work)] - ADMIN_KIND_ORDER[adminKind(b.work)])

  // 供給計算（共用）
  function homeroomSupply(grade: number, subj: string) {
    return teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
      .reduce((s, t) => s + (Number(t.data.scenarios?.[rkey]?.breakdown?.[subj]) || 0), 0)
  }
  function subjectSupply(grade: number, subj: string) {
    return teachers.filter(t => t.role === 'subject' && subjectAreaOf(t.work) === subj)
      .reduce((s, t) => s + (Number(t.data.gradeHours?.[String(grade)]) || 0), 0)
  }
  function noReduce(t: TeacherStat) { return (t.base ?? 0) - (t.data.projectReduction || 0) + (t.data.extraHours || 0) }

  function editCell(id: string, sub: string, val: number) {
    updateTeacher(id, d => {
      const cur = d.scenarios?.[rkey] ?? { planName: null, breakdown: {} }
      return { ...d, scenarios: { ...d.scenarios, [rkey]: { planName: null, breakdown: { ...cur.breakdown, [sub]: val } } } }
    })
  }
  function editGradeHours(id: string, grade: number, val: number) {
    updateTeacher(id, d => ({ ...d, gradeHours: { ...(d.gradeHours ?? {}), [String(grade)]: val } }))
  }

  const tabCls = (active: boolean) =>
    `px-3 py-1 text-sm rounded-sm border ${active ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`

  return (
    <div className="space-y-5">
      {/* 標題 + 階段 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課統計 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
            {phase === 'open'
              ? <span className="ml-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-sm">填報中</span>
              : <span className="ml-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm">已截止</span>}
          </h2>
          <p className="text-xs text-zinc-400">各年級看導師配課與小結（含科任供給）是否足夠；科任分領域填各年段節數；行政只列節數。可直接編輯（最高權限）。</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {savingId && <span className="text-xs text-zinc-500">儲存中…</span>}
          {phase === 'open'
            ? <button onClick={() => setPhase('closed')} disabled={busy} className="btn-primary text-sm">{busy ? '處理中…' : '截止配課'}</button>
            : <button onClick={() => setPhase('open')} disabled={busy} className="btn-secondary text-sm">{busy ? '處理中…' : '重新開放配課'}</button>}
        </div>
      </div>

      {/* 情境 + 分頁 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">情境（影響導師供給）</span>
          <select value={reduction} onChange={e => setReduction(Number(e.target.value) as Reduction)} className="input py-1 text-sm w-28">
            {REDUCTIONS.map(r => <option key={r} value={r}>{REDUCTION_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="flex gap-1 flex-wrap items-center">
          {GRADES.map(g => <button key={g} onClick={() => setView(String(g))} className={tabCls(view === String(g))}>{GRADE_LABEL[g]}</button>)}
          <span className="mx-1 text-zinc-300">|</span>
          {subjectTabs.map(s => <button key={s} onClick={() => setView('subj:' + s)} className={tabCls(view === 'subj:' + s)}>{s}</button>)}
          <span className="mx-1 text-zinc-300">|</span>
          <button onClick={() => setView('admin')} className={tabCls(view === 'admin')}>行政</button>
        </div>
      </div>

      {/* ── 年級檢視 ── */}
      {/^\d$/.test(view) && (() => {
        const grade = Number(view)
        const meta = gradesMeta[grade]
        const subjects = meta?.subjects ?? []
        const homeroomTeachers = teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
        const target = (t: TeacherStat) => (t.base ?? 0) - reduction - (t.data.projectReduction || 0) + (t.data.extraHours || 0)
        const breakdown = (t: TeacherStat) => t.data.scenarios?.[rkey]?.breakdown ?? {}
        // 小結涵蓋：該年級所有有需求的科目 ∪ 導師可配課科目
        const summarySubjects = orderSubjectNames(Array.from(new Set([...Object.keys(demandByGradeSubject[grade] ?? {}), ...subjects])).filter(Boolean))
        return (
          <>
            <div className="card p-0 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white z-10 min-w-[7rem]">{GRADE_LABEL[grade]}導師</th>
                    {subjects.map(s => <th key={s} className="text-center whitespace-nowrap">{s}</th>)}
                    <th className="text-center">合計</th><th className="text-center">目標</th>
                    <th className="text-center">專案<br />減課</th><th className="text-center">超<br />鐘點</th>
                  </tr>
                </thead>
                <tbody>
                  {homeroomTeachers.length === 0 && <tr><td colSpan={subjects.length + 5} className="text-sm text-zinc-400 text-center py-3">此年級無導師資料（請先在撕榜套用工作紀錄）</td></tr>}
                  {homeroomTeachers.map(t => {
                    const sum = subjects.reduce((s, sub) => s + (Number(breakdown(t)[sub]) || 0), 0)
                    const tgt = target(t)
                    const ch = t.data.scenarios?.[rkey]
                    const tag = ch?.planName ? `方案：${ch.planName}` : (ch && Object.keys(ch.breakdown).length ? '自選' : '未填')
                    return (
                      <tr key={t.id}>
                        <td className="sticky left-0 bg-white z-10">
                          <div className="font-medium text-zinc-800">{t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}</div>
                          <div className={`text-[10px] ${tag === '自選' ? 'text-amber-600' : tag === '未填' ? 'text-zinc-400' : 'text-zinc-500'}`}>{tag}</div>
                        </td>
                        {subjects.map(s => (
                          <td key={s} className="text-center">
                            <NumberInput min={0} value={Number(breakdown(t)[s]) || 0} onChange={n => editCell(t.id, s, n)} className="input w-11 text-center py-0.5 text-xs" />
                          </td>
                        ))}
                        <td className={`text-center font-medium ${sum === tgt ? 'text-green-700' : 'text-amber-600'}`}>{sum}</td>
                        <td className="text-center text-zinc-500">{tgt}</td>
                        <td className="text-center"><NumberInput min={0} value={t.data.projectReduction || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, projectReduction: n }))} className="input w-10 text-center py-0.5 text-xs" /></td>
                        <td className="text-center"><NumberInput min={0} value={t.data.extraHours || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, extraHours: n }))} className="input w-10 text-center py-0.5 text-xs" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 小結：需求 vs 導師+科任供給 */}
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">{GRADE_LABEL[grade]} 各科目供需小結 <span className="text-xs font-normal text-zinc-400 ml-1">導師以「{REDUCTION_LABEL[reduction]}」計</span></div>
              <table className="table-base mt-2">
                <thead><tr><th>科目</th><th className="text-center">需求</th><th className="text-center">導師供給</th><th className="text-center">科任供給</th><th className="text-center">合計供給</th><th className="text-center">差異</th></tr></thead>
                <tbody>
                  {summarySubjects.map(sub => {
                    const demand = demandByGradeSubject[grade]?.[sub] ?? 0
                    const hr = homeroomSupply(grade, sub)
                    const sub2 = subjectSupply(grade, sub)
                    const supply = hr + sub2
                    const diff = supply - demand
                    const cls = diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'
                    return (
                      <tr key={sub}>
                        <td className="font-medium">{sub}</td>
                        <td className="text-center text-zinc-500">{demand}</td>
                        <td className="text-center">{hr}</td>
                        <td className="text-center">{sub2}</td>
                        <td className="text-center font-medium">{supply}</td>
                        <td className={`text-center font-medium ${cls}`}>{diff > 0 ? `+${diff}` : diff}{diff < 0 ? '（不足）' : diff > 0 ? '（超支）' : ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      })()}

      {/* ── 科任檢視（依領域分表）── */}
      {view.startsWith('subj:') && (() => {
        const subj = view.slice(5)
        const list = teachers.filter(t => t.role === 'subject' && subjectAreaOf(t.work) === subj)
        return (
          <div className="card p-0 overflow-x-auto">
            <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">科任 · {subj} <span className="text-xs font-normal text-zinc-400 ml-1">填入各老師授課年段與節數；下方對照各年級需求</span></div>
            <table className="table-base mt-2">
              <thead>
                <tr>
                  <th>教師</th>
                  {GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}
                  <th className="text-center">合計</th><th className="text-center">實際</th>
                  <th className="text-center">專案<br />減課</th><th className="text-center">超<br />鐘點</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={GRADES.length + 5} className="text-sm text-zinc-400 text-center py-3">無此領域科任</td></tr>}
                {list.map(t => {
                  const sum = GRADES.reduce((s, g) => s + (Number(t.data.gradeHours?.[String(g)]) || 0), 0)
                  const act = noReduce(t)
                  return (
                    <tr key={t.id}>
                      <td className="font-medium text-zinc-800">{t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}</td>
                      {GRADES.map(g => (
                        <td key={g} className="text-center">
                          <NumberInput min={0} value={Number(t.data.gradeHours?.[String(g)]) || 0} onChange={n => editGradeHours(t.id, g, n)} className="input w-11 text-center py-0.5 text-xs" />
                        </td>
                      ))}
                      <td className={`text-center font-medium ${sum === act ? 'text-green-700' : 'text-amber-600'}`}>{sum}</td>
                      <td className="text-center text-zinc-500">{act}</td>
                      <td className="text-center"><NumberInput min={0} value={t.data.projectReduction || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, projectReduction: n }))} className="input w-10 text-center py-0.5 text-xs" /></td>
                      <td className="text-center"><NumberInput min={0} value={t.data.extraHours || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, extraHours: n }))} className="input w-10 text-center py-0.5 text-xs" /></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200">
                  <td className="text-xs font-semibold text-zinc-600">科任供給加總</td>
                  {GRADES.map(g => <td key={g} className="text-center font-medium">{subjectSupply(g, subj)}</td>)}
                  <td colSpan={4}></td>
                </tr>
                <tr>
                  <td className="text-xs font-semibold text-zinc-600">該年級需求</td>
                  {GRADES.map(g => <td key={g} className="text-center text-zinc-500">{demandByGradeSubject[g]?.[subj] ?? 0}</td>)}
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      })()}

      {/* ── 行政檢視 ── */}
      {view === 'admin' && (
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">行政 節數（無減課 · 校長→主任→組長）</div>
          <table className="table-base mt-2">
            <thead><tr><th>教師</th><th>身分</th><th className="text-center">基本</th><th className="text-center">專案減課</th><th className="text-center">超鐘點</th><th className="text-center">實際授課節數</th></tr></thead>
            <tbody>
              {adminTeachers.length === 0 && <tr><td colSpan={6} className="text-sm text-zinc-400 text-center py-3">無行政資料</td></tr>}
              {adminTeachers.map(t => (
                <tr key={t.id}>
                  <td className="font-medium text-zinc-800">{t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}</td>
                  <td className="text-zinc-600">{t.roleLabel}</td>
                  <td className="text-center text-zinc-500">{t.base ?? '—'}</td>
                  <td className="text-center"><NumberInput min={0} value={t.data.projectReduction || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, projectReduction: n }))} className="input w-12 text-center py-0.5 text-xs" /></td>
                  <td className="text-center"><NumberInput min={0} value={t.data.extraHours || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, extraHours: n }))} className="input w-12 text-center py-0.5 text-xs" /></td>
                  <td className="text-center font-medium text-zinc-900">{noReduce(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
