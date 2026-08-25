import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

/** 版本快照的寫入邏輯（流水號、重試、保留上限）。
 *  原本只長在 /api/admin/schedule-plan-versions 裡，於是伺服器端直接改課表的功能
 *  （移動鎖課、換授課老師）都沒存到版本——課表變了卻沒有任何一張相片對得上。 */

/** 每年度保留的版本數上限（加星號者不計入、不會被自動刪除）。 */
export const KEEP = 30
/** seq 欄位由 migration 039 新增；尚未跑 migration 時 select／insert 會因欄位不存在而失敗 → 自動退回沒有 seq 的版本，清單照常可用 */
export const isSeqMissing = (e: { message?: string } | null) =>
  Boolean(e?.message && /seq/.test(e.message) && /column|schema cache/i.test(e.message))

export async function createPlanVersion(opts: {
  year: number
  plan: Json
  userId: string
  label?: string | null
  source?: 'manual' | 'engine'
  summary?: Json
  weights?: Json
  baseHash?: string
  /** 沒給 summary／weights 時沿用最近一個版本的。與人工微調同慣例：罰分是微調前的數值、未重算。 */
  inherit?: boolean
}): Promise<{ id: string; seq: number | null; pruned: number } | { error: string }> {
  const { year } = opts
  let summary = opts.summary, weights = opts.weights, baseHash = opts.baseHash
  if (opts.inherit && (summary === undefined || weights === undefined || baseHash === undefined)) {
    const { data: prev } = await supabaseAdmin.from('schedule_plan_version')
      .select('summary, weights, base_hash').eq('year', year)
      .order('created_at', { ascending: false }).limit(1)
    summary ??= prev?.[0]?.summary ?? {}
    weights ??= prev?.[0]?.weights ?? {}
    baseHash ??= String(prev?.[0]?.base_hash ?? '')
  }

  const row = {
    year,
    label: typeof opts.label === 'string' && opts.label.trim() ? opts.label.trim().slice(0, 60) : null,
    source: opts.source === 'engine' ? 'engine' : 'manual',
    base_hash: String(baseHash ?? ''),
    summary: summary ?? {},
    weights: weights ?? {},
    plan: opts.plan,
    created_by: opts.userId,
  }

  // 流水號：該年度目前最大 seq + 1（刪了舊版本也不重用，課務組講「第 N 版」才對得上）
  // 「先查最大值再寫」中間沒有鎖，兩台電腦同時存會拿到同一個號碼；(year, seq) 有唯一索引，
  // 所以其中一台會插入失敗。撞到就重查一次再寫，最多試三輪——機率很低，重試幾乎必成。
  let seq: number | null = null
  type VerRow = { id: string; created_at: string }
  type Err = { message?: string; code?: string }
  let data: VerRow | null = null
  let error: Err | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: mx, error: e1 } = await supabaseAdmin.from('schedule_plan_version')
      .select('seq').eq('year', year).order('seq', { ascending: false, nullsFirst: false }).limit(1)
    seq = e1 ? null : (Number(mx?.[0]?.seq) || 0) + 1
    const r = await supabaseAdmin.from('schedule_plan_version')
      .insert(seq !== null ? { ...row, seq } : row).select('id, created_at').single()
    data = (r.data as VerRow | null); error = (r.error as Err | null)
    if (!error) break
    if (seq !== null && isSeqMissing(error)) {   // 資料庫還沒有 seq 欄位（migration 未跑）
      const r2 = await supabaseAdmin.from('schedule_plan_version').insert(row).select('id, created_at').single()
      data = (r2.data as VerRow | null); error = (r2.error as Err | null)
      seq = null
      break
    }
    if (error.code !== '23505') break            // 不是唯一鍵衝突就不用重試
  }
  if (error || !data) return { error: error?.message ?? '存檔失敗' }

  // 保留上限：只刪沒加星號、而且比這一筆更早建立的舊版本。
  // 不加 lt 的話，兩台電腦同時存版本時，慢的那台可能把快的那台剛存好的版本當成「舊的」刪掉。
  const { data: olds } = await supabaseAdmin
    .from('schedule_plan_version')
    .select('id').eq('year', year).eq('starred', false).lt('created_at', data.created_at)
    .order('created_at', { ascending: false })
  const over = (olds ?? []).slice(Math.max(0, KEEP - 1)).map(v => v.id)
  if (over.length) await supabaseAdmin.from('schedule_plan_version').delete().in('id', over)

  return { id: data.id, seq, pruned: over.length }
}
