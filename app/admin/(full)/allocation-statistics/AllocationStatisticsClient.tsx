'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { NumberInput } from '@/components/ui/NumberInput'
import { GRADES, GRADE_LABEL, REDUCTION_LABEL, PROJECT_PRESETS, adminKind, ADMIN_KIND_ORDER, orderSubjectNames, type Reduction, type ExtraCourse } from '@/lib/allocation'
import type { TeacherStat, GradeMeta } from './page'

interface Props {
  year: number
  phase: 'open' | 'closed'
  teachers: TeacherStat[]
  gradesMeta: Record<number, GradeMeta>
  demandByGradeSubject: Record<number, Record<string, number>>
  adoptedByGrade: Record<number, Reduction>   // 各年級採用情境（配課設定定案；未定案為推定值）
  adoptedDecided: Record<number, boolean>     // 各年級是否已在配課設定按下「採用」
  extraCourses: ExtraCourse[]   // 其他課程（本土語語別課）：需求以總節數計
}

export default function AllocationStatisticsClient({ year, phase, teachers: initial, gradesMeta, demandByGradeSubject, adoptedByGrade, adoptedDecided, extraCourses }: Props) {
  const router = useRouter()
  const [teachers, setTeachers] = useState<TeacherStat[]>(initial)
  // 「重新整理」按鈕靠 router.refresh() 抓新資料，但 useState(initial) 只在掛載時讀一次，
  // props 更新後必須同步進 state，否則新增的老師（如補建工作紀錄者）不會出現在名單
  useEffect(() => { setTeachers(initial) }, [initial])
  const [view, setView] = useState<string>('1') // '1'..'6' | 'subj:<領域>' | 'admin'
  const [savingId, setSavingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fillGap, setFillGap] = useState<{ grade: number; subj: string } | null>(null)  // 差異缺口→超鐘推薦 modal
  const [overviewOpen, setOverviewOpen] = useState(false)   // 統計資料 modal（供需矩陣＋減課統計）
  const [ovTab, setOvTab] = useState<'matrix' | 'reduction'>('matrix')      // 總覽 modal 分頁：供需矩陣／減課統計
  const [ovMode, setOvMode] = useState<'diff' | 'staff'>('diff')            // 矩陣顯示模式：差異數字／授課師資
  const [ovStaffSubj, setOvStaffSubj] = useState<string | null>(null)       // 師資模式選定的領域（一次一科）
  const [highlightId, setHighlightId] = useState<string | null>(null)       // 從總覽跳轉的導師列高亮
  const [reasonView, setReasonView] = useState<string | null>(null)  // 配課理由 modal（teacher id）
  const [projEdit, setProjEdit] = useState<string | null>(null)  // 專案減課核實 modal（teacher id）
  const [subEdit, setSubEdit] = useState<string | null>(null)    // 代理教師身分/年級調整 modal（teacher id）
  const [subRole, setSubRole] = useState<'homeroom' | 'subject'>('homeroom')
  const [subGrade, setSubGrade] = useState<number>(1)
  const [subjSel, setSubjSel] = useState<string | null>(null)        // 科任檢視：下拉選定的教師
  const [adminSel, setAdminSel] = useState<string | null>(null)      // 行政檢視：下拉選定的教師
  const [hourlySel, setHourlySel] = useState<string | null>(null)    // 鐘點檢視：下拉選定的教師
  const [remindOpen, setRemindOpen] = useState(false)                // 未鎖定提醒訊息 modal
  const [copiedKey, setCopiedKey] = useState<string | null>(null)    // 已複製回饋（'all' | teacherId）

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

  const subjectTeachers = teachers.filter(t => t.role === 'subject' && !t.isHourly)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  const adminTeachers = teachers.filter(t => t.role === 'admin')
    .sort((a, b) => ADMIN_KIND_ORDER[adminKind(a.work)] - ADMIN_KIND_ORDER[adminKind(b.work)])
  const hourlyTeachers = teachers.filter(t => t.isHourly)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))

  // 目前分頁的老師範圍與未鎖定名單（提示條＋提醒訊息共用；鐘點無鎖定概念不列）
  const scopeInfo = (() => {
    if (/^\d$/.test(view)) { const g = Number(view); return { label: `${GRADE_LABEL[g]}導師`, list: teachers.filter(t => t.role === 'homeroom' && t.grade === g) } }
    if (view === 'subject') return { label: '科任', list: subjectTeachers }
    if (view === 'hourly') return { label: '鐘點', list: [] as TeacherStat[] }
    return { label: '行政', list: adminTeachers }
  })()
  const unlockedTeachers = scopeInfo.list.filter(t => !t.data.locked)

  // 供給計算（共用）。導師供給以「該年級採用情境」的配課計；科任與行政以 subjectGradeHours（領域×年級）統計。
  function homeroomSupply(grade: number, subj: string) {
    const rk = String(adoptedByGrade[grade] ?? 0)
    return teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
      .reduce((s, t) => s + (Number(t.data.scenarios?.[rk]?.breakdown?.[subj]) || 0), 0)
  }
  function subjectSupply(grade: number, subj: string) {
    return subjectTeachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0), 0)
  }
  // 配課實際授課節數 = 基本 − 核定專案減課（意願超鐘不入帳：超鐘直接反映在科目節數，合計>實際＝超鐘中）
  function actualOf(t: TeacherStat) { return (t.base ?? 0) - (t.data.projectReduction || 0) }
  // 行政供給：行政教師於各領域×年級填入的節數（與代理科任同樣存於 subjectGradeHours）
  function adminSupply(grade: number, subj: string) {
    return adminTeachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0), 0)
  }
  // 鐘點供給：鐘點教師（課務組直接填），同樣存於 subjectGradeHours
  function hourlySupply(grade: number, subj: string) {
    return hourlyTeachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0), 0)
  }
  // 全部領域（各年級需求科目之聯集，含非導師科目）
  const allSubjectsList = orderSubjectNames(Array.from(new Set(GRADES.flatMap(g => Object.keys(demandByGradeSubject[g] ?? {})))).filter(Boolean))
  // 本土語額外授課（語別×年級）：附加於雙向表最後，只開放有設需求的年級（需求以總節數計、不綁班級）
  const extraNames = Array.from(new Set(extraCourses.map(c => c.lang).filter(Boolean))).filter(n => !allSubjectsList.includes(n))
  const gridSubjects = [...allSubjectsList, ...extraNames]
  const isExtra = (subj: string) => extraNames.includes(subj)
  const extraOffered = (subj: string, g: number) => extraCourses.some(c => c.lang === subj && c.grade === g)
  // 語別×年級已配：所有教師（含虛擬/鐘點）於該語別該年級填入的節數總和
  function extraAllocated(lang: string, g: number) {
    return teachers.reduce((s, t) => s + (Number(t.data.subjectGradeHours?.[lang]?.[String(g)]) || 0), 0)
  }
  // ── 意願超鐘（純意願訊號，不核定、不入帳）：供差異缺口 modal 排推薦名單 ──
  const wishesOf = (t: TeacherStat) => (t.data.willingSubjects ?? t.data.overtimeOrder ?? []).filter(Boolean)
  const willingOf = (t: TeacherStat) => Number(t.data.willingOvertime ?? t.data.overtimeHours ?? 0) || 0
  // 導師的本班帳（依其年級採用情境）：合計 / 目標（= 實際 + 自願超鐘）
  function hrActualOf(t: TeacherStat) {
    return (t.base ?? 0) - ((adoptedByGrade[t.grade ?? 0] ?? 0) as number) - (t.data.projectReduction || 0)
  }
  function hrAutoOf(t: TeacherStat, sum: number) {
    const rec = t.data.autonomousOvertime ?? {}
    const exact = rec[String(hrActualOf(t))]
    if (exact !== undefined) return Number(exact) || 0
    const maxAgreed = Math.max(0, ...Object.values(rec).map(n => Number(n) || 0))
    return Math.min(Math.max(0, sum - hrActualOf(t)), maxAgreed)
  }
  function hrSumOf(t: TeacherStat) {
    const rk = String(adoptedByGrade[t.grade ?? 0] ?? 0)
    const subj = gradesMeta[t.grade ?? 0]?.subjects ?? []
    const bd = t.data.scenarios?.[rk]?.breakdown ?? {}
    return subj.reduce((s, sub) => s + (Number(bd[sub]) || 0), 0)
  }
  /** 目前已超鐘節數（合計超過目標的部分）。 */
  function overOf(t: TeacherStat): number {
    if (t.role === 'homeroom') {
      const sum = hrSumOf(t)
      return Math.max(0, sum - (hrActualOf(t) + hrAutoOf(t, sum)))
    }
    const total = gridSubjects.reduce((s, subj) => s + GRADES.reduce((a, g) => a + (Number(t.data.subjectGradeHours?.[subj]?.[String(g)]) || 0), 0), 0)
    return t.isHourly ? 0 : Math.max(0, total - actualOf(t))
  }
  /** 剩餘意願 = 申報意願 − 已超鐘（不動老師原始申報，改回節數即自動回復）。 */
  const remainingOf = (t: TeacherStat) => willingOf(t) - overOf(t)

  // ── 師資模式：各格授課老師明細（與上方供給計算同口徑）──
  function homeroomContribs(g: number, subj: string) {
    const rk = String(adoptedByGrade[g] ?? 0)
    return teachers.filter(t => t.role === 'homeroom' && t.grade === g)
      .map(t => ({ t, v: Number(t.data.scenarios?.[rk]?.breakdown?.[subj]) || 0 }))
      .filter(x => x.v > 0)
  }
  function nonHomeroomContribs(g: number, subj: string) {
    return [...subjectTeachers, ...adminTeachers, ...hourlyTeachers]
      .map(t => ({ t, v: Number(t.data.subjectGradeHours?.[subj]?.[String(g)]) || 0 }))
      .filter(x => x.v > 0)
  }
  function extraContribs(lang: string, g: number) {
    return teachers
      .map(t => ({ t, v: Number(t.data.subjectGradeHours?.[lang]?.[String(g)]) || 0 }))
      .filter(x => x.v > 0)
  }
  /** 從供需總覽點老師名 → 關 modal、切到其所屬分頁並定位（導師列捲動高亮）。 */
  function jumpToTeacher(t: TeacherStat) {
    setOverviewOpen(false)
    if (t.role === 'homeroom') { setView(String(t.grade ?? 1)); setHighlightId(t.id) }
    else if (t.isHourly) { setView('hourly'); setHourlySel(t.id) }
    else if (t.role === 'admin') { setView('admin'); setAdminSel(t.id) }
    else { setView('subject'); setSubjSel(t.id) }
  }
  useEffect(() => {
    if (!highlightId) return
    document.getElementById(`hr-row-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setHighlightId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId])
  const staffBadge = (t: TeacherStat, v: number) => (
    <button key={t.id} onClick={() => jumpToTeacher(t)}
      title={`${t.name}（${t.roleLabel}）— 點擊前往其配課調整`}
      className="inline-flex items-baseline gap-0.5 text-[11px] px-1 py-0.5 border border-zinc-200 rounded-sm bg-white text-zinc-700 hover:border-sky-400 hover:text-sky-700 whitespace-nowrap">
      {t.name}<b>{v}</b>
    </button>
  )

  function reasonIcon(t: TeacherStat) {
    if (!(t.data.principleReason || t.data.specialtyReason)) return null
    return <button onClick={() => setReasonView(t.id)} title="查看配課理由" className="ml-1 text-amber-600 hover:text-amber-700">💬</button>
  }
  /** 代理教師身分/年級調整鈕（身分存於配課資料，選錯由管理者在此修正）。 */
  function subEditIcon(t: TeacherStat) {
    if (!t.isSubstitute) return null
    return <button title="調整代理身分／年級"
      onClick={() => { setSubRole(t.role === 'subject' ? 'subject' : 'homeroom'); setSubGrade(t.grade ?? 1); setSubEdit(t.id) }}
      className="ml-1 text-zinc-400 hover:text-sky-600">✎</button>
  }
  // 還原：把管理者編輯過的配課，復原成老師送出的原始版本
  function restoreIcon(t: TeacherStat) {
    const orig = t.data.scenariosOriginal
    if (!orig || !Object.keys(orig).length) return null
    return <button title="還原為老師送出的原始配課"
      onClick={() => { if (confirm(`還原「${t.name}」的配課為老師送出的原始版本？\n會覆蓋目前所有手動編輯的科目節數。`)) updateTeacher(t.id, d => ({ ...d, scenarios: JSON.parse(JSON.stringify(d.scenariosOriginal ?? {})) })) }}
      className="ml-1 text-zinc-400 hover:text-sky-600">↩</button>
  }

  function editCell(id: string, sub: string, val: number, rk: string) {
    updateTeacher(id, d => {
      const cur = d.scenarios?.[rk] ?? { planName: null, breakdown: {} }
      return { ...d, scenarios: { ...d.scenarios, [rk]: { planName: null, breakdown: { ...cur.breakdown, [sub]: val } } } }
    })
  }
  function editSubjectGradeHours(id: string, subj: string, grade: number, val: number) {
    updateTeacher(id, d => ({ ...d, subjectGradeHours: { ...(d.subjectGradeHours ?? {}), [subj]: { ...((d.subjectGradeHours ?? {})[subj] ?? {}), [String(grade)]: val } } }))
  }

  // 科任／行政／鐘點共用：下拉選人 + 年級×領域雙向表。
  // 科任行政：合計需等於 基本−減課+超鐘=實際；鐘點（hourly=true）：無減課/超鐘/鎖定，只顯示合計。
  // 以函式（非元件）回傳 JSX，避免每次輸入造成輸入框重新掛載而失焦。
  function gradeSubjectGrid(list: TeacherStat[], sel: string | null, setSel: (id: string) => void, kindLabel: string, hourly = false) {
    if (list.length === 0) {
      return <div className="card text-sm text-zinc-400 text-center py-3">
        無{kindLabel}資料{hourly && '——請先於「帳號資料」新增教師並將聘任別設為「鐘點」'}
      </div>
    }
    const cur = sel && list.some(t => t.id === sel) ? sel : list[0].id
    const t = list.find(x => x.id === cur)!
    const act = actualOf(t)
    const cell = (subj: string, g: number) => Number(t.data.subjectGradeHours?.[subj]?.[String(g)]) || 0
    const offered = (subj: string, g: number) => demandByGradeSubject[g]?.[subj] !== undefined || extraOffered(subj, g)
    const total = gridSubjects.reduce((s, subj) => s + GRADES.reduce((a, g) => a + cell(subj, g), 0), 0)
    // 合計<實際＝不足（紅）；合計>實際＝超鐘中（藍，超出申報意願另標）；相等＝正常
    const deficit = !hourly && total < act
    const over = hourly ? 0 : Math.max(0, total - act)
    const beyond = Math.max(0, over - willingOf(t))
    return (
      <div className="space-y-4">
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-zinc-600">選擇{kindLabel}教師</span>
            <select value={cur} onChange={e => setSel(e.target.value)} className="input py-1 text-sm w-48 sm:w-56 max-w-full">
              {list.map(at => <option key={at.id} value={at.id}>{at.name}（{at.roleLabel}）</option>)}
            </select>
            {subEditIcon(t)}
            {!hourly && <>
              {reasonIcon(t)}
              {t.data.locked && <span className="text-[10px]">🔒</span>}
              <span className="flex items-center gap-1 text-xs text-zinc-600">減課 <span className="font-medium text-zinc-800">{t.data.projectReduction || 0}</span><button onClick={() => setProjEdit(t.id)} title="檢視／核實專案減課" className="text-zinc-400 hover:text-sky-600">✎</button></span>
              <span className="text-xs text-zinc-400 ml-1">可跨領域×年級填寫（含混科目）。</span>
            </>}
            {hourly && <span className="text-xs text-zinc-400 ml-1">鐘點教師無減課、超鐘與鎖定，由課務組直接填寫節數。</span>}
          </div>
          {!hourly && (() => {
            const wishes = (t.data.subjectWishes ?? []).filter(Boolean)
            return wishes.length > 0
              ? <div className="text-xs text-zinc-600 border-t border-zinc-100 pt-2">老師想授課志願：<span className="font-medium text-zinc-800">{wishes.join(' ＞ ')}</span></div>
              : null
          })()}
        </div>
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 pt-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold text-zinc-700">{t.name} · 各領域×年級配課
              {!hourly && <span className="text-xs font-normal text-zinc-400 ml-2">基本 {t.base ?? '—'}　−減課 {t.data.projectReduction || 0}　= 實際 {act}</span>}
            </div>
            {hourly
              ? <div className="text-sm font-semibold text-zinc-700">合計 {total} 節</div>
              : <div className={`text-sm font-semibold ${deficit ? 'text-red-600' : over > 0 ? 'text-sky-700' : 'text-zinc-700'}`}>
                  合計 {total} / 實際 {act}
                  {deficit && `（不足 ${act - total}）`}
                  {over > 0 && <span className="ml-1">超鐘 +{over}{beyond > 0 && <span className="text-amber-600">（超出意願 {beyond}）</span>}</span>}
                </div>}
          </div>
          <table className="table-base no-hover mt-2">
            <thead><tr><th>領域</th>{GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}<th className="text-center">小計</th></tr></thead>
            <tbody>
              {gridSubjects.map(subj => {
                const rowSum = GRADES.reduce((a, g) => a + cell(subj, g), 0)
                return (
                  <tr key={subj} className={isExtra(subj) ? 'bg-teal-50/50' : ''}>
                    <td className="font-medium">{subj}{isExtra(subj) && <span className="ml-1 text-[10px] px-1 bg-teal-100 text-teal-700 border border-teal-200 rounded-sm">其他</span>}</td>
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
              <tr className={`border-t-2 border-zinc-200 ${deficit ? 'bg-red-50' : over > 0 ? 'bg-sky-50' : ''}`}>
                <td className="text-xs font-semibold text-zinc-600">合計</td>
                {GRADES.map(g => <td key={g} className="text-center font-medium">{gridSubjects.reduce((a, subj) => a + cell(subj, g), 0)}</td>)}
                <td className={`text-center font-semibold ${deficit ? 'text-red-600' : over > 0 ? 'text-sky-700' : 'text-zinc-800'}`}>{total}</td>
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

      {/* 分頁（情境依各年級於配課設定的「採用」定案，不再全校連動切換） */}
      <div className="space-y-2">
        <div className="flex gap-1 flex-wrap items-center">
          {GRADES.map(g => <button key={g} onClick={() => setView(String(g))} className={tabCls(view === String(g))}>{GRADE_LABEL[g]}</button>)}
          <span className="mx-1 text-zinc-300">|</span>
          <button onClick={() => setView('subject')} className={tabCls(view === 'subject')}>科任</button>
          <button onClick={() => setView('admin')} className={tabCls(view === 'admin')}>行政</button>
          <button onClick={() => setView('hourly')} className={tabCls(view === 'hourly')}>鐘點</button>
          <button onClick={() => setOverviewOpen(true)} className="ml-auto btn-secondary text-sm py-1">📊 統計資料</button>
        </div>
      </div>

      {/* ── 尚未送出鎖定提示（依目前分頁）── */}
      {scopeInfo.list.length > 0 && (unlockedTeachers.length > 0
        ? <div className="card border-amber-200 bg-amber-50 px-4 py-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-amber-800">
                <span className="font-semibold">⏳ {scopeInfo.label}尚未送出鎖定（{unlockedTeachers.length}/{scopeInfo.list.length}）：</span>
                <span className="ml-1">{unlockedTeachers.map(t => t.name).join('、')}</span>
              </p>
              <button onClick={() => setRemindOpen(true)} className="btn-secondary text-xs flex-shrink-0">💬 產生 LINE 提醒訊息</button>
            </div>
          </div>
        : <div className="card border-green-200 bg-green-50 px-4 py-2.5">
            <p className="text-sm text-green-700">✓ {scopeInfo.label}全數已送出鎖定（{scopeInfo.list.length} 位）</p>
          </div>
      )}

      {/* ── 年級檢視 ── */}
      {/^\d$/.test(view) && (() => {
        const grade = Number(view)
        const meta = gradesMeta[grade]
        const subjects = meta?.subjects ?? []
        const homeroomTeachers = teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
        // 此年級採用的情境（配課設定定案；未定案為推定並警示）
        const reduction = (adoptedByGrade[grade] ?? 0) as Reduction
        const rkey = String(reduction)
        // 導師（本班）目標 = 實際節數 + 自願超鐘（本班多上、計入目標）；意願超鐘為純意願訊號、不入帳
        const actualPeriod = hrActualOf
        const autonomousOf = hrAutoOf
        const breakdown = (t: TeacherStat) => t.data.scenarios?.[rkey]?.breakdown ?? {}
        return (
          <>
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">{GRADE_LABEL[grade]}導師配課與供需小結
                <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded-sm border align-middle ${adoptedDecided[grade] ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                  {adoptedDecided[grade] ? `採用：${REDUCTION_LABEL[reduction]}` : `⚠ 未定案，暫以${REDUCTION_LABEL[reduction]}計（請至配課設定選定採用情境）`}
                </span>
                <span className="text-xs font-normal text-zinc-400 ml-1">各科供給與缺口請看「📊 統計資料」</span>
              </div>
              <table className="table-base no-hover mt-2">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white z-10 min-w-[11rem]">{GRADE_LABEL[grade]}導師</th>
                    {subjects.map(s => <th key={s} className="text-center min-w-[3.5rem]">{s}</th>)}
                    <th className="text-center border-l border-zinc-200">專案減課</th>
                    <th className="text-center">自願超鐘</th>
                    <th className="text-center">合計節數</th>
                    <th className="text-center">目標節數</th>
                  </tr>
                </thead>
                <tbody>
                  {homeroomTeachers.length === 0 && <tr><td colSpan={subjects.length + 5} className="text-sm text-zinc-400 text-center py-3">此年級無導師資料（請先在撕榜套用工作紀錄）</td></tr>}
                  {homeroomTeachers.map(t => {
                    const sum = subjects.reduce((s, sub) => s + (Number(breakdown(t)[sub]) || 0), 0)
                    const auto = autonomousOf(t, sum)
                    const tgt = actualPeriod(t) + auto
                    const ch = t.data.scenarios?.[rkey]
                    const tag = ch?.planName ? `方案：${ch.planName}` : (ch && Object.keys(ch.breakdown).length ? '自選' : '未填')
                    // 合計<目標＝不足（紅）；合計>目標＝超鐘中（藍，超出申報意願另標）；相等＝正常
                    const deficit = sum < tgt
                    const over = Math.max(0, sum - tgt)
                    const beyond = Math.max(0, over - willingOf(t))
                    const rowBg = highlightId === t.id ? 'bg-amber-100' : deficit ? 'bg-red-50' : over > 0 ? 'bg-sky-50' : ''
                    return (
                      <tr key={t.id} id={`hr-row-${t.id}`} className={rowBg}>
                        <td className={`sticky left-0 z-10 ${rowBg || 'bg-white'}`}>
                          <div className="font-medium text-zinc-800">{t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}
                            {t.work === '代理導師' && <span className="ml-1 text-[10px] px-1 bg-sky-100 text-sky-700 border border-sky-200 rounded-sm">代理</span>}
                            {t.gradeGuessed && <span className="ml-1 text-[10px] px-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-sm" title="工作紀錄年級未填，依職稱暫列此年段（低→二、中→四、高→六）——請至工作紀錄補年級">⚠ 年級未填</span>}
                            {subEditIcon(t)}{reasonIcon(t)}{restoreIcon(t)}
                          </div>
                          <div className={`text-[10px] ${tag === '自選' ? 'text-amber-600' : tag === '未填' ? 'text-zinc-400' : 'text-zinc-500'}`}>{tag}</div>
                        </td>
                        {subjects.map(s => (
                          <td key={s} className="text-center">
                            <NumberInput min={0} value={Number(breakdown(t)[s]) || 0} onChange={n => editCell(t.id, s, n, rkey)} className="input w-11 text-center py-0.5 text-xs" />
                          </td>
                        ))}
                        <td className="text-center whitespace-nowrap border-l border-zinc-200"><span className="text-zinc-700">{t.data.projectReduction || 0}</span><button onClick={() => setProjEdit(t.id)} title="檢視／核實專案減課" className="ml-1 text-zinc-400 hover:text-sky-600">✎</button></td>
                        {/* 自願超鐘可由管理者代填：寫入「目前實際節數」鍵——老師鎖定後因核實/情境異動
                            造成實際節數改變、對不到原同意紀錄時，由管理者確認後在此補登 */}
                        <td className="text-center">
                          <NumberInput min={0} max={6} value={auto}
                            onChange={n => updateTeacher(t.id, d => ({
                              ...d,
                              autonomousOvertime: { ...(d.autonomousOvertime ?? {}), [String(actualPeriod(t))]: Math.min(6, Math.max(0, n)) },
                            }))}
                            className="input w-11 text-center py-0.5 text-xs text-sky-700" />
                        </td>
                        <td className={`text-center font-medium whitespace-nowrap ${deficit ? 'text-red-600' : over > 0 ? 'text-sky-700' : 'text-zinc-800'}`}>
                          {sum}
                          {over > 0 && <span className="ml-1 text-[10px]">+{over}{beyond > 0 && <span className="text-amber-600">（超出意願 {beyond}）</span>}</span>}
                        </td>
                        <td className="text-center text-zinc-500">{tgt}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )
      })()}

      {/* ── 科任檢視（候補式：下拉選人 + 年級×領域雙向表）── */}
      {view === 'subject' && gradeSubjectGrid(subjectTeachers, subjSel, setSubjSel, '科任')}

      {/* ── 行政檢視（候補：可跨領域×年級補課，合計需等於實際）── */}
      {view === 'admin' && gradeSubjectGrid(adminTeachers, adminSel, setAdminSel, '行政')}

      {/* ── 鐘點檢視（無減課/超鐘/鎖定，課務組直接填）── */}
      {view === 'hourly' && gradeSubjectGrid(hourlyTeachers, hourlySel, setHourlySel, '鐘點', true)}

      {/* 本土語語別課供需已併入「📊 統計資料」矩陣（青色列），此處不再重複 */}

      {/* ── 統計資料 modal：兩分頁——供需總覽（差異／師資雙模式）＋減課統計 ── */}
      {overviewOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setOverviewOpen(false)}>
          <div className="bg-white rounded-md shadow-xl w-full max-w-4xl p-5 space-y-3 max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => setOvTab('matrix')} className={tabCls(ovTab === 'matrix')}>供需總覽</button>
                <button onClick={() => setOvTab('reduction')} className={tabCls(ovTab === 'reduction')}>減課統計</button>
              </div>
              <button onClick={() => setOverviewOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
            </div>

            {ovTab === 'matrix' && (
              <>
                {/* 顯示模式切換：刻意做小、放表格上方，與上排 tab 樣式區隔 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-zinc-400">顯示</span>
                  <span className="inline-flex border border-zinc-200 rounded-full overflow-hidden text-[11px]">
                    <button onClick={() => setOvMode('diff')} className={`px-2.5 py-0.5 ${ovMode === 'diff' ? 'bg-zinc-200 text-zinc-800 font-medium' : 'bg-white text-zinc-400 hover:text-zinc-600'}`}>差異</button>
                    <button onClick={() => setOvMode('staff')} className={`px-2.5 py-0.5 ${ovMode === 'staff' ? 'bg-zinc-200 text-zinc-800 font-medium' : 'bg-white text-zinc-400 hover:text-zinc-600'}`}>師資</button>
                  </span>
                  {ovMode === 'staff' && (
                    <select
                      value={ovStaffSubj && gridSubjects.includes(ovStaffSubj) ? ovStaffSubj : gridSubjects[0] ?? ''}
                      onChange={e => setOvStaffSubj(e.target.value)}
                      className="input py-0.5 text-xs w-36">
                      {gridSubjects.map(s => <option key={s} value={s}>{s}{isExtra(s) ? '（其他）' : ''}</option>)}
                    </select>
                  )}
                  <span className="text-xs text-zinc-500">
                    {ovMode === 'diff'
                      ? <>格內＝差異（供給−需求）；滑過看明細。<b className="text-red-600">紅色缺口可點</b>，直接開補缺推薦。</>
                      : <>選領域看各年級授課老師與節數，<b>點老師名</b>直接前往其配課調整。</>}
                  </span>
                </div>

                {ovMode === 'diff' && (
                  <div className="overflow-x-auto">
                    <table className="table-base no-hover">
                      <thead>
                        <tr><th className="min-w-[8rem]">科目 / 領域</th>{GRADES.map(g => <th key={g} className="text-center">{GRADE_LABEL[g]}</th>)}</tr>
                      </thead>
                      <tbody>
                        {allSubjectsList.map(subj => (
                          <tr key={subj}>
                            <td className="font-medium">{subj}</td>
                            {GRADES.map(g => {
                              const demand = demandByGradeSubject[g]?.[subj]
                              if (demand === undefined) return <td key={g} className="text-center text-zinc-300">—</td>
                              const hs = homeroomSupply(g, subj), ss = subjectSupply(g, subj), as = adminSupply(g, subj), hh = hourlySupply(g, subj)
                              const diff = hs + ss + as + hh - demand
                              const detail = `導師 ${hs}＋科任 ${ss}＋行政 ${as}＋鐘點 ${hh}＝${hs + ss + as + hh}／需求 ${demand}`
                              const cls = diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'
                              return (
                                <td key={g} className="text-center" title={detail}>
                                  {diff < 0
                                    ? <button onClick={() => setFillGap({ grade: g, subj })} className={`font-medium underline cursor-pointer ${cls}`}>{diff}</button>
                                    : <span className={`font-medium ${cls}`}>{diff > 0 ? `+${diff}` : '✓'}</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                        {/* 本土語額外語別課（配課設定「設定二」）：需求以總節數計、只出現在有設定的年級 */}
                        {extraNames.map(lang => (
                          <tr key={lang} className="bg-teal-50/50">
                            <td className="font-medium">{lang}<span className="ml-1 text-[10px] px-1 bg-teal-100 text-teal-700 border border-teal-200 rounded-sm">其他</span></td>
                            {GRADES.map(g => {
                              const entry = extraCourses.find(c => c.lang === lang && c.grade === g)
                              if (!entry) return <td key={g} className="text-center text-zinc-300">—</td>
                              const got = extraAllocated(lang, g)
                              const diff = got - entry.hours
                              const cls = diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'
                              return (
                                <td key={g} className="text-center" title={`已配 ${got}／需求 ${entry.hours}`}>
                                  {diff < 0
                                    ? <button onClick={() => setFillGap({ grade: g, subj: lang })} className={`font-medium underline cursor-pointer ${cls}`}>{diff}</button>
                                    : <span className={`font-medium ${cls}`}>{diff > 0 ? `+${diff}` : '✓'}</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {ovMode === 'staff' && (() => {
                  // 師資檢視：一次一個領域，各年級一列直接列出授課老師（口徑同供給計算，不顯示差異）
                  const subj = ovStaffSubj && gridSubjects.includes(ovStaffSubj) ? ovStaffSubj : gridSubjects[0]
                  if (!subj) return <p className="text-sm text-zinc-400 text-center py-6">尚無領域資料。</p>
                  const rows = GRADES
                    .filter(g => isExtra(subj) ? extraOffered(subj, g) : demandByGradeSubject[g]?.[subj] !== undefined)
                    .map(g => ({
                      g,
                      list: isExtra(subj)
                        ? extraContribs(subj, g)
                        : [...homeroomContribs(g, subj), ...nonHomeroomContribs(g, subj)],
                    }))
                  return (
                    <table className="table-base no-hover">
                      <thead><tr><th className="w-20">年級</th><th>「{subj}」授課老師（節數）</th></tr></thead>
                      <tbody>
                        {rows.length === 0 && <tr><td colSpan={2} className="text-sm text-zinc-400 text-center py-4">此領域無開課年級。</td></tr>}
                        {rows.map(({ g, list }) => (
                          <tr key={g}>
                            <td className="font-medium whitespace-nowrap">{GRADE_LABEL[g]}</td>
                            <td>
                              <div className="flex flex-wrap gap-1.5 items-center py-0.5">
                                {list.length === 0
                                  ? <span className="text-zinc-300 text-xs">尚無人授課</span>
                                  : list.map(x => staffBadge(x.t, x.v))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                })()}
              </>
            )}

            {ovTab === 'reduction' && (() => {
              // 個別減課/超鐘一覽（情境減課全年級一致、已反映在目標節數，不列）。
              // 超鐘＝實際授課超過「基本−減課」的節數（導師含自願超鐘；意願加課亦計入）
              const overtimeOf = (t: TeacherStat) =>
                t.role === 'homeroom' ? Math.max(0, hrSumOf(t) - hrActualOf(t)) : overOf(t)
              const rows = teachers.filter(t => !t.isHourly)
                .map(t => ({ t, red: t.data.projectReduction || 0, over: overtimeOf(t), auto: t.role === 'homeroom' ? hrAutoOf(t, hrSumOf(t)) : 0, willing: willingOf(t) }))
                .filter(x => x.red > 0 || x.over > 0)
                .sort((a, b) => b.red - a.red || b.over - a.over || a.t.name.localeCompare(b.t.name, 'zh-Hant'))
              const totRed = rows.reduce((s, x) => s + x.red, 0)
              const totOver = rows.reduce((s, x) => s + x.over, 0)
              return (
                <>
                  <p className="text-xs text-zinc-500">全校有專案減課或超鐘的老師一覽，<b>點老師名</b>前往其配課調整。超鐘＝實際授課超過（基本−減課）的節數，導師含自願超鐘；情境減課全年級一致、不在此列。</p>
                  {rows.length === 0
                    ? <p className="text-sm text-zinc-400 text-center py-6">目前沒有老師有專案減課或超鐘。</p>
                    : <table className="table-base no-hover">
                        <thead>
                          <tr><th>教師</th><th>身分</th><th className="text-center border-l border-zinc-200">專案減課</th><th className="text-center">超鐘</th><th className="text-center">申報意願</th><th className="text-center">剩餘意願</th></tr>
                        </thead>
                        <tbody>
                          {rows.map(({ t, red, over, auto, willing }) => (
                            <tr key={t.id}>
                              <td>
                                <button onClick={() => jumpToTeacher(t)} title="前往此老師的配課統計" className="font-medium text-sky-700 hover:underline">{t.name}</button>
                                {t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}
                              </td>
                              <td className="text-xs text-zinc-500">{t.roleLabel}{t.role === 'homeroom' && t.grade ? `・${GRADE_LABEL[t.grade]}` : ''}</td>
                              <td className="text-center border-l border-zinc-200">{red > 0 ? <span className="font-medium text-zinc-800">{red}</span> : <span className="text-zinc-300">—</span>}</td>
                              <td className="text-center whitespace-nowrap">
                                {over > 0
                                  ? <span className="font-medium text-sky-700">+{over}{auto > 0 && <span className="ml-1 text-[10px] font-normal text-zinc-400">（自願 {auto}）</span>}</span>
                                  : <span className="text-zinc-300">—</span>}
                              </td>
                              <td className="text-center text-zinc-500">{willing || '—'}</td>
                              <td className="text-center text-zinc-500">{willing ? Math.max(0, remainingOf(t)) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-zinc-200">
                            <td className="text-xs font-semibold text-zinc-600">合計 {rows.length} 位</td>
                            <td></td>
                            <td className="text-center font-semibold text-zinc-800 border-l border-zinc-200">{totRed}</td>
                            <td className="text-center font-semibold text-sky-700">{totOver > 0 ? `+${totOver}` : '—'}</td>
                            <td></td><td></td>
                          </tr>
                        </tfoot>
                      </table>}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── 差異缺口 → 超鐘推薦 modal：依支援順序＋剩餘意願排序，一鍵 +1 ── */}
      {fillGap && (() => {
        const { grade, subj } = fillGap
        const extraEntry = isExtra(subj) ? extraCourses.find(c => c.lang === subj && c.grade === grade) : undefined
        const gap = extraEntry
          ? extraEntry.hours - extraAllocated(subj, grade)
          : (demandByGradeSubject[grade]?.[subj] ?? 0)
            - homeroomSupply(grade, subj) - subjectSupply(grade, subj) - adminSupply(grade, subj) - hourlySupply(grade, subj)
        const rk = String(adoptedByGrade[grade] ?? 0)
        // 候選：意願科目含此科（語別課另認「本土語」意願）；導師限同年級（學校無跨年級導師支援）、語別課不列導師（本班配課放不下）
        const wishHit = (t: TeacherStat) => wishesOf(t).includes(subj) || (isExtra(subj) && wishesOf(t).includes('本土語'))
        const wishRank = (t: TeacherStat) => { const i = wishesOf(t).indexOf(subj); return i >= 0 ? i : wishesOf(t).indexOf('本土語') }
        const cands = teachers
          .filter(t => wishHit(t) && (t.role !== 'homeroom' || (t.grade === grade && !isExtra(subj))))
          .map(t => ({ t, rank: wishRank(t), remaining: remainingOf(t) }))
        const ready = cands.filter(c => c.remaining > 0).sort((a, b) => a.rank - b.rank || b.remaining - a.remaining)
        const spent = cands.filter(c => c.remaining <= 0).sort((a, b) => a.rank - b.rank)
        const addOne = (t: TeacherStat) => {
          if (t.role === 'homeroom') {
            const bd = t.data.scenarios?.[rk]?.breakdown ?? {}
            editCell(t.id, subj, (Number(bd[subj]) || 0) + 1, rk)
          } else {
            editSubjectGradeHours(t.id, subj, grade, (Number(t.data.subjectGradeHours?.[subj]?.[String(grade)]) || 0) + 1)
          }
        }
        const row = (c: { t: TeacherStat; rank: number; remaining: number }, exhausted: boolean) => (
          <div key={c.t.id} className={`flex items-center gap-2 flex-wrap border rounded-sm px-3 py-1.5 ${exhausted ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-200'}`}>
            <button
              onClick={() => {
                if (exhausted && !confirm(`「${c.t.name}」的申報意願已用罄。確定已私下取得老師同意再多超 1 節？`)) return
                addOne(c.t)
              }}
              className={`text-sm px-2.5 py-1 rounded-sm border flex-shrink-0 ${exhausted
                ? 'bg-white text-zinc-500 border-zinc-300 hover:border-amber-400'
                : 'bg-sky-600 text-white border-sky-600 hover:bg-sky-500'}`}>
              {c.t.name} +1
            </button>
            <span className="text-xs text-zinc-500">{c.t.roleLabel}</span>
            <span className="text-xs text-zinc-400">支援順位 第{c.rank + 1}</span>
            <span className={`text-xs ${exhausted ? 'text-amber-600' : 'text-zinc-600'}`}>
              剩餘意願 {Math.max(0, c.remaining)}／{willingOf(c.t)}
            </span>
            {overOf(c.t) > 0 && <span className="text-xs text-sky-600">已超鐘 {overOf(c.t)}</span>}
          </div>
        )
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setFillGap(null)}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-900">{GRADE_LABEL[grade]}「{subj}」補缺</h3>
                  <p className="text-xs text-zinc-500">
                    尚缺 <b className={gap > 0 ? 'text-red-600' : 'text-green-700'}>{Math.max(0, gap)}</b> 節。
                    按老師名字＋1 即加到其配課（導師加本班該科、科任/行政加該科×{GRADE_LABEL[grade]}），剩餘意願自動遞減；填錯直接到統計表把節數改回即可。
                  </p>
                </div>
                <button onClick={() => setFillGap(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>
              {gap <= 0 && <p className="text-sm text-green-700">✓ 此科缺口已補滿。</p>}
              {ready.length === 0 && spent.length === 0 && <p className="text-sm text-zinc-400">沒有老師的意願超鐘支援科目包含「{subj}」——請直接於統計表調整節數。</p>}
              {ready.length > 0 && <div className="space-y-1.5">{ready.map(c => row(c, false))}</div>}
              {spent.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-400 pt-1">已無剩餘意願（需先私下取得同意）</p>
                  {spent.map(c => row(c, true))}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── LINE 提醒訊息 modal（帶入目前分頁未鎖定老師）── */}
      {remindOpen && (() => {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const link = `${origin}/teacher/allocation`
        const groupMsg = `【配課選填提醒】\n提醒以下老師：${year} 學年度配課選填尚未完成「送出並鎖定」——\n${unlockedTeachers.map(t => `${t.name}老師`).join('、')}\n再麻煩抽空登入系統完成填寫，並於最後一步按「送出並鎖定」：\n${link}\n已填寫者也請記得完成最後的送出，謝謝大家！`
        const oneMsg = (name: string) => `【配課選填提醒】\n${name}老師您好：\n${year} 學年度配課選填還差最後的「送出並鎖定」尚未完成。\n再麻煩您抽空登入系統，完成各步驟後於最後一步按「送出並鎖定」：\n${link}\n操作上有任何問題都可以直接跟我說，謝謝您！`
        async function copy(key: string, text: string) {
          try { await navigator.clipboard.writeText(text) } catch { window.prompt('自動複製失敗，請手動全選複製：', text); return }
          setCopiedKey(key); setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500)
        }
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRemindOpen(false)}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-900">LINE 提醒訊息</h3>
                  <p className="text-xs text-zinc-500">{scopeInfo.label} · 未鎖定 {unlockedTeachers.length} 位。複製後貼到 LINE 即可。</p>
                </div>
                <button onClick={() => setRemindOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-500">群發版（貼到群組，一次提醒全部）</div>
                  <button onClick={() => copy('all', groupMsg)} className="btn-secondary text-xs">{copiedKey === 'all' ? '✓ 已複製' : '複製'}</button>
                </div>
                <pre className="text-xs text-zinc-700 whitespace-pre-wrap bg-zinc-50 border border-zinc-200 rounded-sm px-3 py-2">{groupMsg}</pre>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-zinc-500">個別版（一對一私訊）</div>
                {unlockedTeachers.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-2 border border-zinc-200 rounded-sm px-3 py-1.5">
                    <span className="text-sm text-zinc-700">{t.name}</span>
                    <button onClick={() => copy(t.id, oneMsg(t.name))} className="btn-secondary text-xs flex-shrink-0">{copiedKey === t.id ? '✓ 已複製' : '複製訊息'}</button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-1"><button onClick={() => setRemindOpen(false)} className="btn-primary text-sm">完成</button></div>
            </div>
          </div>
        )
      })()}

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

      {/* ── 代理教師身分/年級調整 modal（身分存於配課資料，選錯由管理者修正）── */}
      {subEdit && (() => {
        const t = teachers.find(x => x.id === subEdit)
        if (!t) return null
        async function save() {
          if (!t) return
          const data = {
            ...t.data,
            role: subRole,
            grade: subRole === 'homeroom' ? subGrade : null,
            work: subRole === 'homeroom' ? '代理導師' : '代理科任',
          }
          setTeachers(ts => ts.map(x => (x.id === t.id ? { ...x, data } : x)))
          setSubEdit(null)
          setSavingId(t.id)
          try {
            await fetch('/api/admin/allocation', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teacher_id: t.id, data }),
            })
          } finally { setSavingId(null) }
          router.refresh()   // 身分/年級/基本節數由伺服器 props 重算，刷新後移到正確分頁
        }
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSubEdit(null)}>
            <div className="bg-white rounded-md shadow-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-zinc-900">{t.name} · 代理身分調整</h3>
                  <p className="text-xs text-zinc-500">代理教師的身分／年級由其配課選填自選，選錯時由管理者在此修正。</p>
                </div>
                <button onClick={() => setSubEdit(null)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={subRole === 'homeroom'} onChange={() => setSubRole('homeroom')} />代理導師
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={subRole === 'subject'} onChange={() => setSubRole('subject')} />代理科任
                </label>
                {subRole === 'homeroom' && (
                  <select value={subGrade} onChange={e => setSubGrade(Number(e.target.value))} className="input py-1 text-sm w-28">
                    {GRADES.map(g => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}
                  </select>
                )}
              </div>
              <p className="text-[11px] text-zinc-400">已填的配課節數（各方案／年級×領域）會保留；儲存後名單移至對應分頁、基本節數依新身分重算。</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setSubEdit(null)} className="btn-secondary text-sm">取消</button>
                <button onClick={save} className="btn-primary text-sm">儲存</button>
              </div>
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
                  <NumberInput min={0} value={p.hours} onChange={n => setProjs(projs.map((x, idx) => idx === i ? { ...x, hours: Math.max(0, n) } : x))} className="input w-14 text-center py-0.5" />
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
