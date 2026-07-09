import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'
import { VIRTUAL_EMAIL_DOMAIN } from '@/lib/utils'
import { defaultTeacherAllocation } from '@/lib/allocation'
import { hasPerms } from '@/lib/staff-server'

// 聘任別合法值：正式 / 代理 / 鐘點（鐘點僅可用設備借用）
const EMPLOYMENT_TYPES = ['formal', 'substitute', 'hourly']

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
  if (!(await hasPerms(user.id, ['whitelist']))) return null
  return { user, role: (profile?.role ?? 'teacher') as string }
}

// GET: 列出所有 teacher / admin role 的 profile，並標示是否已完成 Google 登入
export async function GET() {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = getAdminClient()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, name, email, role, employment_type, created_at')
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

// POST: 新增教師（管理者預建 profile）。
// virtual=true 為「待聘（虛擬）帳號」：甄選未放榜先建帳號假性配課排課，
// email 以占位格式產生，考上後改為真實信箱即轉正。
export async function POST(request: NextRequest) {
  const caller = await requireAdmin()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, employmentType, virtual, virtualRole, virtualGrade } = await request.json()
  if (!name?.trim() || (!virtual && !email?.trim())) {
    return NextResponse.json({ error: '姓名與 Email 為必填' }, { status: 400 })
  }

  const admin = getAdminClient()
  const finalEmail = virtual
    ? `pending-${randomUUID().slice(0, 8)}${VIRTUAL_EMAIL_DOMAIN}`
    : email.trim().toLowerCase()
  const { data, error } = await admin
    .from('profiles')
    .insert({
      id: randomUUID(),
      name: name.trim(),
      email: finalEmail,
      role: 'teacher',
      employment_type: virtual ? 'substitute' : EMPLOYMENT_TYPES.includes(employmentType) ? employmentType : 'formal',
    })
    .select('id, name, email, employment_type, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: '此 Email 已存在' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 虛擬帳號同時建立配課角色（代理導師/代理科任），讓配班與排課立即可用
  if (virtual && data && (virtualRole === 'homeroom' || virtualRole === 'subject')) {
    const { data: settingsRows } = await admin.from('settings').select('value').eq('key', 'preference_year')
    const year = Number(settingsRows?.[0]?.value ?? 115)
    const work = virtualRole === 'homeroom' ? '代理導師' : '代理科任'
    const grade = virtualRole === 'homeroom' ? (Number(virtualGrade) || null) : null
    await admin.from('allocation').upsert(
      { year, teacher_id: data.id, data: JSON.parse(JSON.stringify(defaultTeacherAllocation(virtualRole, work, grade))) },
      { onConflict: 'year,teacher_id' },
    )
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

  // 聘任別異動（正式/代理/鐘點）
  if ('employment_type' in body) {
    const t = EMPLOYMENT_TYPES.includes(body.employment_type) ? body.employment_type : 'formal'
    const { error } = await admin.from('profiles').update({ employment_type: t }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // email 異動（虛擬帳號轉正時可同時更新姓名；merge=true 為合併到既有帳號）
  const { email, name: newName, merge } = body
  if (!email?.trim()) return NextResponse.json({ error: 'email 為必填' }, { status: 400 })
  const normEmail = email.trim().toLowerCase()

  const { data: current } = await admin.from('profiles').select('id, email').eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: '帳號不存在' }, { status: 404 })
  const isVirtual = Boolean(current.email?.endsWith(VIRTUAL_EMAIL_DOMAIN))

  // 合併：待聘（虛擬）帳號 → 既有老師。把配課帶過去（同年度以待聘帳號為準）、
  // 配班/排課/撕榜 JSON 引用改指既有帳號，最後刪除虛擬帳號。
  if (merge === true) {
    if (!isVirtual) return NextResponse.json({ error: '僅待聘帳號可合併' }, { status: 400 })
    const { data: target } = await admin.from('profiles').select('id, name, email').eq('email', normEmail).maybeSingle()
    if (!target) return NextResponse.json({ error: '找不到該 Email 的既有帳號' }, { status: 404 })
    if (target.id === id) return NextResponse.json({ error: '不可合併到自己' }, { status: 400 })

    const { data: vAllocs } = await admin.from('allocation').select('year, data').eq('teacher_id', id)
    for (const row of vAllocs ?? []) {
      const { error: e1 } = await admin.from('allocation').upsert(
        { year: row.year, teacher_id: target.id, data: row.data },
        { onConflict: 'year,teacher_id' },
      )
      if (e1) return NextResponse.json({ error: `配課轉移失敗：${e1.message}` }, { status: 500 })
    }
    await admin.from('allocation').delete().eq('teacher_id', id)

    const { error: e2 } = await admin.rpc('relink_profile_refs', { old_id: id, new_id: target.id })
    if (e2) return NextResponse.json({ error: `引用轉移失敗：${e2.message}` }, { status: 500 })

    const { error: e3 } = await admin.from('profiles').delete().eq('id', id)
    if (e3) return NextResponse.json({ error: `刪除待聘帳號失敗：${e3.message}` }, { status: 500 })

    return NextResponse.json({ merged: true, target })
  }

  const { data, error } = await admin
    .from('profiles')
    .update({
      email: normEmail,
      ...(typeof newName === 'string' && newName.trim() ? { name: newName.trim() } : {}),
    })
    .eq('id', id)
    .select('id, name, email, role, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      // 待聘帳號撞到既有帳號 → 回傳可合併資訊，讓前端詢問
      if (isVirtual) {
        const { data: exist } = await admin.from('profiles').select('name').eq('email', normEmail).maybeSingle()
        return NextResponse.json({
          error: '此 Email 已被其他帳號使用',
          canMerge: true,
          conflictName: exist?.name ?? null,
        }, { status: 409 })
      }
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
