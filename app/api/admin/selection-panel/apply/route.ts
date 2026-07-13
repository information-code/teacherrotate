import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recalcTeacherScores } from '@/lib/recalc-scores'
import { slotToRotation } from '@/lib/selection-slots'
import { getRotationTarget } from '@/lib/rotation-target'
import { hasPerms } from '@/lib/staff-server'

export const maxDuration = 60

async function checkAdmin(userId: string) {
  return hasPerms(userId, ['selection-panel'])
}

type Rot = { teacher_id: string; year: number; work: string; grade: number | null }

// 連任導師的年級推定：沒進撕榜＝帶原班升上去，必落在偶數年級。
// 去年 1/3/5 → +1；去年年級也未填 → 依年段推偶數年級（低→2、中→4、高→6）；
// 異常（去年已是偶數年級，理應輪動）→ 保留原值不硬猜，由前端「⚠ 年級未填」警示接手。
const HOMEROOM_EVEN: Record<string, number> = { '低年級導師': 2, '中年級導師': 4, '高年級導師': 6 }
function continuedGrade(work: string, prevGrade: number | null): number | null {
  const even = HOMEROOM_EVEN[work]
  if (!even) return prevGrade
  if (prevGrade === 1 || prevGrade === 3 || prevGrade === 5) return prevGrade + 1
  if (prevGrade == null) return even
  return prevGrade
}

/**
 * 套用撕榜結果到工作紀錄，一鍵讓全校在校老師都有當年度工作：
 *   1. 已分配（撕榜）老師：寫入其槽位對應的 work/grade（改/加都覆蓋）。
 *   2. 面板名單內（本輪需換工作的目標老師）但這次未分配者：清掉其殘留的當年度
 *      紀錄與分數（反映「移除」；不碰名單外的手動資料）。
 *   3. 非撕榜（本輪不需換工作）的在校老師：若尚無當年度紀錄，複製其最近一年原職
 *      為當年度（連任）。只補、不覆蓋。
 * 目標／最新職位皆以「該年度之前（year < yr）」的紀錄判定，確保可重複套用。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPerms(user.id, ['selection-panel']))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year } = await request.json()
  const yr = Number(year)
  if (!Number.isInteger(yr)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  // 撕榜配置
  const { data: panel } = await supabaseAdmin
    .from('selection_panel').select('data').eq('year', yr).maybeSingle()
  const placements = (panel?.data as { placements?: Record<string, string> } | null)?.placements ?? {}
  const placedSet = new Set(Object.keys(placements))

  // 在校老師 + 其所有 rotation
  const { data: activeProfiles } = await supabaseAdmin
    .from('profiles').select('id').neq('status', 'inactive').neq('role', 'superadmin')
  const activeIds = (activeProfiles ?? []).map(p => p.id)
  const { data: rotData } = activeIds.length
    ? await supabaseAdmin.from('rotations').select('teacher_id, year, work, grade').in('teacher_id', activeIds)
    : { data: [] as Rot[] }

  // 每位老師「該年度之前」的 rotation（判定目標與最新職位用），與是否已有當年度紀錄
  const priorRots: Record<string, Rot[]> = {}
  const has115 = new Set<string>()
  const curRots: Record<string, Rot> = {}   // 當年度既有紀錄（年級回填用）
  for (const r of (rotData ?? []) as Rot[]) {
    if (r.year === yr) { has115.add(r.teacher_id); curRots[r.teacher_id] = r; continue }
    if (r.year < yr) (priorRots[r.teacher_id] ??= []).push(r)
  }
  const latestPriorGrade = (id: string) => {
    const latest = [...(priorRots[id] ?? [])].sort((a, b) => b.year - a.year)[0]
    return latest?.grade ?? null
  }

  // 1. 已分配（撕榜）→ upsert
  const upserts: (Rot & { semester: string })[] = []
  const skipped: string[] = []
  for (const [teacherId, slotId] of Object.entries(placements)) {
    const mapped = slotToRotation(slotId)
    if (!mapped) { skipped.push(slotId); continue }
    upserts.push({ teacher_id: teacherId, year: yr, work: mapped.work, grade: mapped.grade, semester: '全學年' })
  }

  // 分類在校老師：本輪是否為「需換工作」目標
  const toDelete: string[] = []   // 名單內、未分配、有殘留 → 刪
  const filled: string[] = []
  for (const id of activeIds) {
    const isTarget = getRotationTarget(priorRots[id] ?? []) !== null
    if (isTarget) {
      // 2. 名單內、這次沒被分配、且有殘留當年度紀錄 → 清除
      if (!placedSet.has(id) && has115.has(id)) toDelete.push(id)
    } else {
      // 3. 非目標（連任）→ 若無當年度紀錄，複製最近一年原職；導師連任＝帶原班升年級（1/3/5→2/4/6）
      if (has115.has(id)) continue
      const latest = [...(priorRots[id] ?? [])].sort((a, b) => b.year - a.year)[0]
      if (!latest) continue
      upserts.push({ teacher_id: id, year: yr, work: latest.work, grade: continuedGrade(latest.work, latest.grade), semester: '全學年' })
      filled.push(id)
    }
  }

  if (upserts.length) {
    const { error } = await supabaseAdmin.from('rotations').upsert(upserts, { onConflict: 'teacher_id,year' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (toDelete.length) {
    await supabaseAdmin.from('rotations').delete().eq('year', yr).in('teacher_id', toDelete)
    await supabaseAdmin.from('scores').delete().eq('year', yr).in('teacher_id', toDelete)
  }

  // 4. 既有當年度紀錄但年級空白的導師（手動補建/匯入所留）：未進撕榜＝連任，回填年級
  const backfilled: string[] = []
  for (const [id, cur] of Object.entries(curRots)) {
    if (placedSet.has(id)) continue                       // 撕榜者已由步驟 1 覆蓋
    if (cur.grade != null || !HOMEROOM_EVEN[cur.work]) continue
    const g = continuedGrade(cur.work, latestPriorGrade(id))
    if (g == null) continue
    const { error } = await supabaseAdmin.from('rotations').update({ grade: g }).eq('teacher_id', id).eq('year', yr)
    if (!error) backfilled.push(id)
  }

  const affected = Array.from(new Set([...upserts.map(u => u.teacher_id), ...toDelete]))
  if (affected.length) await recalcTeacherScores(affected)

  const appliedPlaced = upserts.length - filled.length
  return NextResponse.json({ ok: true, applied: appliedPlaced, filled: filled.length, removed: toDelete.length, backfilled: backfilled.length, skipped })
}
