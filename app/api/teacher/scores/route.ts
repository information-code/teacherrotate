import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [rotationsResult, scoresResult] = await Promise.all([
    supabase
      .from('rotations')
      .select('year, work')
      .eq('teacher_id', user.id)
      .order('year', { ascending: true }),
    supabase
      .from('scores')
      .select('year, score, recent_four_year_total')
      .eq('teacher_id', user.id)
      .order('year', { ascending: true }),
  ])

  return NextResponse.json({
    rotations: rotationsResult.data ?? [],
    scores: scoresResult.data ?? [],
  })
}
