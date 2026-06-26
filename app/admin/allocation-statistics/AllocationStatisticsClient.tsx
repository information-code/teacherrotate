'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { NumberInput } from '@/components/ui/NumberInput'
import { GRADES, GRADE_LABEL, REDUCTIONS, REDUCTION_LABEL, PROJECT_PRESETS, adminKind, ADMIN_KIND_ORDER, orderSubjectNames, type Reduction } from '@/lib/allocation'
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
  const [reasonView, setReasonView] = useState<string | null>(null)  // 配課理由 modal（teacher id）
  const [projEdit, setProjEdit] = useState<string | null>(null)  // 專案減課核實 modal（teacher id）
  const [subjSel, setSubjSel] = useState<string | null>(null)        // 科任檢視：下拉選定的教師
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
  const subjectTeachers = teachers.filter(t => t.role === 'subject')
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  const adminTeachers = teachers.filter(t => t.role === 'admin')
    .sort((a, b) => ADMIN_KIND_ORDER[adminKind(a.work)] - ADMIN_KIND_ORDER[adminKind(b.work)])

  // 供給計算（共用）。科任與行政皆以 subjectGradeHours（領域×年級）統計。
  function homeroomSupply(grade: number, subj: string) {
    return teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
      .reduce((s, t) => s + (Number(t.data.scenarios?.[rkey]?.breakdown?.[subj]) || 0), 0)
  }
  function subjectSupply(grade: number, subj: string) {
    return subjectTeachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0), 0)
  }
  // 配課實際授課節數 = 基本 − 核定專案減課 + 核定超鐘
  function actualOf(t: TeacherStat) { return (t.base ?? 0) - (t.data.projectReduction || 0) + (t.data.overtimeApproved || 0) }
  // 行政供給：行政教師於各領域×年級填入的節數（與代理科任同樣存於 subjectGradeHours）
  function adminSupply(grade: number, subj: string) {
    return adminTeachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0), 0)
  }
  // 全部領域（各年級需求科目之聯集，含非導師科目）
  const allSubjectsList = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => Object.keys(demandByGradeSubject[g] ?? {})))).filter(Boolean))
  // 意願超鐘：老師在意願調查填的（willingOvertime + willingSubjects），供某科不足時參考
  function willingFor(subj: string) { return teachers.filter(t => (t.data.willingOvertime ?? t.data.overtimeHours ?? 0) > 0 && (t.data.willingSubjects ?? t.data.overtimeOrder ?? []).includes(subj)) }

  function reasonIcon(t: TeacherStat) {
    if (!(t.data.principleReason || t.data.specialtyReason)) return null
    return <button onClick={() => setReasonView(t.id)} title="查看配課理由" className="ml-1 text-amber-600 hover:text-amber-700">💬</button>
  }
  // 還原：把管理者編輯過的配課，復原成老師送出的原始版本
  function restoreIcon(t: TeacherStat) {
    const orig = t.data.scenariosOriginal
    if (!orig || !Object.keys(orig).length) return null
    return <button title="還原為老師送出的原始配課"
      onClick={() => { if (confirm(`還原「${t.name}」的配課為老師送出的原始版本？\n會覆蓋目前所有手動編輯的科目節數。`)) updateTeacher(t.id, d => ({ ...d, scenarios: JSON.parse(JSON.stringify(d.scenariosOriginal ?? {})) })) }}
      className="ml-1 text-zinc-400 hover:text-sky-600">↩</button>
  }

  function editCell(id: string, sub: string, val: number) {
    updateTeacher(id, d => {
      const cur = d.scenarios?.[rkey] ?? { planName: null, breakdown: {} }
      return { ...d, scenarios: { ...d.scenarios, [rkey]: { planName: null, breakdown: { ...cur.breakdown, [sub]: val } } } }
    })
  }
  function editSubjectGradeHours(id: string, subj: string, grade: number, val: number) {
    updateTeacher(id, d => ({ ...d, subjectGradeHours: { ...(d.subjectGradeHours ?? {}), [subj]: { ...((d.subjectGradeHours ?? {})[subj] ?? {}), [String(grade)]: val } } }))
  }

  // 科任／行政共用：下拉選人 + 年級×領域雙向表，合計需等於 基本−減課+超鐘=實際。
  // 以函式（非元件）回傳 JSX，避免每次輸入造成輸入框重新掛載而失焦。
  function gradeSubjectGrid(list: TeacherStat[], sel: string | null, setSel: (id: string) => void, kindLabel: string) {
    if (list.length === 0) return <div className="card text-sm text-zinc-400 text-center py-3">無{kindLabel}資料</div>
    const cur = sel && list.some(t => t.id === sel) ? sel : list[0].id
    const t = list.find(x => x.id === cur)!
    const act = actualOf(t)
    const cell = (subj: string, g: number) => Number(t.data.subjectGradeHours?.[subj]?.[String(g)]) || 0
    const offered = (subj: string, g: number) => demandByGradeSubject[g]?.[subj] !== undefined
    const total = allSubjectsList.reduce((s, subj) => s + GRADES.reduce((a, g) => a + cell(subj, g), 0), 0)
    const mismatch = total !== act
    return (
      <div className="space-y-4">
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-zinc-600">選擇{kindLabel}教師</span>
            <select value={cur} onChange={e => setSel(e.target.value)} className="input py-1 text-sm w-56">
              {list.map(at => <option key={at.id} value={at.id}>{at.name}（{at.roleLabel}）</option>)}
            </select>
            {reasonIcon(t)}
            {t.data.locked && <span className="text-[10px]">🔒</span>}
            <span className="flex items-center gap-1 text-xs text-zinc-600">減課 <span className="font-medium text-zinc-800">{t.data.projectReduction || 0}</span><button onClick={() => setProjEdit(t.id)} title="檢視／核實專案減課" className="text-zinc-400 hover:text-sky-600">✎</button></span>
            <label className="flex items-center gap-1 text-xs text-zinc-600">意願超鐘<NumberInput min={0} max={6} value={t.data.overtimeApproved || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, overtimeApproved: Math.min(6, Math.max(0, n)) }))} className="input w-12 text-center py-0.5" /></label>
            <span className="text-xs text-zinc-400 ml-1">可跨領域×年級填寫（含混科目）。</span>
          </div>
          {(() => {
            const wishes = (t.data.subjectWishes ?? []).filter(Boolean)
            return wishes.length > 0
              ? <div className="text-xs text-zinc-600 border-t border-zinc-100 pt-2">老師想授課志願：<span className="font-medium text-zinc-800">{wishes.join(' ＞ ')}</span></div>
              : null
          })()}
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
          <p className="text-xs text-zinc-400">各年級看導師配課與小結（含科任、行政供給）是否足夠；科任、行政皆為候補式，下拉選人後填年級×領域雙向表。可直接編輯（最高權限）。合計≠實際者以底色標示。</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {savingId && <span className="text-xs text-zinc-500">儲存中…</span>}
          <button onClick={() => router.refresh()} className="btn-secondary text-sm" title="抓取老師最新送出的資料">重新整理</button>
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
          <button onClick={() => setView('subject')} className={tabCls(view === 'subject')}>科任</button>
          <button onClick={() => setView('admin')} className={tabCls(view === 'admin')}>行政</button>
        </div>
      </div>

      {/* ── 年級檢視 ── */}
      {/^\d$/.test(view) && (() => {
        const grade = Number(view)
        const meta = gradesMeta[grade]
        const subjects = meta?.subjects ?? []
        const homeroomTeachers = teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
        // 導師（本班）目標 = 實際節數 + 自主超鐘（老師自願、自動計入；意願超鐘屬另填的核定超鐘，不計入本班目標）
        const actualPeriod = (t: TeacherStat) => (t.base ?? 0) - reduction - (t.data.projectReduction || 0)
        const autonomousOf = (t: TeacherStat) => t.data.autonomousOvertime?.[String(actualPeriod(t))] ?? 0
        const target = (t: TeacherStat) => actualPeriod(t) + autonomousOf(t)
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
                    <th className="text-center">減課</th><th className="text-center">自願超鐘</th><th className="text-center">意願超鐘</th>
                  </tr>
                </thead>
                <tbody>
                  {homeroomTeachers.length === 0 && <tr><td colSpan={subjects.length + 6} className="text-sm text-zinc-400 text-center py-3">此年級無導師資料（請先在撕榜套用工作紀錄）</td></tr>}
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
                            {reasonIcon(t)}{restoreIcon(t)}
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
                        <td className="text-center whitespace-nowrap"><span className="text-zinc-700">{t.data.projectReduction || 0}</span><button onClick={() => setProjEdit(t.id)} title="檢視／核實專案減課" className="ml-1 text-zinc-400 hover:text-sky-600">✎</button></td>
                        <td className="text-center font-medium text-sky-700">{Math.max(0, sum - actualPeriod(t))}</td>
                        {(() => { const auto = Math.max(0, sum - actualPeriod(t)); const cap = Math.max(0, 6 - auto); return (
                          <td className="text-center"><NumberInput min={0} max={cap} value={t.data.overtimeApproved || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, overtimeApproved: Math.min(cap, Math.max(0, n)) }))} className="input w-11 text-center py-0.5 text-xs" /></td>
                        ) })()}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-zinc-200">
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">科任供給</td>
                    {subjects.map(s => <td key={s} className="text-center font-medium">{subjectSupply(grade, s)}</td>)}
                    <td colSpan={5}></td>
                  </tr>
                  <tr>
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">行政供給</td>
                    {subjects.map(s => <td key={s} className="text-center font-medium">{adminSupply(grade, s)}</td>)}
                    <td colSpan={5}></td>
                  </tr>
                  <tr>
                    <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">該領域需求</td>
                    {subjects.map(s => <td key={s} className="text-center text-zinc-500">{demandByGradeSubject[grade]?.[s] ?? 0}</td>)}
                    <td colSpan={5}></td>
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
                    <td colSpan={5}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )
      })()}

      {/* ── 科任檢視（候補式：下拉選人 + 年級×領域雙向表）── */}
      {view === 'subject' && gradeSubjectGrid(subjectTeachers, subjSel, setSubjSel, '科任')}

      {/* ── 行政檢視（候補：可跨領域×年級補課，合計需等於實際）── */}
      {view === 'admin' && gradeSubjectGrid(adminTeachers, adminSel, setAdminSel, '行政')}

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
                  const order = t.data.willingSubjects ?? t.data.overtimeOrder ?? []
                  return (
                    <li key={t.id} className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-zinc-500">{t.roleLabel}</span>
                      <span className="text-xs text-amber-600">意願超鐘點 {t.data.willingOvertime ?? t.data.overtimeHours ?? 0} 節</span>
                      {order.length > 0 && <span className="text-xs text-zinc-400">支援順序：{order.join('＞')}</span>}
                      {(t.data.overtimeApproved || 0) > 0 && <span className="text-xs text-sky-600">已排超鐘 {t.data.overtimeApproved} 節</span>}
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

      {/* ── 專案減課核實 modal ── */}
      {projEdit && (() => {
        const t = teachers.find(x => x.id === projEdit)
        if (!t) return null
        const projs = t.data.projects ?? []
        const total = projs.reduce((s, p) => s + (Number(p.hours) || 0), 0)
        const setProjs = (next: { name: string; hours: number; custom?: boolean }[]) => updateTeacher(t.id, d => ({ ...d, projects: next, projectReduction: next.reduce((s, p) => s + (Number(p.hours) || 0), 0) }))
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setProjEdit(null)}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-900">{t.name} · 專案減課核實</h3>
                  <p className="text-xs text-zinc-500">{t.roleLabel}</p>
                </div>
                <button onClick={() => setProjEdit(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>
              <p className="text-[11px] text-zinc-400">老師列舉的專案減課，可刪除／修改／新增。「減課」欄＝下方總計（唯讀）。</p>
              {projs.length === 0 && <p className="text-xs text-zinc-400">老師未列舉任何專案。</p>}
              {projs.map((p, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const isCustom = !!p.custom || (!!p.name && !PROJECT_PRESETS.includes(p.name))
                    const upd = (patch: Partial<{ name: string; hours: number; custom: boolean }>) => setProjs(projs.map((x, idx) => idx === i ? { ...x, ...patch } : x))
                    return <>
                      <select value={isCustom ? '__OTHER__' : p.name} onChange={e => { const v = e.target.value; if (v === '__OTHER__') upd({ custom: true, name: PROJECT_PRESETS.includes(p.name) ? '' : p.name }); else upd({ name: v, custom: false }) }} className="input py-0.5 text-sm w-44">
                        {PROJECT_PRESETS.map(o => <option key={o} value={o}>{o}</option>)}
                        <option value="__OTHER__">其他（自行輸入）</option>
                      </select>
                      {isCustom && <input value={p.name} onChange={e => upd({ name: e.target.value, custom: true })} placeholder="自行輸入名稱" className="input py-0.5 text-sm flex-1 min-w-[7rem]" />}
                    </>
                  })()}
                  <span className="text-xs text-zinc-500">減</span>
                  <NumberInput min={0} max={6} value={p.hours} onChange={n => setProjs(projs.map((x, idx) => idx === i ? { ...x, hours: Math.min(6, Math.max(0, n)) } : x))} className="input w-14 text-center py-0.5" />
                  <span className="text-xs text-zinc-500">節</span>
                  <button onClick={() => setProjs(projs.filter((_, idx) => idx !== i))} className="text-zinc-400 hover:text-red-500 text-xs">刪除</button>
                </div>
              ))}
              <button onClick={() => setProjs([...projs, { name: PROJECT_PRESETS[0], hours: 0 }])} className="btn-secondary text-xs">＋ 新增專案</button>
              <div className="flex items-center justify-between border-t border-zinc-100 pt-2">
                <span className="text-sm text-zinc-600">減課總計 <span className="font-semibold text-zinc-900">{total}</span> 節</span>
                <button onClick={() => setProjEdit(null)} className="btn-primary text-sm">完成</button>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
