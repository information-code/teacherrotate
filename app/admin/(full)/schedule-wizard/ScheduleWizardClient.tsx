'use client'

import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SCHEDULE_DAYS, DAY_LABEL, bandOf, deriveNativeSessions, subjectClassKey, classLabel, HOMEROOM_SELF, type ScheduleConfig } from '@/lib/scheduling'
import { GRADES, GRADE_LABEL, type ExtraCourse } from '@/lib/allocation'
import { assembleEngineInput, SCORING_VERSION, type EngineInput, type EngineResult, type PlacedResult, type RoomInfo } from '@/lib/schedule-engine'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'
import OverviewAdjust, { type HomeroomRow, type AdjustExtras } from './OverviewAdjust'
import ScheduleHealth from './ScheduleHealth'
import { type ChainSeed } from './ChainAdjustModal'
import { buildExportSheets, buildImportRows, buildSchoolCsvRows, rowsToXlsx, sheetsToCsv, sheetsToDocx, sheetsToPdf, saveBlob } from '@/lib/schedule-export'
import type { GradeSubject } from '../schedule-config/page'

interface Props {
  year: number
  scheduleConfig: ScheduleConfig
  classCounts: Record<number, number>
  gradeSubjects: Record<number, GradeSubject[]>
  gradeHomeroomBase: Record<number, number>
  teacherNames: Record<string, string>
  hourlyTeacherIds: string[]
  substituteTeacherIds: string[]
  homeroomHours: Record<string, Record<string, number>>
  extraCourses: ExtraCourse[]
  hoursByTeacher: Record<string, Record<string, Record<string, number>>>
  supplyByTeacher: Record<string, Record<string, Record<string, number>>>
  lastGeneratedAt: string | null
  initialPlanStatus: string | null
  savedPlan: Record<string, unknown> | null
  /** 草稿的最後寫入時間：當版本令牌用，兩台電腦同時編輯時擋下覆蓋（見 schedule-plan PUT） */
  planGeneratedAt?: string | null
  homeroomRows: HomeroomRow[]
}

type Progress = { iter: number; best: number; softBest: number; elapsed: number; placed: number; unplaced: number; sinceImproveMs: number; label?: string }
/** 一顆種子跑完的結果。跑起來要二十分鐘，人不一定在畫面前，所以每顆都記下來並存進瀏覽器。 */
type SeedRow = { no: number; seed: number; ok: boolean; unplaced: number; musts: number; soft: number; ms: number; at: number; stopped?: boolean }
type ViewKey = 'class' | 'teacher' | 'room'

// ── 版本紀錄 ──
// schedule_plan 一年只有一份、存新的蓋掉舊的；跑了三次才發現第一次最好就找不回來了。
// 每次排課完自動存一份快照到 schedule_plan_version，不佔用「目前採用的那一份」。
interface VersionRule { key: string; label: string; count: number; points: number }
interface VersionRow {
  id: string; seq?: number | null; label: string | null; starred: boolean; source: string; base_hash: string
  created_at: string; created_by: string | null
  // note＝這份版本的分數為什麼不能直接跟現況比（回填的舊課表、規則改過等）；有 note 就取代通用的「基礎資料已變更」訊息
  summary: { placed?: number; unplaced?: number; uncovered?: number; mustCount?: number; softPenalty?: number; note?: string; rules?: VersionRule[]; scoring?: number }
}
/** FNV-1a：只用來判斷「基礎資料是否相同」「落點是否變過」，不需要密碼學強度。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
/** 基礎資料指紋＝課的組成＋可排格＋必排格＋鎖課。這個一樣，兩份版本才有逐格比對的意義。 */
function baseHashOf(input: EngineInput): string {
  const lessons = input.lessons.map(l => `${l.classKey}|${l.subject}|${l.teacherId}|${l.size}|${l.parity}`).sort().join(';')
  const slots = Object.entries(input.classSlots).map(([k, v]) => `${k}:${[...v].sort().join(',')}`).sort().join(';')
  const must = Object.entries(input.classMustFill).map(([k, v]) => `${k}:${[...v].sort().join(',')}`).sort().join(';')
  const locks = Object.entries(input.lockedCells).map(([k, v]) => `${k}:${Object.keys(v).sort().join(',')}`).sort().join(';')
  return fnv1a([lessons, slots, must, locks].join('#'))
}
/** 落點指紋：手動微調後沒真的動過就不再存一份重複版本。 */
const sigOfPlaced = (placed: PlacedResult[]) => fnv1a(placed.map(p => `${p.id}@${p.day}-${p.period}`).sort().join('|'))
function summaryOf(r: EngineResult) {
  return {
    placed: r.placed.length,
    unplaced: r.unplaced.length,
    uncovered: r.uncoveredMustFill.length,
    mustCount: r.penalties.filter(p => p.points >= 1e6).reduce((s, p) => s + p.count, 0),
    softPenalty: Math.round(r.softPenalty),
    scoring: SCORING_VERSION,   // 計分版本：不同版本的軟分不可比（v2 起「一筆就是一筆」，量級對齊）
    rules: r.penalties.filter(p => p.points > 0).map(p => ({ key: p.key, label: p.label, count: p.count, points: Math.round(p.points) })),
  }
}

export default function ScheduleWizardClient(props: Props) {
  const router = useRouter()
  const { year, scheduleConfig, classCounts, gradeSubjects, gradeHomeroomBase, teacherNames, hourlyTeacherIds, substituteTeacherIds, homeroomHours, extraCourses, hoursByTeacher, supplyByTeacher } = props
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [seedLog, setSeedLog] = useState<SeedRow[]>([])
  const [seedLogOpen, setSeedLogOpen] = useState(false)
  // 草稿階段沒有「正式課表」這回事：畫面上顯示的一律是某一個版本快照。
  // 初始為空，版本清單載入後自動帶入最新的那一份（見下方 autoPreview）。
  const [result, setResult] = useState<EngineResult | null>(null)
  const [view, setView] = useState<ViewKey>('class')
  const [gradeSel, setGradeSel] = useState<number>(GRADES.find(g => (classCounts[g] ?? 0) > 0) ?? 1)
  const [teacherSel, setTeacherSel] = useState('')
  const [roomSel, setRoomSel] = useState('')
  const [planStatus, setPlanStatus] = useState<string | null>(props.initialPlanStatus)
  /** 草稿微調：發布前「班級課表」預覽本身就是可點的調整畫面（內嵌 OverviewAdjust）。
   *  第一次調動時 OverviewAdjust 會整份 PUT 成草稿（status draft）→ draftDirty=true，之後發布就直接發布資料庫那份草稿（不再用 result 覆蓋）。
   *  重跑／換版本預覽＝新的一份，draftDirty 歸零、內嵌元件重掛（adjustSession）。 */
  const [draftDirty, setDraftDirty] = useState(false)
  const [adjustSession, setAdjustSession] = useState(0)
  const [resumedAdjustments, setResumedAdjustments] = useState<unknown[] | null>(null)   // 接續草稿時帶回的微調紀錄
  const [adjustUnsaved, setAdjustUnsaved] = useState(0)   // 內嵌微調尚未儲存的筆數（重跑／換版本前要問）
  /** 有未儲存微調時先確認；確定放棄才往下走。 */
  const confirmDropAdjust = (what: string) =>
    adjustUnsaved === 0 || window.confirm(`有 ${adjustUnsaved} 筆微調尚未儲存，${what}將全部捨棄。確定要繼續嗎？`)
  const sessionBase = useRef<EngineResult | null>(null)   // 這一輪微調的起點（放棄微調要回到這裡）
  const resumeBase = useRef<EngineResult | null>(null)    // 接續草稿時從草稿裡帶回的起點（草稿存了 base）
  const draftPlanObj = useMemo<Record<string, unknown> | null>(() => {
    if (!result) return null
    const base = resumeBase.current ?? result
    resumeBase.current = null
    sessionBase.current = base
    const slim = (r: EngineResult) => ({
      totalPenalty: r.totalPenalty, softPenalty: r.softPenalty, placed: r.placed, unplaced: r.unplaced,
      penalties: r.penalties.map(p => ({ key: p.key, label: p.label, count: p.count, points: p.points, items: p.items.slice(0, 60) })),
      uncoveredMustFill: r.uncoveredMustFill,
    })
    return {
      status: 'draft', ...slim(result), adjustments: [] as unknown[],
      base: slim(base),   // 微調前的起點：重新整理後「放棄全部微調」還回得去
    }
    // 換一份（adjustSession）或換了結果（result）時才重建：微調回報的 placed 變動走的是元件自己的 state，
    // 不該讓內嵌元件重掛而失去復原堆疊
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustSession, result])
  const [phaseBusy, setPhaseBusy] = useState(false)
  const [runFailed, setRunFailed] = useState(false)          // 全部種子跑完仍有未排／必須級違反
  const [hints, setHints] = useState<string[]>([])           // 未排診斷：建議降低的權重
  const [probePerfect, setProbePerfect] = useState<boolean | null>(null)   // 純硬探測是否排得完（null＝未診斷）
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [versionNames, setVersionNames] = useState<Record<string, string>>({})
  const [versionsOpen, setVersionsOpen] = useState(false)   // 版本紀錄 modal
  // 畫面上這一份是「只是看看」還是「真的就是課表」。預覽不寫資料庫，重新整理就沒了，
  // 但畫面跟真的套用完全一樣——不標出來，人會以為已經改好了。
  const [previewOnly, setPreviewOnly] = useState(false)
  /** 按鈕上的標示。存版本和寫課表是兩件事（存檔被擋下時只留下版本），
   *  所以最新一版不一定就是目前課表——不同時把兩個標出來會被誤讀。 */
  const verBadge = () => {
    const cur = versions.find(v => v.id === previewVersionId)?.seq
    if (!versions.length) return ''
    if (!cur || cur === latestSeq) return `（最新 #${latestSeq}）`
    return `（目前 #${cur}・最新 #${latestSeq}）`
  }
  // 按鈕上顯示「最新編號」而不是筆數：補號是從 #2 開始的，兩個數字永遠差 1，並列會讓人以為版本不見了
  const latestSeq = versions.reduce((m, v) => Math.max(m, v.seq ?? 0), 0) || versions.length
  const [penaltyOpen, setPenaltyOpen] = useState(false)     // 罰分明細 modal
  const [healthOpen, setHealthOpen] = useState(false)       // 課表體檢 modal
  const [chainReq, setChainReq] = useState<{ seed: ChainSeed; nonce: number } | null>(null)
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null)   // 正在預覽的版本（null＝正式課表或剛跑出來的結果）
  const [versionBusy, setVersionBusy] = useState<string | null>(null)
  const lastVerSig = useRef<string | null>(null)   // 已存成版本的落點指紋，避免同一份重複存
  const workerRef = useRef<Worker | null>(null)
  useEffect(() => () => workerRef.current?.terminate(), [])

  // 只在排課進行中攔截。跑出來的結果一律自動存成版本快照、離開不會遺失，
  // 沒有「未儲存」這回事了（發布才是決定哪一份算數的動作）。
  useUnsavedGuard(running, '排課仍在進行，離開將中斷本次排課。確定要離開嗎？')

  const { input, preflight } = useMemo(
    () => assembleEngineInput({ config: scheduleConfig, classCounts, gradeSubjects, gradeHomeroomBase, teacherNames, hourlyTeacherIds, substituteTeacherIds, homeroomHours, extraCourses, hoursByTeacher, supplyByTeacher }),
    [scheduleConfig, classCounts, gradeSubjects, gradeHomeroomBase, teacherNames, hourlyTeacherIds, substituteTeacherIds, homeroomHours, extraCourses, hoursByTeacher, supplyByTeacher],
  )
  const errors = preflight.filter(p => p.level === 'error')
  const warns = preflight.filter(p => p.level === 'warn')

  const curBaseHash = useMemo(() => baseHashOf(input), [input])
  // 試過的種子（依「設定指紋」分開存）：引擎是決定性的，不跳過試過的就會一直拿到同一張課表
  const triedKey = `trotate:tried-seeds:${year}:${curBaseHash}`
  const readTried = (): number[] => {
    try { return JSON.parse(localStorage.getItem(triedKey) ?? '[]') } catch { return [] }
  }

  // ── 版本紀錄：載入清單、跑完自動存快照 ──
  // 版本紀錄是附加功能，任何一步失敗都只記錄在 console，不擋排課本身。
  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/schedule-plan-versions?year=${year}`)
      if (!res.ok) return
      const d = await res.json()
      setVersions(Array.isArray(d.versions) ? d.versions : [])
      setVersionNames(d.names ?? {})
    } catch { /* 略過 */ }
  }, [year])
  useEffect(() => { loadVersions() }, [loadVersions])

  const saveVersion = useCallback(async (r: EngineResult, source: 'engine' | 'manual', seed?: number) => {
    const sig = sigOfPlaced(r.placed)
    if (lastVerSig.current === sig) return   // 落點沒變＝同一份，不重複存
    lastVerSig.current = sig
    try {
      const res = await fetch('/api/admin/schedule-plan-versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, source, baseHash: curBaseHash, weights: scheduleConfig.weights, summary: summaryOf(r),
          // 自動標籤：版本清單原本一律顯示 null，看不出哪一版是什麼。種子號帶著，之後要重現找得回來
          label: `引擎排課${seed !== undefined ? `・種子 ${seed}` : ''}・軟分 ${Math.round(r.softPenalty)}`,
          plan: {
            placed: r.placed, unplaced: r.unplaced, uncoveredMustFill: r.uncoveredMustFill,
            totalPenalty: r.totalPenalty, softPenalty: r.softPenalty,
            penalties: r.penalties.map(p => ({ key: p.key, label: p.label, count: p.count, points: p.points, items: p.items.slice(0, 60) })),
          },
        }),
      })
      if (res.ok) loadVersions()
    } catch { /* 略過 */ }
  }, [year, curBaseHash, scheduleConfig.weights, loadVersions])

  // 版本清單載入後自動帶入最新的一份：草稿階段畫面上顯示的一律是某個版本，
  // 使用者不必先開 modal 挑一次才看得到課表。只做一次，之後由使用者自己切換。
  // 課表在資料庫的最後修改戳記。放在上層才跨得過 OverviewAdjust 的重掛（切版本、
  // 換微調起點都會重掛），否則會退回頁面載入時的舊值，下次存檔就被樂觀鎖擋下。
  const [planAt, setPlanAt] = useState(props.planGeneratedAt)
  const autoPreviewed = useRef(false)
  // 資料庫裡有微調過的草稿 → 開頁直接接續它（上次調到哪就從哪繼續），不另外挑版本
  useEffect(() => {
    if (autoPreviewed.current || running || result) return
    if (planStatus === 'published' || planStatus === 'final') return
    const sp = props.savedPlan
    if (sp?.status === 'draft' && Array.isArray(sp.placed) && Array.isArray(sp.adjustments) && (sp.adjustments as unknown[]).length > 0) {
      autoPreviewed.current = true
      resumeDraft()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (autoPreviewed.current || running || result || versions.length === 0) return
    if (planStatus === 'published' || planStatus === 'final') return
    autoPreviewed.current = true
    void previewVersion(versions[0])
    // previewVersion 依賴的都是 state setter 與 year，不需要進依賴陣列
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, planStatus, running, result])

  // 舊草稿沒有 versionId（這欄是後來才加的）：拿最近幾版比落點，對得上就標出來。
  // 只在「接續草稿卻標不出版本」時跑一次，比中或比完就不再試。
  const sigProbed = useRef(false)
  useEffect(() => {
    if (sigProbed.current || previewVersionId || !result || versions.length === 0) return
    if (!autoPreviewed.current) return
    sigProbed.current = true
    const want = sigOfPlaced(result.placed)
    void (async () => {
      for (const v of versions.slice(0, 3)) {
        const res = await fetch(`/api/admin/schedule-plan-versions?id=${v.id}`).catch(() => null)
        if (!res?.ok) continue
        const pl = (await res.json().catch(() => ({})))?.plan?.placed
        if (Array.isArray(pl) && sigOfPlaced(pl) === want) { setPreviewVersionId(v.id); return }
      }
    })()
  }, [previewVersionId, result, versions])

  async function patchVersion(id: string, patch: { label?: string | null; starred?: boolean }) {
    // 樂觀更新：先改畫面（星號、名稱立即反應），寫入失敗再抓回正確狀態
    setVersions(prev => prev.map(v => v.id === id ? { ...v, ...(patch.starred !== undefined ? { starred: patch.starred } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) } : v))
    const res = await fetch('/api/admin/schedule-plan-versions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    }).catch(() => null)
    if (!res?.ok) loadVersions()
  }
  const verZh = (v: VersionRow) => `${v.seq ? `#${v.seq} ` : ''}${v.label || new Date(v.created_at).toLocaleString('zh-TW')}`

  /** 把某一版寫回「目前課表」——不只是預覽，重新整理後看到的才會是它。 */
  async function restoreVersion(v: VersionRow, quiet = false) {
    setVersionBusy(v.id)
    try {
      const res = await fetch(`/api/admin/schedule-plan-versions?id=${v.id}`)
      if (!res.ok) { alert('載入版本失敗'); return false }
      const full = await res.json()
      const p = (full.plan ?? {}) as Record<string, unknown>
      if (!Array.isArray(p.placed)) { alert('這份版本沒有課表內容'); return false }
      const hrMap = (p.homeroom ?? null) as Record<string, Record<string, string>> | null
      if (!quiet && !hrMap && !confirm(`版本「${verZh(v)}」是舊格式，沒有存導師課。\n`
        + `回去以後科任會是這一版的，導師課則維持現狀——兩邊可能對不起來（同一格撞在一起）。\n確定要回去嗎？`)) return false
      const put = await fetch('/api/admin/schedule-plan', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, plan: { ...p, status: 'draft', versionId: v.id,
          adjustments: [{ at: new Date().toISOString(), desc: `回到版本 ${verZh(v)}` }] } }),
      })
      if (!put.ok) { alert('寫回課表失敗，請稍後再試。'); return false }
      const putData = await put.json().catch(() => ({}))
      if (putData.generatedAt) setPlanAt(putData.generatedAt)
      for (const [ck, cells] of Object.entries(hrMap ?? {})) {
        await fetch('/api/admin/schedule-homeroom', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year, classKey: ck, action: 'setCells', cells }),
        })
      }
      const penalties = (Array.isArray(p.penalties) ? p.penalties : []) as EngineResult['penalties']
      setResult({
        placed: p.placed as EngineResult['placed'],
        unplaced: Array.isArray(p.unplaced) ? p.unplaced as EngineResult['unplaced'] : [],
        penalties: penalties.map(x => ({ ...x, items: x.items ?? [] })),
        totalPenalty: Number(p.totalPenalty ?? 0), softPenalty: Number(p.softPenalty ?? 0),
        uncoveredMustFill: Array.isArray(p.uncoveredMustFill) ? p.uncoveredMustFill as EngineResult['uncoveredMustFill'] : [],
        iterations: 0, elapsedMs: 0,
      })
      lastVerSig.current = sigOfPlaced(p.placed as EngineResult['placed'])
      setPreviewVersionId(v.id); setPreviewOnly(false)
      setAdjustUnsaved(0); setDraftDirty(false); setResumedAdjustments(null)
      setAdjustSession(n => n + 1)
      setRunFailed(false); setHints([]); setProbePerfect(null)
      setVersionsOpen(false)
      router.refresh()   // 導師課是伺服器端的 props，不重拿會沒跟上
      return true
    } finally { setVersionBusy(null) }
  }

  async function deleteVersion(v: VersionRow) {
    // 版本是快照，課表是課表：刪快照本來不會動到課表。但課務組刪掉最新一版，想的
    // 通常是「回到上一版」——不一併退回去，重新整理後還是看到被刪那一版的內容。
    let same = false
    setVersionBusy(v.id)
    try {
      const res = await fetch(`/api/admin/schedule-plan-versions?id=${v.id}`)
      if (res.ok) {
        const pl = (await res.json())?.plan?.placed
        if (Array.isArray(pl) && result) same = sigOfPlaced(pl) === sigOfPlaced(result.placed)
      }
    } catch { /* 拿不到就當成不同，只刪快照 */ } finally { setVersionBusy(null) }
    const prev = versions.filter(x => x.id !== v.id)[0]
    const msg = !same
      ? `刪除版本「${verZh(v)}」？\n（這只會刪掉快照，不會改變目前的課表。）\n此操作無法復原。`
      : prev
        ? `版本「${verZh(v)}」就是目前的課表。\n刪除後，課表會一併回到「${verZh(prev)}」。\n此操作無法復原。`
        : `版本「${verZh(v)}」就是目前的課表，而且沒有更早的版本可以退回去。\n`
          + `刪除後課表內容會留著，但不再有任何版本紀錄。\n此操作無法復原。`
    if (!confirm(msg)) return
    await fetch(`/api/admin/schedule-plan-versions?id=${v.id}`, { method: 'DELETE' })
    if (previewVersionId === v.id) setPreviewVersionId(null)
    await loadVersions()
    if (same && prev) await restoreVersion(prev, true)
  }

  // ── 本土語場次：由鎖課×配課自動推導，發布後管理者直接切換 維持/直播/取消 ──
  const [nativeStates, setNativeStates] = useState<Record<string, 'stream' | 'cancelled'>>(scheduleConfig.nativeLang.states)
  const [nativeSaving, setNativeSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const nativeDerived = useMemo(
    () => deriveNativeSessions({ config: { ...scheduleConfig, nativeLang: { ...scheduleConfig.nativeLang, states: nativeStates } }, extraCourses, hoursByTeacher }),
    [scheduleConfig, nativeStates, extraCourses, hoursByTeacher],
  )
  const nativeRoomNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const z of scheduleConfig.roomZones) for (const r of z.rooms) if (r.kind === 'native') m[r.id] = (r.name || '本土語言教室') + r.no
    return m
  }, [scheduleConfig])
  async function setNativeState(key: string, next: 'physical' | 'stream' | 'cancelled') {
    const states = { ...nativeStates }
    if (next === 'physical') delete states[key]
    else states[key] = next
    setNativeStates(states)
    setNativeSaving('saving')
    try {
      const res = await fetch('/api/admin/schedule-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, config: { ...scheduleConfig, nativeLang: { ...scheduleConfig.nativeLang, states } } }),
      })
      setNativeSaving(res.ok ? 'saved' : 'error')
    } catch { setNativeSaving('error') }
  }

  // 種子紀錄存在瀏覽器：關掉分頁、重新整理都還在，回來才看得到剛才試了幾顆
  const seedLogKey = `trotate:seedlog:${year}`
  useEffect(() => {
    try {
      const raw = localStorage.getItem(seedLogKey)
      if (raw) setSeedLog(JSON.parse(raw))
    } catch { /* 無痕視窗或封鎖儲存：沒有紀錄就算了 */ }
  }, [seedLogKey])
  function pushSeed(row: SeedRow) {
    setSeedLog(prev => {
      const next = [...prev, row].slice(-60)
      try { localStorage.setItem(seedLogKey, JSON.stringify(next)) } catch { /* 同上 */ }
      return next
    })
  }

  function run(freshSeeds = false) {
    if (!confirmDropAdjust('重新排課')) return
    // 「換一批種子」：把固定的前五顆先記成試過的，這一輪直接從沒跑過的開始。
    // 引擎是決定性的，同一顆種子永遠給同一張課表——想換一版比較就得換種子。
    if (freshSeeds) {
      try { localStorage.setItem(triedKey, JSON.stringify(Array.from(new Set([...readTried(), 42, 7, 17, 63, 3])))) } catch { /* 無痕視窗：跳過 */ }
    }
    workerRef.current?.terminate()
    setAdjustUnsaved(0)
    setSeedLog([]); try { localStorage.removeItem(seedLogKey) } catch { /* 同上 */ }
    setResult(null); setProgress(null); setRunning(true); setRunFailed(false); setHints([]); setProbePerfect(null); setPreviewVersionId(null); setDraftDirty(false); setAdjustSession(n => n + 1); setResumedAdjustments(null)
    const w = new Worker(new URL('./schedule.worker.ts', import.meta.url))
    workerRef.current = w
    w.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'progress') setProgress(e.data as Progress)
      else if (e.data.type === 'seed') {
        pushSeed(e.data as SeedRow); setSeedLogOpen(true)
        try { localStorage.setItem(triedKey, JSON.stringify(Array.from(new Set([...readTried(), e.data.seed])).slice(-200))) } catch { /* 無痕視窗：跳過 */ }
      }
      else if (e.data.type === 'done') {
        const done = e.data.result as EngineResult
        const failed = Boolean(e.data.failed)
        const seed = typeof e.data.meta?.seed === 'number' ? e.data.meta.seed : undefined
        setRunning(false)
        w.terminate()
        if (failed && e.data.stopped) {
          // 按「停止」＝純停止：不採用、不存版本。停止本來就不代表要這份半成品，
          // 而且版本紀錄有保留上限，塞失敗的進去會把好版本擠掉。想知道發生什麼事看種子紀錄就有。
          setSeedLogOpen(true)
          return
        }
        setResult(done)
        setRunFailed(failed)
        setHints(Array.isArray(e.data.hints) ? e.data.hints : [])
        setProbePerfect(typeof e.data.probePerfect === 'boolean' ? e.data.probePerfect : null)
        // 沒排成的不存版本（同上：會擠掉好版本）。引擎是決定性的，種子紀錄裡有種子號就能完整重現
        if (!failed) { saveVersion(done, 'engine', seed); setSeedLogOpen(false) }
        else setSeedLogOpen(true)
      }
    }
    w.postMessage({ input, skipSeeds: readTried() })
  }
  function stop() {
    // 純停止：Worker 收到就收工，已經排成功的照樣採用，沒排成的什麼都不做
    // （原本叫「停止並採用目前結果」，但停止是唯一能中斷的方式，按它不代表要那份半成品）
    workerRef.current?.postMessage({ type: 'stop' })
  }
  /** 發布導師排課／撤回發布（伺服器端把關：未排與必排未覆蓋須為 0）。
   *  發布＝把目前預覽的這一份寫進 schedule_plan（正式課表）再發布，中間沒有獨立的「儲存」步驟——
   *  排課結果本來就自動存成版本了，「儲存」只是在決定哪一份算數，那件事併進發布更單純。 */
  async function setPhase(action: 'publish' | 'unpublish') {
    if (action === 'unpublish') {
      const filled = props.homeroomRows.filter(r => Object.keys(r.cells ?? {}).length > 0)
      const confirmed = filled.filter(r => r.confirmed_at).length
      // 撤回＝要重排，科任課位置會變，導師先前依舊課表做的安排整體不成立 → 一律清空重來
      const head = filled.length
        ? `目前有 ${filled.length} 班導師已填課${confirmed ? `（其中 ${confirmed} 班已確認送出）` : ''}，撤回後將全部清空、導師依新課表重新填。
`
        : ''
      if (!confirm(`撤回「發布導師排課」後可重新排課。
${head}確定撤回？`)) return
      if (filled.length > 0) {
        setPhaseBusy(true)
        try {
          for (const r of filled) {
            await fetch('/api/admin/schedule-homeroom', {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year, classKey: r.class_key, action: 'reset' }),
            })
          }
        } finally { setPhaseBusy(false) }
      }
      // 撤回後正式課表就不存在了（含發布後的手動微調）——先留一份版本，免得回不去
      const sp = props.savedPlan
      if (sp && Array.isArray(sp.placed)) {
        const pens = (sp.penalties as { key: string; label: string; count: number; points: number }[] | undefined) ?? []
        await fetch('/api/admin/schedule-plan-versions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year, source: 'manual', baseHash: curBaseHash, weights: scheduleConfig.weights,
            label: `撤回發布前的課表（${new Date().toLocaleString('zh-TW')}）`,
            summary: {
              placed: (sp.placed as unknown[]).length,
              unplaced: Array.isArray(sp.unplaced) ? (sp.unplaced as unknown[]).length : 0,
              uncovered: Array.isArray(sp.uncoveredMustFill) ? (sp.uncoveredMustFill as unknown[]).length : 0,
              mustCount: pens.filter(x => Number(x.points) >= 1e6).reduce((a, x) => a + (x.count ?? 0), 0),
              softPenalty: Math.round(Number(sp.softPenalty ?? 0)),
              ...(Array.isArray(sp.adjustments) && (sp.adjustments as unknown[]).length
                ? { note: `含 ${(sp.adjustments as unknown[]).length} 筆發布後的手動微調；罰分為微調前數值、未重算。` } : {}),
              rules: pens.filter(x => Number(x.points) > 0).map(x => ({ key: x.key, label: x.label, count: x.count, points: Math.round(Number(x.points)) })),
            },
            plan: sp,
          }),
        }).catch(() => { /* 留存失敗不擋撤回 */ })
      }
    }
    if (action === 'publish' && !draftDirty) {
      if (!result) { alert('沒有可發布的課表：請先按「開始排課」，或到版本紀錄挑一份預覽。'); return }
      // 正式課表若有手動微調紀錄，發布別份會把它們蓋掉——講明白再做
      const adj = Array.isArray(props.savedPlan?.adjustments) ? (props.savedPlan!.adjustments as unknown[]).length : 0
      if (adj > 0 && previewVersionId && !confirm(`目前的正式課表有 ${adj} 筆手動微調紀錄。\n發布這一份會整個覆蓋掉，微調將全部消失。確定發布？`)) return
    }
    // 發布前把關：導師已填的課若跟這份科任課撞在同一格，課表會以導師課覆蓋顯示、把科任課蓋掉。
    // 撤回發布→換版本→重新發布最容易踩到（導師填課存在另一張表，不會跟著版本回去）。
    if (action === 'publish') {
      const toPublish = result?.placed ?? (Array.isArray(props.savedPlan?.placed) ? props.savedPlan!.placed as PlacedResult[] : null)
      if (toPublish) {
        const clash: { ck: string; slots: string[] }[] = []
        for (const r of props.homeroomRows) {
          const cells = r.cells ?? {}
          if (!Object.keys(cells).length) continue
          const occ = new Set<string>()
          for (const q of toPublish) {
            if (q.classKey !== r.class_key) continue
            occ.add(`${q.day}-${q.period}`)
            if (q.size === 2) occ.add(`${q.day}-${q.period + 1}`)
          }
          const bad = Object.keys(cells).filter(sl => occ.has(sl))
          if (bad.length) clash.push({ ck: r.class_key, slots: bad })
        }
        if (clash.length) {
          const zh = (ck: string) => { const [g, i] = ck.split('-').map(Number); return `${GRADE_LABEL[g]}${i + 1}班` }
          const n = clash.reduce((a, c) => a + c.slots.length, 0)
          const head = clash.slice(0, 6).map(c => `${zh(c.ck)}×${c.slots.length}`).join('、')
          const msg = '有 ' + clash.length + ' 個班、共 ' + n + ' 格導師已填的課，跟這份課表的科任課落在同一格（'
            + head + (clash.length > 6 ? '…' : '') + '）。\n\n課表顯示時導師課會蓋住科任課，等於科任課消失。\n\n'
            + '按「確定」＝清掉這幾格導師填的課再發布（導師需重填那幾格）\n按「取消」＝先不發布，自行處理'
          if (!confirm(msg)) return
          setPhaseBusy(true)
          try {
            for (const c of clash) {
              const row = props.homeroomRows.find(r => r.class_key === c.ck)
              const cells = { ...(row?.cells ?? {}) }
              for (const sl of c.slots) delete cells[sl]
              await fetch('/api/admin/schedule-homeroom', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ year, classKey: c.ck, action: 'setCells', cells }),
              })
            }
          } finally { setPhaseBusy(false) }
        }
      }
    }
    setPhaseBusy(true)
    try {
      if (action === 'publish' && !draftDirty) {
        // ① 寫入正式課表（草稿）
        const put = await fetch('/api/admin/schedule-plan', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year,
            plan: {
              status: 'draft',
              totalPenalty: result!.totalPenalty,
              softPenalty: result!.softPenalty,
              placed: result!.placed,
              unplaced: result!.unplaced,
              penalties: result!.penalties.map(p => ({ key: p.key, label: p.label, count: p.count, points: p.points, items: p.items.slice(0, 60) })),
              uncoveredMustFill: result!.uncoveredMustFill,
            },
          }),
        })
        if (!put.ok) { alert('寫入正式課表失敗，請稍後再試。'); return }
      }
      // ② 發布／撤回（伺服器端仍會擋未排、必排未覆蓋、必須級違反）
      const res = await fetch('/api/admin/schedule-plan', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, action }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? '操作失敗'); return }
      setPlanStatus(data.status)
      if (action === 'publish') { setDraftDirty(false); router.refresh() }
    } finally { setPhaseBusy(false) }
  }

  /** 接續上次存在資料庫的草稿（含手動微調紀錄）：載回來當預覽，內嵌調整直接續調；發布就發布它。 */
  function resumeDraft() {
    const sp = props.savedPlan
    if (!sp || !Array.isArray(sp.placed)) return
    const p = sp as Record<string, unknown> & { placed: PlacedResult[] }
    const penalties = (Array.isArray(p.penalties) ? p.penalties : []) as EngineResult['penalties']
    setResult({
      placed: p.placed, unplaced: Array.isArray(p.unplaced) ? p.unplaced as EngineResult['unplaced'] : [],
      penalties: penalties.map(x => ({ ...x, items: x.items ?? [] })),
      totalPenalty: Number(p.totalPenalty ?? 0), softPenalty: Number(p.softPenalty ?? 0),
      uncoveredMustFill: Array.isArray(p.uncoveredMustFill) ? p.uncoveredMustFill as EngineResult['uncoveredMustFill'] : [],
      iterations: 0, elapsedMs: 0,
    })
    lastVerSig.current = sigOfPlaced(p.placed)
    // 草稿記得自己是哪一版就直接標出來；舊資料沒這欄，交給下面的比對兜底
    setPreviewVersionId(typeof p.versionId === 'string' ? p.versionId : null)
    setPreviewOnly(false)
    const b = sp.base as Record<string, unknown> | undefined
    if (b && Array.isArray(b.placed)) {
      const bp = (Array.isArray(b.penalties) ? b.penalties : []) as EngineResult['penalties']
      resumeBase.current = {
        placed: b.placed as PlacedResult[], unplaced: Array.isArray(b.unplaced) ? b.unplaced as EngineResult['unplaced'] : [],
        penalties: bp.map(x => ({ ...x, items: x.items ?? [] })),
        totalPenalty: Number(b.totalPenalty ?? 0), softPenalty: Number(b.softPenalty ?? 0),
        uncoveredMustFill: Array.isArray(b.uncoveredMustFill) ? b.uncoveredMustFill as EngineResult['uncoveredMustFill'] : [],
        iterations: 0, elapsedMs: 0,
      }
    }
    setDraftDirty(true); setAdjustSession(n => n + 1); setResumedAdjustments(Array.isArray(sp.adjustments) ? sp.adjustments as unknown[] : [])
  }
  /** 放棄這一輪全部微調：回到起點那份、清掉資料庫裡的草稿微調。 */
  async function discardDraft() {
    const base = sessionBase.current
    if (!base) return
    if (!confirm('放棄這一輪全部微調，回到微調前的課表？（資料庫裡的草稿微調也會清掉）')) return
    const plan = {
      status: 'draft', totalPenalty: base.totalPenalty, softPenalty: base.softPenalty,
      placed: base.placed, unplaced: base.unplaced,
      penalties: base.penalties.map(p => ({ key: p.key, label: p.label, count: p.count, points: p.points, items: p.items.slice(0, 60) })),
      uncoveredMustFill: base.uncoveredMustFill, adjustments: [] as unknown[],
    }
    await fetch('/api/admin/schedule-plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, plan }) }).catch(() => { /* 清不掉也先回畫面 */ })
    if (props.savedPlan) { props.savedPlan.adjustments = []; props.savedPlan.placed = base.placed }
    setResult(base); setDraftDirty(false); setResumedAdjustments(null); setAdjustSession(n => n + 1)
  }

  /** 從版本紀錄挑一份來預覽（不會動到正式課表，要按發布才算數）。 */
  async function previewVersion(v: VersionRow) {
    if (!confirmDropAdjust('切換到別的版本')) return
    setVersionBusy(v.id)
    setAdjustUnsaved(0)
    setDraftDirty(false); setResumedAdjustments(null)
    try {
      const res = await fetch(`/api/admin/schedule-plan-versions?id=${v.id}`)
      if (!res.ok) { alert('載入版本失敗'); return }
      const full = await res.json()
      const p = full.plan ?? {}
      if (!Array.isArray(p.placed)) { alert('這份版本沒有課表內容'); return }
      const penalties = (Array.isArray(p.penalties) ? p.penalties : []) as EngineResult['penalties']
      setResult({
        placed: p.placed, unplaced: Array.isArray(p.unplaced) ? p.unplaced : [],
        penalties: penalties.map(x => ({ ...x, items: x.items ?? [] })),
        totalPenalty: Number(p.totalPenalty ?? 0), softPenalty: Number(p.softPenalty ?? 0),
        uncoveredMustFill: Array.isArray(p.uncoveredMustFill) ? p.uncoveredMustFill : [],
        iterations: 0, elapsedMs: 0,
      })
      lastVerSig.current = sigOfPlaced(p.placed)   // 預覽既有版本不該再存成新版本
      setPreviewVersionId(v.id); setPreviewOnly(true)
      // 重掛內嵌元件一定要在 setResult 之後：它會把 savedPlan.placed 抄進自己的 state，
      // 先重掛就會抄到「上一版」的課表，畫面看起來像沒切過去（而且之後怎麼切都不會更新）。
      setAdjustSession(n => n + 1)   // 換一份預覽＝新的微調起點（舊草稿仍在資料庫，可「接續」）
      setRunFailed(false); setHints([]); setProbePerfect(null)
      setVersionsOpen(false)
    } finally { setVersionBusy(null) }
  }

  // ── 匯出整份課表（班級＋科任教師＋科任教室）：PDF／Word／CSV ──
  const [exportOpen, setExportOpen] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  // 下載哪一份＝螢幕上顯示的那一份：預覽舊版本時下載該版本，否則發布後下載正式課表
  const exportPlaced: PlacedResult[] | null = previewVersionId
    ? (result?.placed ?? null)
    : (planStatus === 'published' || planStatus === 'final') && Array.isArray(props.savedPlan?.placed)
      ? (props.savedPlan!.placed as PlacedResult[])
      : result?.placed ?? null
  async function doExport(kind: 'pdf' | 'doc' | 'csv' | 'import' | 'school') {
    setExportOpen(false)
    if (!exportPlaced) return
    const hrCells: Record<string, Record<string, string>> = {}
    for (const r of props.homeroomRows) if (r.cells && Object.keys(r.cells).length) hrCells[r.class_key] = r.cells
    const args = { year, placed: exportPlaced, config: scheduleConfig, input, teacherNames, classCounts, hrCells, nativeSessions: nativeDerived.sessions, nativeRoomNames }
    const sheets = buildExportSheets(args)
    const base = `${year}學年度課表（班級＋科任教師＋科任教室）`
    try {
      if (kind === 'school') {
        setExportStatus('產生 Excel 中…')
        saveBlob(await rowsToXlsx(buildSchoolCsvRows(args), '課程資料'), `${year}學年度課程資料（校務系統）.xlsx`)
        return
      }
      if (kind === 'import') {
        setExportStatus('產生 Excel 中…')
        const rows = buildImportRows(args)
        saveBlob(await rowsToXlsx(rows), `${year}學年度課程資料（校務系統匯入）.xlsx`)
        return
      }
      if (kind === 'csv') { saveBlob(new Blob([sheetsToCsv(sheets)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`); return }
      if (kind === 'doc') { setExportStatus('產生 Word 中…'); const blob = await sheetsToDocx(sheets); saveBlob(blob, `${base}.docx`); return }
      setExportStatus('準備中…')
      const blob = await sheetsToPdf(sheets, s => setExportStatus(s))
      saveBlob(blob, `${base}.pdf`)
    } catch (e) {
      alert(`匯出失敗：${e instanceof Error ? e.message : String(e)}`)
    } finally { setExportStatus(null) }
  }

  // ── 本土語（不進引擎、鎖課時段固定）：教師課表要一併顯示 ──
  //   閩南語原班：科任配班「本土語」指派的老師 × 該班本土語鎖課格；語別場次：實體／線上（有授課老師）
  const nativeCellsByTeacher = useMemo(() => {
    const m = new Map<string, { slot: string; main: string; sub: string }[]>()
    const nativeTypeIds = new Set(scheduleConfig.lockTypes.filter(t => t.isNative).map(t => t.id))
    for (const [ck, cells] of Object.entries(scheduleConfig.lockCells)) {
      const [g, i] = ck.split('-').map(Number)
      const tid = scheduleConfig.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
      if (!tid || tid === HOMEROOM_SELF) continue
      for (const [slot, ltid] of Object.entries(cells)) {
        if (!nativeTypeIds.has(ltid)) continue
        m.set(tid, [...(m.get(tid) ?? []), { slot, main: `${classLabel(g, i)} 本土語`, sub: '原班（閩南語）' }])
      }
    }
    for (const sn of nativeDerived.sessions) {
      if (sn.state === 'cancelled' || !sn.teacherId) continue
      m.set(sn.teacherId, [...(m.get(sn.teacherId) ?? []), { slot: sn.slot, main: `本土語（${sn.lang}）`, sub: `${GRADE_LABEL[sn.grade]}${sn.state === 'stream' ? '・線上' : ''}${sn.roomId ? `・${nativeRoomNames[sn.roomId] ?? ''}` : ''}` }])
    }
    return m
  }, [scheduleConfig, nativeDerived, nativeRoomNames])

  // 調整畫面用：本土語（原班＋語別場次）依老師／教室，唯讀灰格
  const adjustExtras = useMemo<AdjustExtras>(() => {
    const room = new Map<string, { slot: string; main: string; sub: string }[]>()
    for (const sn of nativeDerived.sessions) {
      if (sn.state !== 'physical' || !sn.roomId) continue
      room.set(sn.roomId, [...(room.get(sn.roomId) ?? []), { slot: sn.slot, main: `本土語（${sn.lang}）`, sub: `${GRADE_LABEL[sn.grade]}・${teacherNames[sn.teacherId] ?? ''}` }])
    }
    return { teacher: nativeCellsByTeacher, room, roomNames: nativeRoomNames }
  }, [nativeDerived, nativeCellsByTeacher, nativeRoomNames, teacherNames])

  // ── 檢視資料索引 ──
  const teachers = useMemo(() => {
    const ids = Array.from(new Set([...input.lessons.map(l => l.teacherId), ...Array.from(nativeCellsByTeacher.keys())]))
    return ids.map(id => ({ id, name: teacherNames[id] ?? '？' })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [input, teacherNames, nativeCellsByTeacher])
  // 外師（協同）：另列一群，課表＝所有掛了她的課
  const foreignList = useMemo(() => {
    const ids = Array.from(new Set(input.lessons.map(l => l.coTeacherId).filter((x): x is string => Boolean(x))))
    return ids.map(id => ({ id, name: teacherNames[id] ?? '外師' })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  }, [input, teacherNames])
  const roomList: RoomInfo[] = input.rooms

  const byClass = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const p of result?.placed ?? []) m.set(p.classKey, [...(m.get(p.classKey) ?? []), p])
    return m
  }, [result])
  const byTeacher = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const p of result?.placed ?? []) {
      m.set(p.teacherId, [...(m.get(p.teacherId) ?? []), p])
      if (p.coTeacherId) m.set(p.coTeacherId, [...(m.get(p.coTeacherId) ?? []), p])   // 外師視圖：掛她的課
    }
    return m
  }, [result])
  const byRoom = useMemo(() => {
    const m = new Map<string, PlacedResult[]>()
    for (const p of result?.placed ?? []) if (p.roomId) m.set(p.roomId, [...(m.get(p.roomId) ?? []), p])
    return m
  }, [result])

  function cellsOf(list: PlacedResult[]): Map<string, PlacedResult> {
    const m = new Map<string, PlacedResult>()
    for (const p of list) {
      // 單雙週課只顯示一格：單週畫在起始節、雙週畫在次節（實體仍占整個區塊，另一格為導師填課空間）
      if (p.parity !== 'weekly') {
        m.set(`${p.day}-${p.parity === 'odd' ? p.period : p.period + 1}`, p)
        continue
      }
      m.set(`${p.day}-${p.period}`, p)
      if (p.size === 2) m.set(`${p.day}-${p.period + 1}`, p)
    }
    return m
  }

  function Grid({ list, mode, classKey, extra, roomOff }: { list: PlacedResult[]; mode: ViewKey; classKey?: string; extra?: { slot: string; main: string; sub: string }[]; roomOff?: { slots: Set<string>; note: string } }) {
    const cells = cellsOf(list)
    const locks = classKey ? (input.lockedCells[classKey] ?? {}) : {}
    const extraMap = new Map((extra ?? []).map(e => [e.slot, e]))
    const avail = classKey ? new Set(input.classSlots[classKey] ?? []) : null
    const must = classKey ? new Set(input.classMustFill[classKey] ?? []) : new Set<string>()
    return (
      <table className="w-full table-fixed border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="w-6 text-zinc-400 font-normal"></th>
            {SCHEDULE_DAYS.map(d => <th key={d} className="text-center text-zinc-500 font-normal py-0.5">{DAY_LABEL[d].slice(1)}</th>)}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 7].map(q => (
            <tr key={q}>
              <td className="text-zinc-400 text-center">{q}</td>
              {SCHEDULE_DAYS.map(d => {
                const k = `${d}-${q}`
                const p = cells.get(k)
                if (p) {
                  const bi = p.parity !== 'weekly'
                  const text = mode === 'class' ? `${p.subject}` : mode === 'teacher' ? `${p.classLabel} ${p.subject}` : `${p.classLabel}`
                  return (
                    <td key={d} className="p-0.5">
                      <div className={`h-9 rounded-sm border px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center text-center ${bi ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>
                        <span className="truncate w-full">{text}</span>
                        {/* 班級課表：格內已是科目 → 補授課老師；科任教室課表：格內是班級 → 補「老師・科目」 */}
                        {mode === 'class' && <span className="truncate w-full text-[9px] opacity-70">{p.teacherName}</span>}
                        {mode === 'room' && <span className="truncate w-full text-[9px] opacity-70">{p.teacherName}{p.subject ? `・${p.subject}` : ''}</span>}
                        {p.coTeacherId && <span className="truncate w-full text-[8px] text-rose-700 font-medium">★{p.coTeacherName ?? '外師'}{mode === 'teacher' && teacherSel === p.coTeacherId ? `・${p.teacherName}` : ''}</span>}
                        {bi && <span className="text-[8px] opacity-70">{p.parity === 'odd' ? '單週' : '雙週'}</span>}
                      </div>
                    </td>
                  )
                }
                if (classKey && locks[k]) {
                  return <td key={d} className="p-0.5"><div className="h-9 rounded-sm border bg-zinc-200 border-zinc-300 text-zinc-600 flex items-center justify-center truncate px-0.5">{locks[k]}</div></td>
                }
                const ex = extraMap.get(k)
                if (ex) {
                  return (
                    <td key={d} className="p-0.5">
                      <div className="h-9 rounded-sm border bg-zinc-200 border-zinc-300 text-zinc-600 px-0.5 leading-tight overflow-hidden flex flex-col items-center justify-center text-center">
                        <span className="truncate w-full">{ex.main}</span>
                        <span className="truncate w-full text-[9px] opacity-70">{ex.sub}</span>
                      </div>
                    </td>
                  )
                }
                if (classKey && avail && !avail.has(k)) {
                  return <td key={d} className="p-0.5"><div className="h-9 rounded-sm bg-zinc-100" /></td>
                }
                if (roomOff?.slots.has(k)) {
                  // 科任教室不排課時段（教室設定 ⚙）：該時段教室另有用途
                  return <td key={d} className="p-0.5"><div title={roomOff.note || '不排課時段'} className="h-9 rounded-sm border bg-rose-50 border-rose-200 text-rose-500 flex items-center justify-center text-[10px] truncate px-0.5">{roomOff.note ? roomOff.note.slice(0, 6) : '不排課'}</div></td>
                }
                return (
                  <td key={d} className="p-0.5">
                    <div className={`h-9 rounded-sm border border-dashed flex items-center justify-center ${must.has(k) ? 'border-red-300 bg-red-50 text-red-400' : 'border-zinc-200 text-zinc-300'}`}>
                      {classKey ? (must.has(k) ? '需科任!' : '導師') : ''}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const bigPenalty = (result?.penalties ?? []).filter(p => p.points >= 1e6)

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="page-title mb-1">排課精靈
            <span className="text-sm font-normal text-zinc-500 ml-2">{year} 學年度</span>
            {planStatus === 'published' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-sm bg-green-100 text-green-700 border border-green-200 align-middle">初版課表已發布</span>}
            {planStatus === 'final' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-sm bg-zinc-800 text-white rounded-sm align-middle">已定案</span>}
            {planStatus === 'draft' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-sm bg-zinc-100 text-zinc-500 border border-zinc-200 align-middle">草稿</span>}
          </h2>
          <p className="text-xs text-zinc-400">一鍵排出科任教師與科任教室課表；班級課表留白＝導師自排空間。{(planStatus === 'published' || planStatus === 'final') && props.lastGeneratedAt && `正式課表更新於 ${new Date(props.lastGeneratedAt).toLocaleString('zh-TW')}`}</p>
        </div>
        <span className="flex gap-2 flex-shrink-0">
          {planStatus !== 'published' && planStatus !== 'final' && result !== null && (
            <button onClick={() => setPhase('publish')} disabled={phaseBusy} className="btn btn-primary text-sm py-1"
              title={'發布給導師填課：導師可在教師端填排自己班的課務；此階段課表尚未對全校公開，科任課凍結'}>
              📢 發布導師排課{draftDirty ? '（含微調）' : ''}
            </button>
          )}
          {planStatus === 'published' && (
            <button onClick={() => setPhase('unpublish')} disabled={phaseBusy} className="btn btn-danger text-sm py-1">撤回發布</button>
          )}
          <Link href="/admin/schedule-config?tab=weight" className="btn btn-secondary text-sm py-1">⚙ 調整權重設定</Link>
          <span className="relative">
            <button onClick={() => setExportOpen(o => !o)} disabled={!exportPlaced || exportStatus !== null} className="btn btn-secondary text-sm py-1"
              title={exportPlaced ? '下載整份課表：班級＋科任教師＋科任教室，一頁一張（版面同人工課表）' : '先排課或挑一份版本預覽'}>
              {exportStatus ?? '⬇ 下載課表 ▾'}
            </button>
            {exportOpen && (
              <span className="absolute right-0 top-full mt-1 z-20 w-64 bg-white border border-zinc-200 rounded-md shadow-lg py-1 text-sm" onMouseLeave={() => setExportOpen(false)}>
                <button onClick={() => doExport('pdf')} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 font-medium text-zinc-800">📄 PDF（整份）</button>
                <button onClick={() => doExport('doc')} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 text-zinc-600">📝 Word（.docx）</button>
                <button onClick={() => doExport('csv')} className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 text-zinc-600">📊 CSV（一列一格，Excel 用）</button>
                <button onClick={() => doExport('school')} title="欄位：class_no／班級／科目／科目名稱／星期／節次／教師／教師名稱／教室／教室名稱。科目與教師代碼本系統沒有，留空；不列入本土語其他語別的場次老師與英語外師；單雙週依校務系統慣例——單週寫在奇數節、雙週寫在偶數節"
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 text-zinc-600 border-t border-zinc-100">🏫 校務系統課程資料（.xlsx）</button>
                <button onClick={() => doExport('import')} title="欄位：週次／節次／年級／班級／教師姓名／校訂課程名稱／上課頻率；一列一堂課，連堂兩列，單雙週標「單週上課」「雙週上課」"
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-100 text-zinc-500 text-xs">🏫 舊格式：校訂課程（.xlsx）</button>
                <div className="px-3 pt-1 text-[11px] text-zinc-400 border-t border-zinc-100 mt-1">{(planStatus === 'published' || planStatus === 'final') ? '內容＝已發布的正式課表（含微調與導師已填）' : '內容＝目前預覽的這份（含微調）'}</div>
              </span>
            )}
          </span>
        </span>
      </div>

      {/* 前置檢查（附前往設定引導按鈕） */}
      {(errors.length > 0 || warns.length > 0) && (
        <div className="card p-3 space-y-1.5">
          <div className="text-sm font-semibold text-zinc-700">前置檢查</div>
          {[...errors, ...warns].map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              <p className={`text-xs flex-1 ${p.level === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                {p.level === 'error' ? '✕' : '⚠'} {p.text}
              </p>
              {(p.href || p.tab) && (
                <Link href={p.href ?? `/admin/schedule-config?tab=${p.tab}`}
                  className="text-[11px] px-1.5 py-0.5 rounded-sm border border-zinc-300 text-zinc-500 hover:text-zinc-800 hover:border-zinc-500 whitespace-nowrap flex-shrink-0">
                  前往設定 →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 執行 */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        {/* 版本紀錄的入口平常在「儲存課表」旁邊，但課表已發布／尚未排課時沒有結果區，
            這裡補一個入口，免得版本紀錄變成進不去的頁面 */}
        {!result && (
          <button onClick={() => setVersionsOpen(true)} className="btn btn-secondary text-xs py-1 order-last ml-auto">
            🗂 版本紀錄{verBadge()}
          </button>
        )}
        {planStatus === 'published' || planStatus === 'final' ? (
          <span className="text-xs text-amber-600">
            已發布導師排課，科任課凍結——導師正在教師端填自己班的課；<b>此階段課表尚未對全校公開</b>。收回填課即可調課；全部完成後按「發布全校課表」。若需重排，請先「撤回發布」（導師已填內容可能與新課表不符）。
          </span>
        ) : (
          <>
            {!running
              ? (<>
                <button onClick={() => run()} disabled={errors.length > 0 || input.lessons.length === 0} className="btn btn-primary text-sm py-1">▶ 開始排課</button>
                <button onClick={() => run(true)} disabled={errors.length > 0 || input.lessons.length === 0}
                  className="btn btn-secondary text-sm py-1"
                  title="跳過固定的前五顆種子，直接用沒跑過的。同一顆種子永遠排出同一張課表，想換一版比較就用這個">🎲 換一批種子</button>
              </>)
              : <button onClick={stop} className="btn btn-secondary text-sm py-1" title="停下來就好；沒排成的不會採用、也不會存成版本">■ 停止</button>}
            <span className="text-xs text-zinc-400">
              共 {input.lessons.length} 堂科任課待排。硬限制與權重一次跑、多種子多起點取最佳；<b>成功條件＝未排 0 且必須級 0</b>。
              排出來的課表由種子決定，同一顆種子永遠一樣；系統會自動跳過試過的，想直接換一批可按右邊那顆。
              排不完會診斷是哪些權重牽住了搜尋、建議降低。發布門檻：未排、必排未覆蓋與必須級違反皆須為 0。
            </span>
          </>
        )}
        {running && !progress && (
          <span className="text-xs text-zinc-500 ml-auto flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded-sm border text-[11px] font-medium bg-zinc-100 text-zinc-600 border-zinc-200">準備中</span>
            <span>正在把設定送進排課引擎…（第一次會停幾秒，屬正常）</span>
          </span>
        )}
        {running && progress && (
          <span className="text-xs text-zinc-500 ml-auto flex items-center gap-2">
            {progress.label && (
              <span className="px-1.5 py-0.5 rounded-sm border text-[11px] font-medium bg-zinc-100 text-zinc-600 border-zinc-200">{progress.label}</span>
            )}
            {(() => {
              // 必須級筆數：總分扣掉未排（1e5/堂）與軟分後，剩下的就是必須級（1e6/筆）——課都排進去不代表成功，這個也要 0
              const musts = Math.max(0, Math.round((progress.best - progress.unplaced * 1e5 - progress.softBest) / 1e6))
              return (
                <span className="flex items-center gap-2">
                  <span className={progress.unplaced ? 'text-red-600' : 'text-green-700'}>已排 {progress.placed}/{input.lessons.length}</span>
                  <span className={musts ? 'text-red-600 font-medium' : 'text-green-700'} title={musts ? '必須級規則被違反，這一版不算成功、也不能發布' : '目前沒有違反必須級規則'}>
                    必須級 {musts}
                  </span>
                  <span>軟規則罰分 {Math.round(progress.softBest)}｜迭代 {progress.iter.toLocaleString()}</span>
                </span>
              )
            })()}
            <span className="text-zinc-400">
              {progress.sinceImproveMs < 1500 ? '持續進步中…' : `${Math.floor(progress.sinceImproveMs / 1000)} 秒無進步`}
            </span>
            <span className="inline-block w-20 h-1.5 bg-zinc-200 rounded-full overflow-hidden">
              <span className="block h-full bg-zinc-600 rounded-full transition-all" style={{ width: `${Math.min(100, (progress.sinceImproveMs / 8000) * 100)}%` }} />
            </span>
          </span>
        )}
      </div>

      {/* 種子紀錄：跑一輪要十幾二十分鐘，人不一定在畫面前，回來要能一眼看出試了幾顆、每顆差在哪 */}
      {seedLog.length > 0 && (
        <div className="mt-2 text-xs">
          <button onClick={() => setSeedLogOpen(o => !o)}
            className="flex items-center gap-2 text-zinc-500 hover:text-zinc-700">
            <span className="text-[10px]">{seedLogOpen ? '▼' : '▶'}</span>
            <span>種子紀錄</span>
            <span className="text-zinc-400">
              已試 {seedLog.length} 顆・成功 {seedLog.filter(r => r.ok).length} 顆
              {seedLog.some(r => r.ok) ? '' : `・目前最好：未排 ${Math.min(...seedLog.map(r => r.unplaced))}、必須級 ${Math.min(...seedLog.map(r => r.musts))}`}
            </span>
          </button>
          {seedLogOpen && (
            <div className="mt-1.5 border border-zinc-200 rounded-sm overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500">
                    <th className="text-left font-medium px-2 py-1">第幾顆</th>
                    <th className="text-left font-medium px-2 py-1">結果</th>
                    <th className="text-right font-medium px-2 py-1">未排</th>
                    <th className="text-right font-medium px-2 py-1">必須級</th>
                    <th className="text-right font-medium px-2 py-1">軟規則罰分</th>
                    <th className="text-right font-medium px-2 py-1">耗時</th>
                    <th className="text-right font-medium px-2 py-1">結束於</th>
                    <th className="text-right font-medium px-2 py-1 text-zinc-400">種子</th>
                  </tr>
                </thead>
                <tbody>
                  {[...seedLog].reverse().map(r => (
                    <tr key={r.no} className="border-t border-zinc-100">
                      <td className="px-2 py-1">第 {r.no} 顆</td>
                      <td className="px-2 py-1">
                        {r.ok
                          ? <span className="text-green-700 font-medium">✓ 成功</span>
                          : <span className="text-zinc-500">✕ 沒排成</span>}
                      </td>
                      <td className={`px-2 py-1 text-right ${r.unplaced ? 'text-red-600' : 'text-zinc-400'}`}>{r.unplaced}</td>
                      <td className={`px-2 py-1 text-right ${r.musts ? 'text-red-600 font-medium' : 'text-zinc-400'}`}>{r.musts}</td>
                      <td className="px-2 py-1 text-right text-zinc-600">{r.soft.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right text-zinc-500">{Math.round(r.ms / 1000)} 秒</td>
                      <td className="px-2 py-1 text-right text-zinc-500">
                        {new Date(r.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-2 py-1 text-right text-zinc-300">{r.seed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-[11px] text-zinc-400">
            「未排」和「必須級」都要是 0 才算成功。紀錄留在這台電腦的瀏覽器裡，重新整理或關掉分頁都還在，按「開始排課」才會清空。
            沒排成的不會存成版本（免得把好版本擠掉）——要重現某一顆，記下它的種子號就夠了。
          </p>
        </div>
      )}

      {/* 發布後：年級總覽與調整模式。正在預覽舊版本時先讓位——同一畫面只出現一份課表，免得看錯 */}
      {(planStatus === 'published' || planStatus === 'final') && !previewVersionId && props.savedPlan && Array.isArray(props.savedPlan.placed) ? (
        <OverviewAdjust
          key={planStatus}
          year={year}
          planStatus={planStatus}
          setPlanStatus={setPlanStatus}
          savedPlan={props.savedPlan}
          extras={adjustExtras}
          homeroomRows={props.homeroomRows}
          planGeneratedAt={planAt}
          onPlanAt={setPlanAt}
          chainRequest={chainReq ?? undefined}
          onChainConsumed={() => setChainReq(null)}
          onVersionSaved={v => { loadVersions(); if (v?.id) setPreviewVersionId(v.id) }}
          baseHash={curBaseHash}
          engineInput={input}
          config={scheduleConfig}
          classCounts={classCounts}
          teacherNames={teacherNames}
        />
      ) : null}

      {/* 發布後：本土語場次（自動推導；管理者依實際情況切換狀態） */}
      {(planStatus === 'published' || planStatus === 'final') && nativeDerived.sessions.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm font-semibold text-zinc-700">本土語場次
              <span className="text-xs font-normal text-zinc-400 ml-2">由鎖課時段×語別課自動推導（設定在「排課設定 → 6 本土語場次」）。實體＝老師到校；線上＝老師線上授課；不開＝該時段沒有這個語別的學生（回原班上閩南語）。發布後臨時異動可在此改。</span>
            </div>
            <span className="text-xs">
              {nativeSaving === 'saving' && <span className="text-zinc-500">儲存中…</span>}
              {nativeSaving === 'saved' && <span className="text-green-600">✓ 已儲存</span>}
              {nativeSaving === 'error' && <span className="text-red-600">⚠ 儲存失敗，請再點一次</span>}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>時段</th><th>課程</th><th>年級</th><th>教師</th><th>教室</th><th className="text-center">狀態</th></tr></thead>
              <tbody>
                {nativeDerived.sessions.map(s => {
                  const [d, q] = s.slot.split('-').map(Number)
                  const key = `${s.slot}|${s.course}|${s.grade}`
                  const stateBtn = (st: 'physical' | 'stream' | 'cancelled', label: string, activeCls: string) => (
                    <button key={st} disabled={planStatus === 'final'}
                      onClick={() => setNativeState(key, st)}
                      className={`text-xs px-2 py-0.5 rounded-sm border ${s.state === st ? activeCls : 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-400'} ${planStatus === 'final' ? 'opacity-60 cursor-not-allowed' : ''}`}>
                      {label}
                    </button>
                  )
                  return (
                    <tr key={key} className={s.state === 'cancelled' ? 'opacity-50' : ''}>
                      <td className="whitespace-nowrap">{DAY_LABEL[d]}第{q}節</td>
                      <td className="whitespace-nowrap">{s.course}{s.lang && s.lang !== s.course && <span className="text-xs text-zinc-400 ml-1">（{s.lang}）</span>}</td>
                      <td className="whitespace-nowrap">{GRADE_LABEL[s.grade]}</td>
                      <td className="whitespace-nowrap">
                        {s.teacherId ? (teacherNames[s.teacherId] ?? '？') : <span className="text-red-500 text-xs">未配課</span>}{s.state === 'stream' && <span className="ml-1 text-xs text-sky-600">（線上）</span>}
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {s.state === 'cancelled' ? <span className="text-zinc-400">—（不開，回原班上閩南語）</span>
                          : s.roomId ? (nativeRoomNames[s.roomId] ?? s.roomId) : <span className="text-red-500">教室不足</span>}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <span className="inline-flex gap-1">
                          {stateBtn('physical', '實體', 'bg-green-600 text-white border-green-600')}
                          {stateBtn('stream', '線上', 'bg-sky-600 text-white border-sky-600')}
                          {stateBtn('cancelled', '不開', 'bg-zinc-500 text-white border-zinc-500')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {planStatus === 'final' && <p className="text-[11px] text-zinc-400">課表已定案，場次狀態唯讀；如需調整請先解除定案。</p>}
        </div>
      )}

      {result && (planStatus !== 'published' && planStatus !== 'final' ? true : Boolean(previewVersionId)) && (
        <>
          {/* 未達成功條件：診斷是權重牽制還是結構卡死 */}
          {runFailed && (
            <div className="card border-red-200 bg-red-50 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-sm font-semibold text-red-700">✕ 這一輪沒排成（未排 {result.unplaced.length}、必須級違反 {bigPenalty.reduce((s, p) => s + p.count, 0)}）——下方為最佳嘗試，已存成版本</div>
                {!running && <button onClick={() => run()} className="btn btn-primary text-xs py-0.5 ml-auto" title="同樣的設定重跑一輪：引擎會一顆一顆換種子，直到排出「未排 0、必須級 0」為止">▶ 重新排課</button>}
              </div>
              {bigPenalty.length > 0 && (
                <div className="text-xs text-red-700 space-y-0.5">
                  <div className="font-semibold">卡在：</div>
                  {bigPenalty.map(p => <div key={p.key}>・{p.label} {p.count} 筆：{p.items.slice(0, 6).join('；')}{p.items.length > 6 ? '…' : ''}</div>)}
                </div>
              )}
              {probePerfect === true && (
                <p className="text-xs text-zinc-600">純硬規則探測排得進，代表配課結構沒有卡死，只是這一輪沒找到同時滿足所有條件的排法——先換種子再跑；連跑幾輪都卡在同一筆，再考慮調整那一筆相關的設定（不排課／鎖課／配課）。</p>
              )}
              {probePerfect === false && (
                <p className="text-xs text-red-600">
                  純硬規則探測也排不完 → <b>不是權重問題</b>，是硬限制／配課結構卡死：請依未排清單的原因調整配課、科任配班、鎖課、排課/不排課標記或連堂矩陣後重排。
                  常見原因：某班導師不排課格數逼近該班科任課節數（零餘裕）、連堂科目配給不排課多的老師、同一位鐘點課太滿。
                </p>
              )}
              {probePerfect === null && <p className="text-xs text-red-600">已中途停止，未進行診斷。</p>}
            </div>
          )}
          {previewVersionId && (() => {
            const v = versions.find(x => x.id === previewVersionId)
            if (!v) return null
            // ro＝畫面上這份不是課表本身（預覽舊版本，或發布後只是看看）
            const ro = previewOnly || planStatus === 'published' || planStatus === 'final'
            return (
              <div className={`text-xs rounded-sm px-3 py-1.5 flex items-center gap-2 flex-wrap ${ro
                ? 'bg-amber-50 border border-amber-300 text-amber-800' : 'bg-zinc-50 border border-zinc-200 text-zinc-600'}`}>
                <span>{ro ? '👀 正在預覽（只是看看，課表沒有改）：' : '目前課表＝'}
                  <b>{v.seq ? `#${v.seq} ` : ''}{v.label || new Date(v.created_at).toLocaleString('zh-TW')}</b>
                  {v.label && <span className="opacity-70 ml-1">{new Date(v.created_at).toLocaleString('zh-TW')}</span>}</span>
                {ro && <>
                  <span className="opacity-80">版本只保存科任課，不含導師填的課。</span>
                  <span className="ml-auto flex gap-1.5">
                    {planStatus !== 'published' && planStatus !== 'final' && (
                      <button onClick={() => restoreVersion(v)} disabled={versionBusy === v.id}
                        title="把目前課表真的換成這一版，重新整理看到的也是它"
                        className="btn btn-primary text-xs py-0.5">↩ 套用這一版</button>
                    )}
                    <button onClick={() => location.reload()}
                      className="btn btn-secondary text-xs py-0.5">✕ 不看了，回目前課表</button>
                  </span>
                </>}
              </div>
            )
          })()}
          {/* 引擎內部說明（教室優先求解降級、收尾榨乾輪數）不顯示——課務組只在乎結果；仍存在 result.notes 供除錯 */}
          {/* 摘要 */}
          <div className="flex gap-2 flex-wrap text-xs">
            <span className="px-2 py-1 rounded-sm bg-green-50 text-green-700 border border-green-200">已排 {result.placed.length} 堂</span>
            <span className={`px-2 py-1 rounded-sm border ${result.unplaced.length ? 'bg-red-50 text-red-700 border-red-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}>未排 {result.unplaced.length} 堂</span>
            <span className={`px-2 py-1 rounded-sm border ${result.uncoveredMustFill.length ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
              {result.uncoveredMustFill.length ? `導師不排課未覆蓋 ${result.uncoveredMustFill.length} 格` : '✓ 導師不排課時段全覆蓋'}
            </span>
            <span className="px-2 py-1 rounded-sm bg-zinc-100 text-zinc-600 border border-zinc-200">
              軟規則罰分 {Math.round(result.softPenalty)}{bigPenalty.length > 0 && `（另有必須級違反）`}
            </span>
            <span className="ml-auto flex gap-2 items-center">
              <button onClick={() => setHealthOpen(true)} className="btn btn-primary text-xs py-1" title="導師／科任／鐘點三張熱力圖，並和本校人工課表對照">🩺 課表體檢</button>
              <button onClick={() => setPenaltyOpen(true)} className="btn btn-secondary text-xs py-1" title="每條規則違反的次數與扣分（給工程判讀用）">📊 罰分明細</button>
              <button onClick={() => setVersionsOpen(true)} className="btn btn-secondary text-xs py-1" title="歷次排課的保存紀錄">🗂 版本紀錄{verBadge()}</button>
            </span>
          </div>

          {/* 未排清單 */}
          {result.unplaced.length > 0 && (
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-semibold text-red-700">未排清單 <span className="text-xs font-normal text-zinc-400 ml-1">卡住的課與原因；可調權重重排，或之後手動處理</span></div>
              <table className="table-base mt-2">
                <thead><tr><th>班級</th><th>科目</th><th>教師</th><th>型態</th><th>卡住原因</th></tr></thead>
                <tbody>
                  {result.unplaced.map((u, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">{u.lesson.classLabel}</td>
                      <td className="whitespace-nowrap">{u.lesson.subject}</td>
                      <td className="whitespace-nowrap">{u.lesson.teacherName}</td>
                      <td className="whitespace-nowrap text-xs">{u.lesson.size === 2 ? '連堂' : '單節'}{u.lesson.parity !== 'weekly' && '（單雙週）'}</td>
                      <td className="text-xs text-zinc-500">{u.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 三視圖 */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {(['class', 'teacher', 'room'] as ViewKey[]).map(v => (
                <button key={v} onClick={() => setView(v)} className={`btn text-sm py-1 ${view === v ? 'btn-primary' : 'btn-secondary'}`}>
                  {v === 'class' ? '班級課表' : v === 'teacher' ? '科任教師課表' : '科任教室課表'}
                </button>
              ))}
              {view === 'class' && (
                <span className="flex gap-1 flex-wrap ml-auto">
                  {GRADES.filter(g => (classCounts[g] ?? 0) > 0).map(g => (
                    <button key={g} onClick={() => setGradeSel(g)} className={`text-xs px-2 py-1 rounded-sm border ${gradeSel === g ? 'bg-zinc-700 text-white border-zinc-700' : 'bg-white text-zinc-500 border-zinc-200'}`}>{GRADE_LABEL[g]}</button>
                  ))}
                </span>
              )}
              {view === 'teacher' && (
                <select value={teacherSel} onChange={e => setTeacherSel(e.target.value)} className="input py-1 text-sm w-44 ml-auto">
                  <option value="">選擇教師…</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {foreignList.length > 0 && (
                    <optgroup label="外師（協同）">
                      {foreignList.map(t => <option key={t.id} value={t.id}>★{t.name}</option>)}
                    </optgroup>
                  )}
                </select>
              )}
              {view === 'room' && (
                <select value={roomSel} onChange={e => setRoomSel(e.target.value)} className="input py-1 text-sm w-44 ml-auto">
                  <option value="">選擇教室…</option>
                  {roomList.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              )}
            </div>

            {planStatus !== 'published' && planStatus !== 'final' && draftPlanObj && (
              <OverviewAdjust
                key={`embed-${adjustSession}`}
                embedded
                gradeSel={gradeSel}
                mode={view}
                focusId={view === 'teacher' ? teacherSel : view === 'room' ? roomSel : undefined}
                extras={adjustExtras}
                year={year}
                planStatus="draft"
                setPlanStatus={setPlanStatus}
                savedPlan={resumedAdjustments ? { ...draftPlanObj, adjustments: resumedAdjustments } : draftPlanObj}
                homeroomRows={props.homeroomRows}
                planGeneratedAt={planAt}
                onPlanAt={setPlanAt}
                chainRequest={chainReq ?? undefined}
                onChainConsumed={() => setChainReq(null)}
                onVersionSaved={v => { loadVersions(); if (v?.id) setPreviewVersionId(v.id) }}
                baseHash={curBaseHash}
                engineInput={input}
                config={scheduleConfig}
                classCounts={classCounts}
                teacherNames={teacherNames}
                onPlacedChange={placed => setResult(r => r ? { ...r, placed } : r)}
                onPersisted={() => setDraftDirty(true)}
                onDirtyChange={setAdjustUnsaved}
                onGradeChange={g => { setGradeSel(g); setView('class') }}
                onDiscard={discardDraft}
              />
            )}
            {view === 'class' && (planStatus === 'published' || planStatus === 'final' || !draftPlanObj) && (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {input.classes.filter(c => c.grade === gradeSel).map(c => (
                  <div key={c.classKey} className="space-y-1">
                    <div className="text-sm font-semibold text-zinc-700">{c.label}
                      {/* 留白格＝導師可填的格數：單雙週課只占一格顯示，配對格還給導師 */}
                      <span className="text-xs font-normal text-zinc-400 ml-1">留白 {(input.classSlots[c.classKey]?.length ?? 0) - (byClass.get(c.classKey) ?? []).reduce((s, p) => s + (p.parity !== 'weekly' ? 1 : p.size), 0)} 格</span>
                    </div>
                    <Grid list={byClass.get(c.classKey) ?? []} mode="class" classKey={c.classKey} />
                  </div>
                ))}
              </div>
            )}
            {view === 'teacher' && (planStatus === 'published' || planStatus === 'final' || !draftPlanObj) && (teacherSel
              ? <div className="max-w-md"><Grid list={byTeacher.get(teacherSel) ?? []} mode="teacher" extra={nativeCellsByTeacher.get(teacherSel)} /></div>
              : <p className="text-sm text-zinc-400 text-center py-4">請選擇教師。</p>)}
            {view === 'room' && (planStatus === 'published' || planStatus === 'final' || !draftPlanObj) && (roomSel
              ? <div className="max-w-md"><Grid list={byRoom.get(roomSel) ?? []} mode="room" roomOff={(() => { const r = roomList.find(x => x.id === roomSel); return r ? { slots: new Set(r.offSlots), note: r.offNote } : undefined })()} /></div>
              : <p className="text-sm text-zinc-400 text-center py-4">{roomList.length ? '請選擇教室。' : '教室設定中沒有綁定科目的科任教室。'}</p>)}
          </div>

        </>
      )}

      {/* ── 課表體檢 modal：罰分是給引擎比較用的，這裡翻成課務組看得懂的三張熱力圖＋人工課表對照 ── */}
      {healthOpen && result && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setHealthOpen(false)}>
          <div className="bg-zinc-50 rounded-md shadow-xl w-full max-w-5xl p-4 my-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold text-zinc-900">課表體檢</h3>
                <p className="text-xs text-zinc-500">導師、科任、鐘點三個角度看這一版；紅格子點下去直接開連鎖調課</p>
              </div>
              <button onClick={() => setHealthOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
            </div>
            <ScheduleHealth
              placed={result.placed} hr={Object.fromEntries(props.homeroomRows.map((r: HomeroomRow) => [r.class_key, r]))}
              config={scheduleConfig} classCounts={classCounts} teacherNames={teacherNames}
              hourlyTeacherIds={hourlyTeacherIds}
              homeroomHours={homeroomHours}
              extraByTeacher={adjustExtras.teacher}
              onOpenChain={seed => { setChainReq({ seed, nonce: Date.now() }); setHealthOpen(false) }}
            />
          </div>
        </div>
      )}

      {/* ── 罰分明細 modal ── */}
      {penaltyOpen && result && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPenaltyOpen(false)}>
          <div className="bg-white rounded-md shadow-xl w-full max-w-2xl p-5 space-y-2 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-zinc-900">罰分明細</h3>
                <p className="text-xs text-zinc-500">每條規則違反的次數與扣分；不滿意可 <Link href="/admin/schedule-config?tab=weight" className="text-sky-600 underline">調整權重</Link> 後重排</p>
              </div>
              <button onClick={() => setPenaltyOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
            </div>
            {result.penalties.length === 0 && <p className="text-sm text-green-600">✓ 沒有任何軟規則違反，完美！</p>}
            {result.penalties.map(p => (
              <details key={p.key} className="border border-zinc-200 rounded-md">
                <summary className={`px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 ${p.points >= 1e6 ? 'text-red-700' : 'text-zinc-700'}`}>
                  <span className="flex-1">{p.points >= 1e6 && '🚨 '}{p.label}</span>
                  <span className="text-xs text-zinc-400">{p.count} 次｜{p.points >= 1e6 ? '必須級違反' : `${Math.round(p.points)} 分`}</span>
                </summary>
                <ul className="px-4 pb-2 text-xs text-zinc-500 list-disc pl-8 space-y-0.5">
                  {p.items.map((it, i) => <li key={i}>{it}</li>)}
                  {p.count > p.items.length && <li className="list-none text-zinc-400">…等共 {p.count} 筆</li>}
                </ul>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* ── 排課版本紀錄 ──
          每次排課完自動留一份快照（手動微調後儲存、落點真的變過時再留一份）。
          這裡只做保存與檢視，不提供「還原成舊版本」——舊版本的留白位置與導師已填的排課對不上，
          還原會讓導師填的內容失效，風險高於效益。 */}
      {versionsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setVersionsOpen(false)}>
          <div className="bg-white rounded-md shadow-xl w-full max-w-3xl p-5 space-y-2 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-zinc-900">排課版本紀錄<span className="text-xs font-normal text-zinc-500 ml-2">{versions.length} 份</span></h3>
                <p className="text-xs text-zinc-500">每次排課自動保存，最多留 20 份（加 ★ 者不會被自動刪除）</p>
              </div>
              <button onClick={() => setVersionsOpen(false)} className="text-zinc-400 hover:text-zinc-600 text-lg leading-none">×</button>
            </div>
            {versions.length === 0
              ? <p className="text-sm text-zinc-400 py-3">還沒有版本紀錄。按「開始排課」跑完一次就會自動保存一份。</p>
              : (() => {
                  // 「軟分最低」只在可發布（未排 0、必須級 0）的版本之間比，且必須是同一份基礎資料——
                  // 基礎資料變過的版本課本身就不一樣，分數不能拿來比。
                  const comparable = versions.filter(v =>
                    v.base_hash === curBaseHash && v.summary.scoring === SCORING_VERSION && !v.summary.unplaced && !v.summary.mustCount && typeof v.summary.softPenalty === 'number')
                  const bestSoft = comparable.length ? Math.min(...comparable.map(v => v.summary.softPenalty as number)) : null
                  return (
                    <table className="table-base no-hover mt-1">
                      <thead>
                        <tr>
                          <th className="w-8"></th><th>時間／名稱</th><th className="w-16 text-center">來源</th>
                          <th className="w-16 text-center">未排</th><th className="w-20 text-center">必須級</th>
                          <th className="w-20 text-center">軟分</th><th className="w-20">建立者</th><th className="w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {versions.map(v => {
                          const s = v.summary
                          const stale = v.base_hash !== curBaseHash
                          const oldScoring = v.source === 'engine' && s.scoring !== SCORING_VERSION   // 手動版本本來就標「未重算」
                          const ok = !s.unplaced && !s.mustCount
                          const isBest = !stale && ok && bestSoft !== null && s.softPenalty === bestSoft && comparable.length > 1
                          return (
                            <tr key={v.id} className={ok ? undefined : 'bg-red-50/60'}>
                              <td className="text-center">
                                <button onClick={() => patchVersion(v.id, { starred: !v.starred })}
                                  title={v.starred ? '取消星號（可能被保留上限自動刪除）' : '加星號（永久保留）'}
                                  className={v.starred ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-400'}>★</button>
                              </td>
                              <td>
                                <div className={ok ? 'text-zinc-800' : 'text-red-700'}>
                                  {v.seq ? <span className={`font-mono mr-1 ${ok ? 'text-zinc-500' : 'text-red-500'}`}>#{v.seq}</span> : null}
                                  {v.label || new Date(v.created_at).toLocaleString('zh-TW')}
                                  {!ok && <span className="ml-1.5 px-1 py-0.5 rounded-sm bg-red-100 text-red-700 text-[10px] align-middle">✕ 沒排成</span>}
                                </div>
                                <div className="text-[10px] text-zinc-400">
                                  {v.label && `${new Date(v.created_at).toLocaleString('zh-TW')}　`}
                                  {isBest && <span className="text-green-700">軟分最低</span>}
                                  {!ok && <span className="text-red-600">{[s.unplaced ? `未排 ${s.unplaced} 堂` : '', s.mustCount ? `必須級違反 ${s.mustCount} 筆` : ''].filter(Boolean).join('、')}——不可發布，僅供參考</span>}
                                  {stale && <span className="text-amber-600">{s.note ?? '基礎資料已變更（配課／鎖課／不排課有異動，分數不可與現況相比）'}</span>}
                                  {!stale && oldScoring && <span className="text-amber-600">舊計分（量級對齊前的算法，軟分不可與新版本相比）</span>}
                                </div>
                              </td>
                              <td className="text-center text-xs text-zinc-500">{v.source === 'manual' ? '手動調整' : '精靈'}</td>
                              <td className={`text-center ${s.unplaced ? 'text-red-600 font-medium' : 'text-zinc-400'}`}>{s.unplaced ?? '—'}</td>
                              <td className={`text-center ${s.mustCount ? 'text-red-600 font-medium' : 'text-zinc-400'}`}>{s.mustCount ?? '—'}</td>
                              <td className={`text-center ${isBest ? 'text-green-700 font-semibold' : 'text-zinc-600'}`}>{s.softPenalty ?? '—'}</td>
                              <td className="text-xs text-zinc-500">{v.created_by ? (versionNames[v.created_by] ?? '') : ''}</td>
                              <td className="text-right whitespace-nowrap">
                                <button onClick={() => previewVersion(v)} disabled={versionBusy === v.id}
                                  title="把預覽畫面切成這一份（不會動到正式課表）"
                                  className="btn btn-secondary text-xs py-0.5">{versionBusy === v.id ? '載入中…' : '預覽'}</button>
                                <button onClick={() => { const n = window.prompt('版本名稱（留空＝顯示時間）', v.label ?? ''); if (n !== null) patchVersion(v.id, { label: n }) }}
                                  className="ml-2 text-xs text-zinc-400 hover:text-sky-600">改名</button>
                                {planStatus === 'published' || planStatus === 'final'
                                  ? <span className="ml-2 text-xs text-zinc-300" title="課表已發布，版本紀錄鎖定保存；要刪除請先撤回發布">刪除</span>
                                  : <button onClick={() => deleteVersion(v)} className="ml-2 text-xs text-zinc-400 hover:text-red-500">刪除</button>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )
                })()}
            <p className="text-[11px] text-zinc-400 pt-2">
              未排與必須級是硬性條件，只要不是 0 就不能發布；軟分只在同一份基礎資料、且皆可發布的版本之間比較才有意義，
              分數接近時屬於雜訊、不代表誰比較好。逐版逐格比對之後再做。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
