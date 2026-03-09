import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { calculateTeacherScores, calcRecentFourYearTotal, buildScoreMaps } from '@/lib/score-engine'

export const maxDuration = 60

async function checkAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin'
}

/** 重新計算指定教師列表的分數並寫入 scores 表 */
async function recalcScores(teacherIds: string[]) {
  // 取得 scoremap
  const { data: scoremapRows } = await supabaseAdmin
    .from('scoremap').select('*')
  const { scoreMap, groupMap } = buildScoreMaps(scoremapRows ?? [])

  for (const teacherId of teacherIds) {
    const { data: rotData } = await supabaseAdmin
      .from('rotations')
      .select('year, work')
      .eq('teacher_id', teacherId)
      .order('year', { ascending: true })

    if (!rotData || rotData.length === 0) continue

    const yearScores = calculateTeacherScores(rotData, scoreMap, groupMap)
    const total = calcRecentFourYearTotal(yearScores)
    const maxYear = Math.max(...Object.keys(yearScores).map(Number))

    const upserts = Object.entries(yearScores).map(([y, score]) => ({
      teacher_id: teacherId,
      year: Number(y),
      score,
      recent_four_year_total: Number(y) === maxYear ? total : null,
    }))

    if (upserts.length > 0) {
      await supabaseAdmin
        .from('scores')
        .upsert(upserts, { onConflict: 'teacher_id,year' })
    }
  }
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const teacherId = url.searchParams.get('teacher_id')

  let rotQuery = supabaseAdmin
    .from('rotations')
    .select('id, teacher_id, year, work')
    .order('year', { ascending: true })

  if (teacherId) rotQuery = rotQuery.eq('teacher_id', teacherId)

  const [{ data: rotData, error }, { data: profilesData }, { data: scores }] = await Promise.all([
    rotQuery,
    supabaseAdmin.from('profiles').select('id, name, email'),
    supabaseAdmin.from('scores').select('teacher_id, year, score, recent_four_year_total'),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const profileMap = Object.fromEntries((profilesData ?? []).map(p => [p.id, p]))
  const rotations = (rotData ?? []).map(r => ({ ...r, profiles: profileMap[r.teacher_id] ?? null }))

  return NextResponse.json({ rotations, scores: scores ?? [] })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, work } = await request.json()
  if (!id || !work) return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 })

  const { data: rotation, error } = await supabaseAdmin
    .from('rotations')
    .update({ work })
    .eq('id', id)
    .select('teacher_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 重算此教師分數
  await recalcScores([rotation.teacher_id])
  return NextResponse.json({ success: true })
}

/** 批次匯入 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { rows } = await request.json() as {
    rows: { teacher_id?: string; teacherMail?: string; year: number; work: string }[]
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '無資料' }, { status: 400 })
  }

  // 若有 email，先建立 email→id 對照表
  const emails = [...new Set(rows.map(r => r.teacherMail?.trim()).filter(Boolean))] as string[]
  const emailToId: Record<string, string> = {}
  if (emails.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .in('email', emails)
    for (const p of profiles ?? []) emailToId[p.email] = p.id
  }

  const valid: { teacher_id: string; year: number; work: string }[] = []
  const errors: string[] = []

  rows.forEach((row, i) => {
    const lineNum = i + 2
    const year = Number(row.year)
    const work = String(row.work ?? '').trim()

    if (!work) { errors.push(`第 ${lineNum} 行：work 為空`); return }
    if (isNaN(year) || year < 100) { errors.push(`第 ${lineNum} 行：year 格式錯誤（應為民國年）`); return }

    let teacherId = row.teacher_id ? String(row.teacher_id).trim() : ''

    if (!teacherId && row.teacherMail) {
      const email = row.teacherMail.trim()
      teacherId = emailToId[email] ?? ''
      if (!teacherId) { errors.push(`第 ${lineNum} 行：找不到教師 ${email}`); return }
    }

    if (!teacherId) { errors.push(`第 ${lineNum} 行：缺少 teacher_id 或 teacherMail`); return }

    valid.push({ teacher_id: teacherId, year, work })
  })

  if (valid.length === 0) {
    return NextResponse.json({ imported: 0, errors }, { status: 400 })
  }

  const { error: upsertError } = await supabaseAdmin
    .from('rotations')
    .upsert(valid, { onConflict: 'teacher_id,year' })

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  const affected = [...new Set(valid.map(r => r.teacher_id))]
  await recalcScores(affected)

  return NextResponse.json({ imported: valid.length, errors, recalculated: affected.length })
}
