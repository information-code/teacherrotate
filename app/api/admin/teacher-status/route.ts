import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = getAdminClient()
  const { data } = await admin.from('profiles').select('role').eq('id', user.id).single()
  return (data?.role === 'admin' || data?.role === 'superadmin') ? user : null
}

export async function PUT(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { teacher_id, status } = await request.json()
  if (!teacher_id || !['active', 'inactive'].includes(status)) {
    return NextResponse.json({ error: '無效參數' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ status })
    .eq('id', teacher_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
