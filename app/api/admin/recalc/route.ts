import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { recalcAllScores } from '@/lib/recalc-scores'

export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single()
  if (data?.role !== 'admin' && data?.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const recalculated = await recalcAllScores()
  return NextResponse.json({ success: true, recalculated })
}
