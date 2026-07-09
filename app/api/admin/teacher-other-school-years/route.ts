import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = getAdminClient()
  const { data } = await admin.from('profiles').select('role').eq('id', user.id).single()
  return (await hasPerms(user.id, ['teachers','rotations'])) ? user : null
}

export async function PUT(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { teacher_id, other_school_years } = await request.json()
  const years = Number(other_school_years)
  if (!teacher_id || !Number.isFinite(years) || years < 0 || years > 60) {
    return NextResponse.json({ error: '無效參數（年資需為 0–60 數值，可含小數）' }, { status: 400 })
  }
  const rounded = Math.round(years * 100) / 100  // NUMERIC(4,2)

  const admin = getAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ other_school_years: rounded })
    .eq('id', teacher_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
