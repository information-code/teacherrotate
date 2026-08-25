'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { HOMEROOM_SELF, subjectClassKey, classKey, classLabel, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL } from '@/lib/allocation'
import type { GradeSubject, HomeroomTeacher, SubjectTeacher } from './page'

interface Props {
  config: ScheduleConfig
  setConfig: Dispatch<SetStateAction<ScheduleConfig>>
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  subjectTeachers: SubjectTeacher[]
  homerooms: HomeroomTeacher[]
  homeroomSupply: Record<number, Record<string, number>>   // 導師自上供給（年級→科目→節數）
  homeroomBreakdown: Record<string, Record<string, number>> // 各導師自上節數（teacherId→科目→節數）
  avoidMap: Record<string, number[]>   // 排課需求—避開子女就讀年段：teacherId → 年級
  allNames: Record<string, string>     // 全教師名單（含已不具身分者）：顯示殘留指派用
  year: number
}

/** 換授課老師的檢查結果（伺服器算的）。改配班只動設定，課表還是印著舊老師——
 *  課表才是全校在看的那一份，所以要問一句、順便把課表一起換掉。 */
interface SwapInfo {
  classLabel: string; subject: string
  fromNames: string[]; toName: string
  lessons: { id: string; slots: string[]; size: number; parity: string; teacherName: string }[]
  problems: string[]; notes: string[]
  canSync: boolean
  grade: number; index: number; to: string
}

/** 分頁三：科任配班。從配課結果（科目×年級×節數）帶入可授課教師，指派各班；可手動改派任何科任／行政。 */
export default function SubjectAssignTab({ config, setConfig, classCounts, gradeSubjects, subjectTeachers, homerooms, homeroomSupply, homeroomBreakdown, avoidMap, allNames, year }: Props) {
  const firstGrade = GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1
  const [grade, setGrade] = useState<number>(firstGrade)
  const [showAll, setShowAll] = useState(false)
  // ── 換授課老師：課表上已經有這一班這一科的課時，順便把課表一起換掉 ──
  const [swap, setSwap] = useState<SwapInfo | null>(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const [swapErr, setSwapErr] = useState('')
  const slotZh = (s: string) => `週${'一二三四五六日'[Number(s.split('-')[0]) - 1]}第${s.split('-')[1]}節`
  const lessonZh = (l: SwapInfo['lessons'][number]) =>
    (l.slots.length > 1
      ? `週${'一二三四五六日'[Number(l.slots[0].split('-')[0]) - 1]}第${l.slots.map(s => s.split('-')[1]).join('、')}節`
      : slotZh(l.slots[0]))
    + (l.parity ? `（${l.parity === 'odd' ? '單' : '雙'}週）` : '')

  /** 改配班：課表上沒課就直接改；有課就先問伺服器能不能一起換。 */
  async function requestAssign(g: number, index: number, subject: string, teacherId: string) {
    setSwapBusy(true); setSwapErr('')
    try {
      const res = await fetch(`/api/admin/subject-teacher-swap?year=${year}&grade=${g}&index=${index}&subject=${encodeURIComponent(subject)}&to=${teacherId}`)
      const d = await res.json()
      // 沒課可換、也沒有要提醒的事（如改成導師自上但課表上還有科任課）→ 照舊直接改
      if (!res.ok || (!d.canSync && !d.notes?.length)) { setAssign(g, index, subject, teacherId); return }
      setSwap({ ...d, grade: g, index, to: teacherId })
    } catch { setAssign(g, index, subject, teacherId) } finally { setSwapBusy(false) }
  }
  /** 只改設定不動課表——課表上那幾堂維持原老師（下次重跑排課才會照新配班）。 */
  function swapConfigOnly() {
    if (!swap) return
    setAssign(swap.grade, swap.index, swap.subject, swap.to)
    setSwap(null)
  }
  async function swapConfirm() {
    if (!swap) return
    setSwapBusy(true); setSwapErr('')
    try {
      const res = await fetch('/api/admin/subject-teacher-swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, grade: swap.grade, index: swap.index, subject: swap.subject, to: swap.to }),
      })
      const d = await res.json()
      if (!res.ok) { setSwapErr(d.error ?? '換人失敗'); return }
      setAssign(swap.grade, swap.index, swap.subject, swap.to)
      setSwap(null)
      alert(`已換人：${swap.classLabel} ${swap.subject} ${d.count} 堂改由 ${d.toName} 上課，時間與教室不變。`)
    } finally { setSwapBusy(false) }
  }

  const nameOf = (id: string) => subjectTeachers.find(t => t.id === id)?.name ?? homerooms.find(h => h.id === id)?.name ?? '？'
  const hoursOf = (t: SubjectTeacher, subj: string, g: number) => Number(t.hours[subj]?.[String(g)]) || 0
  const supply = (subj: string, g: number) => subjectTeachers.reduce((s, t) => s + hoursOf(t, subj, g), 0)
  const hrSupply = (subj: string, g: number) => Number(homeroomSupply[g]?.[subj]) || 0
  /** 該班該科「科任要排的節數」＝每班節數 − 該班導師自上（同科分擔，如生活 6＝導師 4＋科任 2）；與引擎同口徑（鎖課另扣，此處略）。 */
  function classNeed(g: number, index: number, subj: string, perClass: number) {
    const tid = config.classTeacher[classKey(g, index)] ?? ''
    const self = tid ? Number(homeroomBreakdown[tid]?.[subj]) || 0 : 0
    return Math.max(0, perClass - self)
  }
  /** 某老師在某科某年級已被指派的「節數」（各班需求加總，非班數）。 */
  function assignedHours(tid: string, subj: string, g: number, perClass: number) {
    const count = classCounts[g] ?? 0
    let n = 0
    for (let i = 0; i < count; i++) if (config.subjectClassTeacher[subjectClassKey(g, i, subj)] === tid) n += classNeed(g, i, subj, perClass)
    return n
  }

  function setAssign(g: number, index: number, subject: string, teacherId: string) {
    setConfig(c => {
      const next = { ...c.subjectClassTeacher }
      const k = subjectClassKey(g, index, subject)
      if (teacherId) next[k] = teacherId; else delete next[k]
      return { ...c, subjectClassTeacher: next }
    })
  }

  /** 某老師在某科某年級已被指派的班數。 */
  function assignedCount(tid: string, subj: string, g: number) {
    const count = classCounts[g] ?? 0
    let n = 0
    for (let i = 0; i < count; i++) if (config.subjectClassTeacher[subjectClassKey(g, i, subj)] === tid) n++
    return n
  }

  /** 自動分配：未指定的班依「剩餘容量」由節數多的老師依序認領。 */
  function autoAssign(g: number, subj: string, perClass: number) {
    if (perClass <= 0) return
    const count = classCounts[g] ?? 0
    const eligible = subjectTeachers
      .filter(t => hoursOf(t, subj, g) > 0)
      .sort((a, b) => hoursOf(b, subj, g) - hoursOf(a, subj, g))
    setConfig(c => {
      const next = { ...c.subjectClassTeacher }
      // 剩餘節數＝配課節數 − 已指派各班需求
      const left: Record<string, number> = {}
      for (const t of eligible) left[t.id] = hoursOf(t, subj, g)
      for (let i = 0; i < count; i++) {
        const cur = next[subjectClassKey(g, i, subj)]
        if (cur && cur in left) left[cur] -= classNeed(g, i, subj, perClass)
      }
      for (let i = 0; i < count; i++) {
        const k = subjectClassKey(g, i, subj)
        if (next[k]) continue
        const need = classNeed(g, i, subj, perClass)
        if (need <= 0) continue
        const t = eligible.find(x => (left[x.id] ?? 0) >= need)
        if (t) { next[k] = t.id; left[t.id] -= need }
      }
      return { ...c, subjectClassTeacher: next }
    })
  }

  const count = classCounts[grade] ?? 0
  const subjects = (gradeSubjects[grade] ?? []).filter(s =>
    s.perClass > 0 && (showAll || !s.homeroom || supply(s.name, grade) > 0))

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        依配課結果（科目 × 年級 × 節數）列出有配到該科該年級的教師（含科任／行政／鐘點）。
        <b>預設「隨機」＝排課精靈依配課節數自動分配</b>，只有要固定某班由誰上時才指定；有指定則排課必用該師。
        「導師自上」＝該班該科由導師授課、不派科任。已派滿容量的老師不再出現在下拉。
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {GRADES.map(g => (
          <button key={g} onClick={() => setGrade(g)}
            className={`btn text-sm py-1 ${g === grade ? 'btn-primary' : 'btn-secondary'}`}>
            {GRADE_LABEL[g]}<span className="ml-1 text-[10px] opacity-70">{classCounts[g] ?? 0}班</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          顯示全部科目
        </label>
      </div>

      {(() => {
        const avoided = subjectTeachers.filter(t => avoidMap[t.id]?.includes(grade))
        return avoided.length > 0 && (
          <p className="text-[11px] text-amber-600">
            ⚠ 排課需求—子女就讀{GRADE_LABEL[grade]}：{avoided.map(t => t.name).join('、')}（選擇時請留意，仍可指派）
          </p>
        )
      })()}

      {count === 0
        ? <div className="card text-sm text-zinc-400 text-center py-6">{GRADE_LABEL[grade]}尚未於配課設定設定班級數。</div>
        : subjects.length === 0
          ? <div className="card text-sm text-zinc-400 text-center py-6">此年級沒有需要科任配班的科目（可勾選「顯示全部科目」檢視）。</div>
          : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {subjects.map(s => {
                const total = supply(s.name, grade)
                const demand = count * s.perClass
                const hr = hrSupply(s.name, grade)
                const short = hr + total < demand
                const eligible = subjectTeachers
                  .filter(t => hoursOf(t, s.name, grade) > 0)
                  .sort((a, b) => hoursOf(b, s.name, grade) - hoursOf(a, s.name, grade))
                return (
                  <div key={s.name} className="card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-zinc-700">{s.name}
                        <span className="text-xs font-normal text-zinc-400 ml-1">每班 {s.perClass} 節</span>
                      </div>
                      <button onClick={() => autoAssign(grade, s.name, s.perClass)} className="btn btn-secondary text-xs py-0.5">自動分配</button>
                    </div>
                    {/* 供需說明與配課統計同口徑：導師自上＋科任/行政/鐘點；只有總和不足才警示 */}
                    <div className={`text-[11px] ${short ? 'text-amber-600' : 'text-zinc-400'}`}>
                      需求 {demand} 節（{count} 班）｜{hr > 0 && <>導師自上 {hr}＋</>}科任 {total} 節{short && `，不足 ${demand - hr - total}`}
                    </div>
                    <div className="space-y-1">
                      {Array.from({ length: count }, (_, i) => {
                        const k = subjectClassKey(grade, i, s.name)
                        const val = config.subjectClassTeacher[k] ?? ''
                        const homeroomName = nameOf(config.classTeacher[classKey(grade, i)] ?? '')
                        const warned = Boolean(val && val !== HOMEROOM_SELF && avoidMap[val]?.includes(grade))
                        // 殘留指派：存的值已不在科任／行政名單（如異動、離職）→ 如實顯示並標紅
                        const stale = Boolean(val && val !== HOMEROOM_SELF && !subjectTeachers.some(t => t.id === val))
                        const warnOf = (tid: string) => avoidMap[tid]?.includes(grade)
                        // 選滿即隱藏：已派節數 ≥ 配課節數即消失（節數口徑：各班需求＝每班節數 − 該班導師自上）；當前選中者仍顯示
                        const need = classNeed(grade, i, s.name, s.perClass)
                        const eligibleVisible = eligible.filter(t => t.id === val || assignedHours(t.id, s.name, grade, s.perClass) + need <= hoursOf(t, s.name, grade))
                        return (
                          <label key={i} className="flex items-center gap-2 text-sm">
                            <span className="text-zinc-600 w-14 flex-shrink-0">{classLabel(grade, i)}{need !== s.perClass && <span className="block text-[10px] text-zinc-400 leading-none">科任 {need} 節</span>}</span>
                            <select value={val} onChange={e => void requestAssign(grade, i, s.name, e.target.value)}
                              className={`input py-1 text-sm flex-1 min-w-0 ${stale ? 'border-red-400 text-red-700 bg-red-50' : warned ? 'border-amber-400 text-amber-700 bg-amber-50' : ''}`}>
                              <option value="">隨機（精靈自動分配）</option>
                              <option value={HOMEROOM_SELF}>導師自上{homeroomName !== '？' ? `（${homeroomName}）` : ''}</option>
                              {stale && <option value={val}>⚠ {allNames[val] ?? '未知帳號'}（已不具科任／行政身分，請改選）</option>}
                              {eligibleVisible.map(t => <option key={t.id} value={t.id} style={warnOf(t.id) ? { color: '#b45309' } : undefined}>{t.name}（{hoursOf(t, s.name, grade)}節）{warnOf(t.id) ? '⚠ 子女在此年段' : ''}</option>)}
                            </select>
                          </label>
                        )
                      })}
                    </div>
                    {eligible.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t border-zinc-100">
                        {eligible.map(t => {
                          const cap = hoursOf(t, s.name, grade)
                          const used = assignedHours(t.id, s.name, grade, s.perClass)
                          const cls = assignedCount(t.id, s.name, grade)
                          const over = used > cap
                          return (
                            <span key={t.id} title={`已指派 ${cls} 班、${used} 節／配課 ${cap} 節`}
                              className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${over ? 'bg-red-50 text-red-600 border-red-200' : used === cap ? 'bg-zinc-100 text-zinc-500 border-zinc-200' : 'bg-white text-zinc-500 border-zinc-200'}`}>
                              {t.name} {used}/{cap} 節{cls > 0 && `・${cls} 班`}{over && '（超派）'}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

      {/* 換授課老師：課表上已經有課，問一句要不要一起換。
          只改設定的話，全校看到的課表還是舊老師——那才是真正會出事的地方。 */}
      {swap && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !swapBusy && setSwap(null)}>
          <div className="card w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-semibold">換授課老師</h3>
              <button type="button" onClick={() => setSwap(null)} disabled={swapBusy}
                className="ml-auto text-zinc-400 hover:text-zinc-700 text-sm">✕</button>
            </div>
            <div className="text-sm font-medium text-zinc-800 bg-zinc-50 border border-zinc-200 rounded-sm px-3 py-2">
              {swap.classLabel}　{swap.subject}
              <div className="text-zinc-500 text-xs mt-0.5">{swap.fromNames.join('、') || '未指定'}　→　{swap.toName || (swap.to ? '導師自上' : '隨機')}</div>
            </div>
            <div className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-sm px-3 py-2 space-y-1">
              <div className="font-medium text-zinc-700">課表上這一班的{swap.subject}有 {swap.lessons.length} 堂：</div>
              {swap.lessons.map(l => <div key={l.id}>・{lessonZh(l)}</div>)}
              <div className="text-zinc-400 pt-0.5">上課時間、班級、教室都不動，只換人。</div>
            </div>
            {!swap.canSync ? null
              : swap.problems.length > 0
                ? <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2 space-y-0.5">
                    <div className="font-medium">✗ 不能換：</div>
                    {swap.problems.map((x, k) => <div key={k}>・{x}</div>)}
                    <div className="pt-1">請先到排課精靈的人工調課，把擋路的那一堂挪開，再回來換。</div>
                  </div>
                : <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-sm px-3 py-2">
                    ✓ {swap.toName} 這幾節都有空，教室與時間不受影響。
                  </div>}
            {swap.notes.map((n, k) => (
              <div key={k} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-sm px-3 py-2">⚠ {n}</div>
            ))}
            {swapErr && <div className="text-xs text-red-600">{swapErr}</div>}
            <div className="flex gap-2 justify-end pt-1 flex-wrap">
              <button type="button" onClick={() => setSwap(null)} disabled={swapBusy}
                className="btn btn-secondary text-sm">取消</button>
              <button type="button" onClick={swapConfigOnly} disabled={swapBusy}
                title="課表上那幾堂維持原老師，下次重跑排課才會照新配班"
                className={`btn text-sm ${swap.canSync ? 'btn-secondary' : 'btn-primary'}`}>
                {swap.canSync ? '只改設定' : '知道了，只改設定'}
              </button>
              {swap.canSync && (
                <button type="button" onClick={swapConfirm} disabled={swapBusy || swap.problems.length > 0}
                  className="btn btn-primary text-sm">{swapBusy ? '處理中…' : '連課表一起換'}</button>
              )}
            </div>
          </div>
        </div>
      )}
      {swapBusy && !swap && <div className="fixed bottom-4 right-4 text-xs text-zinc-400 bg-white border border-zinc-200 rounded-sm px-2 py-1">檢查中…</div>}
    </div>
  )
}
