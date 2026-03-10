import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (caller?.role !== 'admin' && caller?.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const work = url.searchParams.get('work')

  // 若帶 work 參數，回傳選了該職位的教師清單
  if (work) {
    const [{ data: prefs }, { data: profiles }] = await Promise.all([
      supabaseAdmin
        .from('preferences')
        .select('teacher_id, preference1, preference2, preference3'),
      supabaseAdmin
        .from('profiles')
        .select('id, name, email'),
    ])
    const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
    const detail: { name: string; email: string; rank: number }[] = []
    for (const p of prefs ?? []) {
      const ranks = [p.preference1, p.preference2, p.preference3]
      const idx = ranks.indexOf(work)
      if (idx === -1) continue
      const profile = profileMap[p.teacher_id]
      if (profile) detail.push({ name: profile.name ?? '（未填姓名）', email: profile.email, rank: idx + 1 })
    }
    detail.sort((a, b) => a.rank - b.rank || (a.name > b.name ? 1 : -1))
    return NextResponse.json(detail)
  }

  const { data: prefs } = await supabaseAdmin
    .from('preferences')
    .select('preference1, preference2, preference3')

  // 彙整各職位選填人數
  const stats: Record<string, { pref1: number; pref2: number; pref3: number }> = {}

  for (const p of prefs ?? []) {
    const fields = [
      { value: p.preference1, rank: 'pref1' as const },
      { value: p.preference2, rank: 'pref2' as const },
      { value: p.preference3, rank: 'pref3' as const },
    ]
    for (const { value, rank } of fields) {
      if (!value) continue
      if (!stats[value]) stats[value] = { pref1: 0, pref2: 0, pref3: 0 }
      stats[value][rank]++
    }
  }

  const result = Object.entries(stats)
    .map(([work, counts]) => ({
      work,
      pref1: counts.pref1,
      pref2: counts.pref2,
      pref3: counts.pref3,
      total: counts.pref1 + counts.pref2 + counts.pref3,
    }))
    .sort((a, b) => b.total - a.total)

  return NextResponse.json(result)
}
