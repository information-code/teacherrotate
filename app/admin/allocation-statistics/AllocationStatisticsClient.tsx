'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { NumberInput } from '@/components/ui/NumberInput'
import { GRADES, GRADE_LABEL, REDUCTIONS, REDUCTION_LABEL, adminKind, ADMIN_KIND_ORDER, subjectAreaOf, type Reduction } from '@/lib/allocation'
import type { TeacherStat, GradeMeta } from './page'

interface Props {
  year: number
  phase: 'open' | 'closed'
  teachers: TeacherStat[]
  gradesMeta: Record<number, GradeMeta>
  demandBySubject: Record<string, number>
}

export default function AllocationStatisticsClient({ year, phase, teachers: initial, gradesMeta, demandBySubject }: Props) {
  const router = useRouter()
  const [teachers, setTeachers] = useState<TeacherStat[]>(initial)
  const [grade, setGrade] = useState<number>(1)
  const [reduction, setReduction] = useState<Reduction>(0)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function setPhase(next: 'open' | 'closed') {
    const msg = next === 'closed'
      ? `截止 ${year} 學年度配課？\n\n老師端的配課選填將立即轉為唯讀，無法再修改。`
      : `重新開放 ${year} 學年度配課？\n\n老師端將恢復可填寫。`
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

  const rkey = String(reduction)
  const meta = gradesMeta[grade]
  const subjects = meta?.subjects ?? []
  const homeroomTeachers = teachers.filter(t => t.role === 'homeroom' && t.grade === grade)
  const subjectTeachers = teachers.filter(t => t.role === 'subject')
  const adminTeachers = teachers.filter(t => t.role === 'admin')
    .sort((a, b) => ADMIN_KIND_ORDER[adminKind(a.work)] - ADMIN_KIND_ORDER[adminKind(b.work)])

  // 科任/行政實際節數（無減課）
  function noReduce(t: TeacherStat) { return (t.base ?? 0) - (t.data.projectReduction || 0) + (t.data.extraHours || 0) }

  // 全校各領域供需：需求(全校) vs 導師供給(全年級該科，選定情境) + 科任供給(該領域科任，無減課)
  const supplyRows = Array.from(new Set([
    ...Object.keys(demandBySubject),
    ...subjectTeachers.map(t => subjectAreaOf(t.work)),
  ])).filter(Boolean).map(subj => {
    const demand = demandBySubject[subj] ?? 0
    const homeroomSupply = teachers.filter(t => t.role === 'homeroom')
      .reduce((s, t) => s + (Number(t.data.scenarios?.[rkey]?.breakdown?.[subj]) || 0), 0)
    const subjectSupply = subjectTeachers.filter(t => subjectAreaOf(t.work) === subj)
      .reduce((s, t) => s + noReduce(t), 0)
    const supply = homeroomSupply + subjectSupply
    return { subj, demand, homeroomSupply, subjectSupply, supply, diff: supply - demand }
  }).filter(r => r.demand > 0 || r.supply > 0)

  function breakdown(t: TeacherStat) { return t.data.scenarios?.[rkey]?.breakdown ?? {} }
  function rowSum(t: TeacherStat) { return subjects.reduce((s, sub) => s + (Number(breakdown(t)[sub]) || 0), 0) }
  function target(t: TeacherStat) { return (t.base ?? 0) - reduction - (t.data.projectReduction || 0) + (t.data.extraHours || 0) }

  // 各科：教師選擇加總
  const choiceSum: Record<string, number> = {}
  for (const sub of subjects) choiceSum[sub] = homeroomTeachers.reduce((s, t) => s + (Number(breakdown(t)[sub]) || 0), 0)
  const demandMap: Record<string, number> = Object.fromEntries((meta?.demand ?? []).map(d => [d.subject, d.total]))

  function editCell(id: string, sub: string, val: number) {
    updateTeacher(id, d => {
      const cur = d.scenarios?.[rkey] ?? { planName: null, breakdown: {} }
      return { ...d, scenarios: { ...d.scenarios, [rkey]: { planName: null, breakdown: { ...cur.breakdown, [sub]: val } } } }
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">配課統計 <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
            {phase === 'open'
              ? <span className="ml-2 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-sm">填報中</span>
              : <span className="ml-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-sm">已截止</span>}
          </h2>
          <p className="text-xs text-zinc-400">篩選年級與情境，檢視各教師配課明細；可直接編輯（最高權限，含已鎖定者）。下方比對各領域需求與選擇加總。</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {savingId && <span className="text-xs text-zinc-500">儲存中…</span>}
          {phase === 'open'
            ? <button onClick={() => setPhase('closed')} disabled={busy} className="btn-primary text-sm">{busy ? '處理中…' : '截止配課'}</button>
            : <button onClick={() => setPhase('open')} disabled={busy} className="btn-secondary text-sm">{busy ? '處理中…' : '重新開放配課'}</button>}
        </div>
      </div>

      {/* 篩選 */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {GRADES.map(g => (
            <button key={g} onClick={() => setGrade(g)}
              className={`px-3 py-1 text-sm rounded-sm border ${grade === g ? 'bg-zinc-800 text-white border-zinc-800' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'}`}>
              {GRADE_LABEL[g]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">情境</span>
          <select value={reduction} onChange={e => setReduction(Number(e.target.value) as Reduction)} className="input py-1 text-sm w-28">
            {REDUCTIONS.map(r => <option key={r} value={r}>{REDUCTION_LABEL[r]}</option>)}
          </select>
        </div>
      </div>

      {/* 導師配課表 */}
      <div className="card p-0 overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 min-w-[8rem]">{GRADE_LABEL[grade]}導師</th>
              {subjects.map(s => <th key={s} className="text-center whitespace-nowrap">{s}</th>)}
              <th className="text-center">合計</th>
              <th className="text-center">目標</th>
              <th className="text-center">專案<br />減課</th>
              <th className="text-center">超<br />鐘點</th>
            </tr>
          </thead>
          <tbody>
            {homeroomTeachers.length === 0 && (
              <tr><td colSpan={subjects.length + 5} className="text-sm text-zinc-400 text-center py-3">此年級無導師資料（請先在撕榜套用工作紀錄）</td></tr>
            )}
            {homeroomTeachers.map(t => {
              const sum = rowSum(t); const tgt = target(t)
              const ch = t.data.scenarios?.[rkey]
              const tag = ch?.planName ? `方案：${ch.planName}` : (ch && Object.keys(ch.breakdown).length ? '自選' : '未填')
              return (
                <tr key={t.id}>
                  <td className="sticky left-0 bg-white z-10">
                    <div className="font-medium text-zinc-800">{t.name}{t.data.locked && <span title="已鎖定" className="ml-1 text-[10px]">🔒</span>}</div>
                    <div className={`text-[10px] ${tag === '自選' ? 'text-amber-600' : tag === '未填' ? 'text-zinc-400' : 'text-zinc-500'}`}>{tag}</div>
                  </td>
                  {subjects.map(s => (
                    <td key={s} className="text-center">
                      <NumberInput min={0} value={Number(breakdown(t)[s]) || 0}
                        onChange={n => editCell(t.id, s, n)} className="input w-11 text-center py-0.5 text-xs" />
                    </td>
                  ))}
                  <td className={`text-center font-medium ${sum === tgt ? 'text-green-700' : 'text-amber-600'}`}>{sum}</td>
                  <td className="text-center text-zinc-500">{tgt}</td>
                  <td className="text-center">
                    <NumberInput min={0} value={t.data.projectReduction || 0}
                      onChange={n => updateTeacher(t.id, d => ({ ...d, projectReduction: n }))} className="input w-10 text-center py-0.5 text-xs" />
                  </td>
                  <td className="text-center">
                    <NumberInput min={0} value={t.data.extraHours || 0}
                      onChange={n => updateTeacher(t.id, d => ({ ...d, extraHours: n }))} className="input w-10 text-center py-0.5 text-xs" />
                  </td>
                </tr>
              )
            })}
          </tbody>
          {homeroomTeachers.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200">
                <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">選擇加總</td>
                {subjects.map(s => <td key={s} className="text-center font-medium">{choiceSum[s]}</td>)}
                <td colSpan={4}></td>
              </tr>
              <tr>
                <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">需求（設定一）</td>
                {subjects.map(s => <td key={s} className="text-center text-zinc-500">{demandMap[s] ?? 0}</td>)}
                <td colSpan={4}></td>
              </tr>
              <tr>
                <td className="sticky left-0 bg-white z-10 text-xs font-semibold text-zinc-600">差異</td>
                {subjects.map(s => {
                  const diff = (choiceSum[s] ?? 0) - (demandMap[s] ?? 0)
                  const cls = diff === 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-amber-600'
                  return <td key={s} className={`text-center text-xs font-medium ${cls}`}>{diff > 0 ? `+${diff}` : diff}{diff < 0 ? '（不足）' : diff > 0 ? '（超過）' : ''}</td>
                })}
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* 全校領域供需（導師+科任一起算） */}
      <div className="card p-0 overflow-x-auto">
        <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">全校領域供需
          <span className="text-xs font-normal text-zinc-400 ml-2">導師假設皆為「{REDUCTION_LABEL[reduction]}」加總；科任以無減課計（行政不綁領域，不計入供給）</span>
        </div>
        <table className="table-base mt-2">
          <thead><tr><th>領域</th><th className="text-center">需求(全校)</th><th className="text-center">導師供給</th><th className="text-center">科任供給</th><th className="text-center">合計供給</th><th className="text-center">差異</th></tr></thead>
          <tbody>
            {supplyRows.length === 0 && <tr><td colSpan={6} className="text-sm text-zinc-400 text-center py-3">尚無資料（請先設定需求並讓老師配課）</td></tr>}
            {supplyRows.map(r => {
              const cls = r.diff === 0 ? 'text-green-700' : r.diff < 0 ? 'text-red-600' : 'text-amber-600'
              return (
                <tr key={r.subj}>
                  <td className="font-medium">{r.subj}</td>
                  <td className="text-center text-zinc-500">{r.demand}</td>
                  <td className="text-center">{r.homeroomSupply}</td>
                  <td className="text-center">{r.subjectSupply}</td>
                  <td className="text-center font-medium">{r.supply}</td>
                  <td className={`text-center font-medium ${cls}`}>{r.diff > 0 ? `+${r.diff}` : r.diff}{r.diff < 0 ? '（不足）' : r.diff > 0 ? '（超支）' : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 科任 */}
      <div className="card p-0 overflow-x-auto">
        <div className="px-4 pt-3 text-sm font-semibold text-zinc-700">科任 節數（無減課）</div>
        <table className="table-base mt-2">
          <thead><tr><th>教師</th><th>領域</th><th className="text-center">基本</th><th className="text-center">專案減課</th><th className="text-center">超鐘點</th><th className="text-center">實際授課節數</th></tr></thead>
          <tbody>
            {subjectTeachers.length === 0 && <tr><td colSpan={6} className="text-sm text-zinc-400 text-center py-3">無科任資料</td></tr>}
            {subjectTeachers.map(t => (
              <tr key={t.id}>
                <td className="font-medium text-zinc-800">{t.name}{t.data.locked && <span className="ml-1 text-[10px]">🔒</span>}</td>
                <td className="text-zinc-600">{subjectAreaOf(t.work)}</td>
                <td className="text-center text-zinc-500">{t.base ?? '—'}</td>
                <td className="text-center"><NumberInput min={0} value={t.data.projectReduction || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, projectReduction: n }))} className="input w-12 text-center py-0.5 text-xs" /></td>
                <td className="text-center"><NumberInput min={0} value={t.data.extraHours || 0} onChange={n => updateTeacher(t.id, d => ({ ...d, extraHours: n }))} className="input w-12 text-center py-0.5 text-xs" /></td>
                <td className="text-center font-medium text-zinc-900">{noReduce(t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 行政（校長→主任→組長） */}
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
    </div>
  )
}
