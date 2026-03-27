import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'

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
  return { user, role: profile.role as string }
}

// GET: 列出所有 teacher / admin role 的 profile，並標示是否已完成 Google 登入
export async function GET() {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getAdminClient()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, name, email, role, created_at')
    .in('role', ['teacher', 'admin'])
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
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email } = await request.json()
  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: '姓名與 Email 為必填' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('profiles')
    .insert({
      id: randomUUID(),
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

// PATCH: 更新教師 email 或 role
export async function PATCH(request: NextRequest) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id 為必填' }, { status: 400 })

  const admin = getAdminClient()

  // role 異動：僅 superadmin 可操作
  if ('role' in body) {
    if (caller.role !== 'superadmin') {
      return NextResponse.json({ error: '僅超級管理員可變更角色' }, { status: 403 })
    }
    const newRole = body.role as string
    if (!['teacher', 'admin'].includes(newRole)) {
      return NextResponse.json({ error: '無效的角色' }, { status: 400 })
    }
    const { error } = await admin.from('profiles').update({ role: newRole }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // email 異動
  const { email } = body
  if (!email?.trim()) return NextResponse.json({ error: 'email 為必填' }, { status: 400 })

  const { data, error } = await admin
    .from('profiles')
    .update({ email: email.trim().toLowerCase() })
    .eq('id', id)
    .select('id, name, email, role, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '此 Email 已被其他帳號使用' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// DELETE: 刪除教師 profile
export async function DELETE(request: NextRequest) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
