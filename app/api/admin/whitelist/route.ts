import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'superadmin')) return null
  return user
}

// GET: 列出所有 teacher role 的 profile，並標示是否已完成 Google 登入
export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getAdminClient()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, name, email, created_at')
    .eq('role', 'teacher')
    .order('name')

  // 取得已登入的 auth users email 集合
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const authEmailSet = new Set(users.map(u => u.email))

  const result = (profiles ?? []).map(p => ({
    ...p,
    logged_in: authEmailSet.has(p.email),
  }))

  return NextResponse.json(result)
}

// POST: 新增教師（管理者預建 profile）
export async function POST(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email } = await request.json()
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: '姓名與 Email 為必填' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: 'teacher',
    })
    .select('id, name, email, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '此 Email 已存在' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ...data, logged_in: false }, { status: 201 })
}

// DELETE: 刪除教師 profile
export async function DELETE(request: NextRequest) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 為必填' }, { status: 400 })

  const admin = getAdminClient()
  const { error } = await admin
    .from('profiles')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
