import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['repair-config']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 維護人員列表 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { data, error } = await supabaseAdmin
    .from('repair_contacts').select('*').order('sort_order').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** 新增維護人員 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  if (!body?.name?.trim()) return NextResponse.json({ error: '請填寫姓名' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('repair_contacts').insert({
    name: String(body.name).trim(),
    role: body.role === 'student' ? 'student' : 'teacher',
    contact: String(body.contact ?? ''),
    note: String(body.note ?? ''),
    active: body.active !== false,
    sort_order: Number(body.sort_order ?? 0),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新維護人員。body: { id, ...欄位 } */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少人員 id' }, { status: 400 })
  if (fields.name !== undefined && !String(fields.name).trim()) {
    return NextResponse.json({ error: '姓名不可為空' }, { status: 400 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.name !== undefined) payload.name = String(fields.name).trim()
  if (fields.role !== undefined) payload.role = fields.role === 'student' ? 'student' : 'teacher'
  if (fields.contact !== undefined) payload.contact = String(fields.contact)
  if (fields.note !== undefined) payload.note = String(fields.note)
  if (fields.active !== undefined) payload.active = Boolean(fields.active)
  if (fields.sort_order !== undefined) payload.sort_order = Number(fields.sort_order)

  const { data, error } = await supabaseAdmin
    .from('repair_contacts').update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除維護人員 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少人員 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('repair_contacts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
