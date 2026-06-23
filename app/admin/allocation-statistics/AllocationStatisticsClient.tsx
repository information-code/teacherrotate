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
  const [otSubj, setOtSubj] = useState<string | null>(null)  // 不足→展開願意超鐘點的老師
  const [review, setReview] = useState<string | null>(null)  // 減課／超鐘事後審核 modal（teacher id）
  const [reasonView, setReasonView] = useState<string | null>(null)  // 配課理由 modal（teacher id）
  const [adminSel, setAdminSel] = useState<string | null>(null)      // 行政檢視：下拉選定的教師

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
  const isSubAgentSubject = (t: TeacherStat) => t.work === '代理科任'
  const subjectTabs = Array.from(new Set(
    teachers.filter(t => t.role === 'subject').flatMap(t => isSubAgentSubject(t) ? (t.data.subjects ?? []) : [subjectAreaOf(t.work)])
  )).filter(Boolean)
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
    let total = 0
    for (const t of teachers) {
      if (t.role !== 'subject') continue
      if (isSubAgentSubject(t)) total += Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0
      else if (subjectAreaOf(t.work) === subj) total += Number(t.data.gradeHours?.[String(grade)]) || 0
    }
    return total
  }
  // 配課實際授課節數 = 基本 − 核定專案減課 + 核定超鐘
  function actualOf(t: TeacherStat) { return (t.base ?? 0) - (t.data.projectReduction || 0) + (t.data.overtimeApproved || 0) }
  // 行政供給：行政教師於各領域×年級填入的節數（與代理科任同樣存於 subjectGradeHours）
  function adminSupply(grade: number, subj: string) {
    return adminTeachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0), 0)
  }
  // 全部領域（各年級需求科目之聯集，含非導師科目）
  const allSubjectsList = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => Object.keys(demandByGradeSubject[g] ?? {})))).filter(Boolean))
  function willingFor(subj: string) { return teachers.filter(t => (t.data.overtimeHours || 0) > 0 && (t.data.overtimeOrder ?? t.data.overtimeSubjects ?? []).includes(subj)) }

  function reasonIcon(t: TeacherStat) {
    if (!(t.data.principleReason || t.data.specialtyReason)) return null
    return <button onClick={() => setReasonView(t.id)} title="查看配課理由" className="ml-1 text-amber-600 hover:text-amber-700">💬</button>
  }
  function reviewIcon(t: TeacherStat) {
    const flagged = (t.data.overtimeHours || 0) > 0 || (t.data.projectReduction || 0) > 0 || (t.data.overtimeApproved || 0) > 0
    return <button onClick={() => setReview(t.id)} title="減課／超鐘審核" className={`ml-1 ${flagged ? 'text-sky-600' : 'text-zinc-300'} hover:text-sky-700`}>🛠</button>
  }

  function editCell(id: string, sub: string, val: number) {
    updateTeacher(id, d => {
      const cur = d.scenarios?.[rkey] ?? { planName: null, breakdown: {} }
      return { ...d, scenarios: { ...d.scenarios, [rkey]: { planName: null, breakdown: { ...cur.breakdown, [sub]: val } } } }
    })
  }
  function editGradeHours(id: string, grade: number, val: number) {
    updateTeacher(id, d => ({ ...d, gradeHours: { ...(d.gradeHours ?? {}), [String(grade)]: val } }))
  }
  function editSubjectGradeHours(id: string, subj: string, grade: number, val: number) {
    updateTeacher(id, d => ({ ...d, subjectGradeHours: { ...(d.subjectGradeHours ?? {}), [subj]: { ...((d.subjectGradeHours ?? {})[subj] ?? {}), [String(grade)]: val } } }))
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
          <p className="text-xs text-zinc-400">各年級看導師配課與小結（含科任、行政供給）是否足夠；科任分領域填各年段節數；行政為候補、可跨領域×年級補課。可直接編輯（最高權限）。合計≠實際者以底色標示。</p>
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
        // 導師目標 = 基本 − 情境減課 − 核定專案減課 + 核定超鐘
        const target = (t: TeacherStat) => actualOf(t) - reduction
        const breakdown = (t: TeacherStat) => t.data.scenarios?.[rkey]?.breakdown ?? {}
        return (
          <>
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">{GRADE_LABEL[grade]}導師配課與供需小結 <span className="text-xs font-normal text-zinc-400 ml-1">導師以「{REDUCTION_LABEL[reduction]}」計；下方彙整各科供給與差異</span></div>
              <table className="table-base mt-2">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white z-10 min-w-[7rem]">{GRADE_LABEL[grade]}導師</th>
                    {subjects.map(s => <th key={s} className="text-center whitespace-nowrap">{s}</th>)}
                    <th className="text-center">合計</th><th className="text-center">目標</th>
                    <th className="text-center">減課數</th><th className="text-center">超鐘數</th>
                  </tr>
                </thead>
                <tbody>
                  {homeroomTeachers.length === 0 && <tr><td colSpan={subjects.length + 5} className="text-sm text-zinc-400 text-center py-3">此年級無導師資料（請先在撕榜套用工作紀錄）</td></tr>}
                  {homeroomTeachers.map(t => {
                    const sum = subjects.reduce((s, sub) => s + (Number(breakdown(t)[sub]) || 0), 0)
                    const tgt = target(t)
                    const ch = t.data.scenarios?.[rkey]
                    const tag = ch?.planName ? `方案：${ch.planName}` : (ch && Object.keys(ch.breakdown).length ? '自選' : '未填')
                    const mismatch = sum !== tgt
                    return (
                      <tr key={t.id} className={mismatch ? 'bg-red-50' : ''}>
                        <td className={`sticky left-0 z-10 ${mismatch ? 'bg-red-50' : 'bg-white'}`}>
                          <div className="font-medium text-zinc-800">{t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}
                            {t.work === '代理導師' && <span className="ml-1 text-[10px] px-1 bg-sky-100 text-sky-700 border border-sky-200 rounded-sm">代理</span>}
                            {reasonIcon(t)}{reviewIcon(t)}
                          </div>
                          <div className={`text-[10px] ${tag === '自選' ? 'text-amber-600' : tag === '未填' ? 'text-zinc-400' : 'text-zinc-500'}`}>{tag}</div>
                        </td>
                        {subjects.map(s => (
                          <td key={s} className="text-center">
                            <NumberInput min={0} value={Number(breakdown(t)[s]) || 0} onChange={n => editCell(t.id, s, n)} className="input w-11 text-center py-0.5 text-xs" />
                          </td>
                        ))}
                        <td className={`text-center font-medium ${sum === tgt ? 'text-green-700' : 'text-amber-600'}`}>{sum}</td>
                        <td className="text-center text-zinc-500">{tgt}</td>
                        <td className="text-center text-zinc-700">{t.data.projectReduction || 0}</td>
                        <td className="text-center text-zinc-700">{t.data.overtimeApproved || 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-200">
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">科任供給</td>
                    {subjects.map(s => <td key={s} className="text-center font-medium">{subjectSupply(grade, s)}</td>)}
                    <td colSpan={4}></td>
                  </tr>
                  <tr>
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">行政供給</td>
                    {subjects.map(s => <td key={s} className="text-center font-medium">{adminSupply(grade, s)}</td>)}
                    <td colSpan={4}></td>
                  </tr>
                  <tr>
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">該領域需求</td>
                    {subjects.map(s => <td key={s} className="text-center text-zinc-500">{demandByGradeSubject[grade]?.[s] ?? 0}</td>)}
                    <td colSpan={4}></td>
                  </tr>
                  <tr>
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">差異</td>
                    {subjects.map(s => {
                      const diff = homeroomSupply(grade, s) + subjectSupply(grade, s) + adminSupply(grade, s) - (demandByGradeSubject[grade]?.[s] ?? 0)
                      const cls = diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'
                      return (
                        <td key={s} className={`text-center font-medium ${cls}`}>
                          {diff < 0
                            ? <button onClick={() => setOtSubj(otSubj === s ? null : s)} className="underline cursor-pointer">{diff}</button>
                            : (diff > 0 ? `+${diff}` : diff)}
                        </td>
                      )
                    })}
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )
      })()}

      {/* ── 科任檢視（依領域分表）── */}
      {view.startsWith('subj:') && (() => {
        const subj = view.slice(5)
        const list = teachers.filter(t => t.role === 'subject' && (isSubAgentSubject(t) ? (t.data.subjects ?? []).includes(subj) : subjectAreaOf(t.work) === subj))
        return (
          <div className="card p-0 overflow-x-auto">
            <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">科任 · {subj} <span className="text-xs font-normal text-zinc-400 ml-1">填入各老師授課年段與節數；下方對照各年級需求</span></div>
            <table className="table-base mt-2">
              <thead>
                <tr>
                  <th>教師</th>
                  {GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}
                  <th className="text-center">合計</th><th className="text-center">實際</th>
                  <th className="text-center">減課數</th><th className="text-center">超鐘數</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && <tr><td colSpan={GRADES.length + 5} className="text-sm text-zinc-400 text-center py-3">無此領域科任</td></tr>}
                {list.map(t => {
                  const isSub = isSubAgentSubject(t)
                  const cellVal = (g: number) => isSub ? (Number(t.data.subjectGradeHours?.[subj]?.[String(g)]) || 0) : (Number(t.data.gradeHours?.[String(g)]) || 0)
                  const sum = GRADES.reduce((s, g) => s + cellVal(g), 0)
                  const act = actualOf(t)  // 代理可能跨多科，act 為其總實際
                  const mismatch = !isSub && sum !== act  // 代理跨多科，單科表不比對、不上色
                  return (
                    <tr key={t.id} className={mismatch ? 'bg-red-50' : ''}>
                      <td className="font-medium text-zinc-800">
                        {t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}
                        {isSub && <span className="ml-1 text-[10px] px-1 bg-sky-100 text-sky-700 border border-sky-200 rounded-sm">代理</span>}
                        {reasonIcon(t)}{reviewIcon(t)}
                      </td>
                      {GRADES.map(g => (
                        <td key={g} className="text-center">
                          <NumberInput min={0} value={cellVal(g)} onChange={n => isSub ? editSubjectGradeHours(t.id, subj, g, n) : editGradeHours(t.id, g, n)} className="input w-11 text-center py-0.5 text-xs" />
                        </td>
                      ))}
                      <td className={`text-center font-medium ${isSub ? 'text-zinc-700' : (sum === act ? 'text-green-700' : 'text-amber-600')}`}>{sum}</td>
                      <td className="text-center text-zinc-500">{act}{isSub && <span className="text-[10px] text-zinc-400 ml-0.5">總</span>}</td>
                      <td className="text-center text-zinc-700">{t.data.projectReduction || 0}</td>
                      <td className="text-center text-zinc-700">{t.data.overtimeApproved || 0}</td>
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
                  <td className="text-xs font-semibold text-zinc-600">行政供給</td>
                  {GRADES.map(g => <td key={g} className="text-center font-medium">{adminSupply(g, subj)}</td>)}
                  <td colSpan={4}></td>
                </tr>
                <tr>
                  <td className="text-xs font-semibold text-zinc-600">該年級需求</td>
                  {GRADES.map(g => <td key={g} className="text-center text-zinc-500">{demandByGradeSubject[g]?.[subj] ?? 0}</td>)}
                  <td colSpan={4}></td>
                </tr>
                <tr>
                  <td className="text-xs font-semibold text-zinc-600">差異</td>
                  {GRADES.map(g => {
                    const diff = homeroomSupply(g, subj) + subjectSupply(g, subj) + adminSupply(g, subj) - (demandByGradeSubject[g]?.[subj] ?? 0)
                    const cls = diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'
                    return (
                      <td key={g} className={`text-center font-medium ${cls}`}>
                        {diff < 0
                          ? <button onClick={() => setOtSubj(otSubj === subj ? null : subj)} className="underline cursor-pointer">{diff}</button>
                          : (diff > 0 ? `+${diff}` : diff)}
                      </td>
                    )
                  })}
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      })()}

      {/* ── 行政檢視（候補：可跨領域×年級補課，合計需等於實際）── */}
      {view === 'admin' && (() => {
        if (adminTeachers.length === 0) return <div className="card text-sm text-zinc-400 text-center py-3">無行政資料</div>
        const sel = adminSel && adminTeachers.some(t => t.id === adminSel) ? adminSel : adminTeachers[0].id
        const t = adminTeachers.find(x => x.id === sel)!
        const act = actualOf(t)
        const cell = (subj: string, g: number) => Number(t.data.subjectGradeHours?.[subj]?.[String(g)]) || 0
        const offered = (subj: string, g: number) => demandByGradeSubject[g]?.[subj] !== undefined
        const total = allSubjectsList.reduce((s, subj) => s + GRADES.reduce((a, g) => a + cell(subj, g), 0), 0)
        const mismatch = total !== act
        return (
          <div className="space-y-4">
            <div className="card p-4 flex items-center gap-3 flex-wrap">
              <span className="text-sm text-zinc-600">選擇行政教師</span>
              <select value={sel} onChange={e => setAdminSel(e.target.value)} className="input py-1 text-sm w-56">
                {adminTeachers.map(at => <option key={at.id} value={at.id}>{at.name}（{at.roleLabel}）</option>)}
              </select>
              {reasonIcon(t)}{reviewIcon(t)}
              {t.data.locked && <span className="text-[10px]">🔒</span>}
              <span className="text-xs text-zinc-400 ml-1">行政為候補概念，可跨領域×年級補課。</span>
            </div>
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-semibold text-zinc-700">{t.name} · 各領域×年級配課
                  <span className="text-xs font-normal text-zinc-400 ml-2">基本 {t.base ?? '—'}　−減課 {t.data.projectReduction || 0}　+超鐘 {t.data.overtimeApproved || 0}　= 實際 {act}</span>
                </div>
                <div className={`text-sm font-semibold ${mismatch ? 'text-amber-600' : 'text-green-700'}`}>合計 {total} / 實際 {act}{mismatch && `（${total < act ? '不足' : '超過'} ${Math.abs(total - act)}）`}</div>
              </div>
              <table className="table-base mt-2">
                <thead><tr><th>領域</th>{GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}<th className="text-center">小計</th></tr></thead>
                <tbody>
                  {allSubjectsList.map(subj => {
                    const rowSum = GRADES.reduce((a, g) => a + cell(subj, g), 0)
                    return (
                      <tr key={subj}>
                        <td className="font-medium">{subj}</td>
                        {GRADES.map(g => (
                          <td key={g} className="text-center">
                            {offered(subj, g)
                              ? <NumberInput min={0} value={cell(subj, g)} onChange={n => editSubjectGradeHours(t.id, subj, g, n)} className="input w-11 text-center py-0.5 text-xs" />
                              : <span className="text-zinc-300">—</span>}
                          </td>
                        ))}
                        <td className="text-center text-zinc-500">{rowSum}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className={`border-t-2 border-zinc-200 ${mismatch ? 'bg-red-50' : ''}`}>
                    <td className="text-xs font-semibold text-zinc-600">合計</td>
                    {GRADES.map(g => <td key={g} className="text-center font-medium">{allSubjectsList.reduce((a, subj) => a + cell(subj, g), 0)}</td>)}
                    <td className={`text-center font-semibold ${mismatch ? 'text-amber-600' : 'text-green-700'}`}>{total}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })()}

      {/* ── 不足科目：願意超鐘點支援的老師（導師／科任檢視共用）── */}
      {otSubj && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-zinc-700">「{otSubj}」願意超鐘點支援的老師</h4>
            <button onClick={() => setOtSubj(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
          </div>
          {willingFor(otSubj).length === 0
            ? <p className="text-sm text-zinc-400">目前無老師於送出時表示願意超鐘點支援此科目。</p>
            : <ul className="text-sm text-zinc-700 space-y-1">
                {willingFor(otSubj).map(t => {
                  const order = t.data.overtimeOrder ?? t.data.overtimeSubjects ?? []
                  return (
                    <li key={t.id} className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-zinc-500">{t.roleLabel}</span>
                      <span className="text-xs text-amber-600">願意超鐘點 {t.data.overtimeHours} 節</span>
                      {order.length > 0 && <span className="text-xs text-zinc-400">順序：{order.join('＞')}</span>}
                      {(t.data.overtimeApproved || 0) > 0 && <span className="text-xs text-sky-600">已核定 {t.data.overtimeApproved} 節</span>}
                      <button onClick={() => setReview(t.id)} className="text-xs text-sky-600 underline hover:text-sky-700">審核</button>
                    </li>
                  )
                })}
              </ul>}
        </div>
      )}

      {/* ── 配課理由 modal ── */}
      {reasonView && (() => {
        const t = teachers.find(x => x.id === reasonView)
        if (!t) return null
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReasonView(null)}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-900">{t.name} · 配課理由</h3>
                  <p className="text-xs text-zinc-500">{t.roleLabel}</p>
                </div>
                <button onClick={() => setReasonView(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>
              <div className="space-y-3">
                <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 space-y-1">
                  <div className="text-xs font-semibold text-red-700">動到原則配課（理由提課發會）</div>
                  <p className="text-sm text-zinc-700 whitespace-pre-line">{t.data.principleReason || <span className="text-zinc-400">未填寫</span>}</p>
                </div>
                <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                  <div className="text-xs font-semibold text-amber-700">動到專長配課（課務組排配課依據）</div>
                  <p className="text-sm text-zinc-700 whitespace-pre-line">{t.data.specialtyReason || <span className="text-zinc-400">未填寫</span>}</p>
                </div>
              </div>
              <div className="flex justify-end pt-1"><button onClick={() => setReasonView(null)} className="btn-primary text-sm">關閉</button></div>
            </div>
          </div>
        )
      })()}

      {/* ── 減課／超鐘 事後審核 modal ── */}
      {review && (() => {
        const t = teachers.find(x => x.id === review)
        if (!t) return null
        const order = t.data.overtimeOrder ?? t.data.overtimeSubjects ?? []
        const projects = t.data.projects ?? []
        const projOrder = t.data.projectOrder ?? []
        const projTotal = projects.reduce((s, p) => s + (Number(p.hours) || 0), 0)
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReview(null)}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-900">{t.name} · 減課／超鐘審核</h3>
                  <p className="text-xs text-zinc-500">{t.roleLabel}{t.work === '代理導師' || t.work === '代理科任' ? '（代理）' : ''}</p>
                </div>
                <button onClick={() => setReview(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>

              <div className="rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm space-y-1.5">
                <div className="text-xs font-semibold text-zinc-500">老師專案減課申請</div>
                {projects.length === 0
                  ? <div className="text-zinc-400 text-xs">未申請</div>
                  : <ul className="space-y-0.5">
                      {projects.map((p, i) => <li key={i} className="text-zinc-700 flex justify-between"><span>{p.name || <span className="text-zinc-400">（未命名）</span>}</span><span className="text-zinc-500">{p.hours} 節</span></li>)}
                      <li className="text-zinc-500 text-xs border-t border-zinc-200 pt-0.5 flex justify-between"><span>合計</span><span>{projTotal} 節</span></li>
                    </ul>}
                <div className="text-zinc-700 text-xs">減課順序：{projOrder.length ? projOrder.join(' ＞ ') : <span className="text-zinc-400">未指定</span>}</div>
                <div className="text-xs font-semibold text-zinc-500 pt-1">老師超鐘意願</div>
                <div className="text-zinc-700">願意超鐘點 <span className="font-medium">{t.data.overtimeHours || 0}</span> 節</div>
                <div className="text-zinc-700 text-xs">支援順序：{order.length ? order.join(' ＞ ') : <span className="text-zinc-400">未指定</span>}</div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center justify-between text-sm"><span className="text-zinc-700">核定專案減課</span>
                  <NumberInput min={0} value={t.data.projectReduction || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, projectReduction: n }))} className="input w-16 text-center py-0.5" /></label>
                <label className="flex items-center justify-between text-sm"><span className="text-zinc-700">核定超鐘數</span>
                  <NumberInput min={0} value={t.data.overtimeApproved || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, overtimeApproved: n }))} className="input w-16 text-center py-0.5" /></label>
                <p className="text-[11px] text-zinc-400">核定後「超鐘數」將顯示於統計表。修改即自動儲存。</p>
              </div>

              <div className="flex justify-end pt-1"><button onClick={() => setReview(null)} className="btn-primary text-sm">完成</button></div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
