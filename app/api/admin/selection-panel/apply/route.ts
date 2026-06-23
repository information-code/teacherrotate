import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recalcTeacherScores } from '@/lib/recalc-scores'
import { slotToRotation } from '@/lib/selection-slots'

export const maxDuration = 60

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

/**
 * 套用撕榜結果到工作紀錄：把該年度已儲存的 placements 寫進 rotations
 * （teacher_id, year, work, grade, semester=全學年），再重算受影響教師分數。
 * 以伺服器端已儲存的資料為準（前端套用前應先存檔）。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { year } = await request.json()
  const yr = Number(year)
  if (!Number.isInteger(yr)) return NextResponse.json({ error: '年度格式錯誤' }, { status: 400 })

  const { data: row } = await supabaseAdmin
    .from('selection_panel').select('data').eq('year', yr).maybeSingle()
  const placements = (row?.data as { placements?: Record<string, string> } | null)?.placements ?? {}

  const rotations: { teacher_id: string; year: number; work: string; grade: number | null; semester: string }[] = []
  const skipped: string[] = []
  for (const [teacherId, slotId] of Object.entries(placements)) {
    const mapped = slotToRotation(slotId)
    if (!mapped) { skipped.push(slotId); continue }
    rotations.push({ teacher_id: teacherId, year: yr, work: mapped.work, grade: mapped.grade, semester: '全學年' })
  }

  if (rotations.length === 0) {
    return NextResponse.json({ error: '尚無可套用的配置（請先在面板分配教師並儲存）' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('rotations')
    .upsert(rotations, { onConflict: 'teacher_id,year' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const affected = rotations.map(r => r.teacher_id)
  await recalcTeacherScores(affected)

  return NextResponse.json({ ok: true, applied: rotations.length, skipped })
}
