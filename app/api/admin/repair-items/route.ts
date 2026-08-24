import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'
import { parseGuide } from '@/lib/repair'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, ['repair-config']))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 報修設備項目列表 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { data, error } = await supabaseAdmin
    .from('repair_items').select('*').order('sort_order').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** 新增設備項目 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  if (!body?.name?.trim()) return NextResponse.json({ error: '請填寫項目名稱' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('repair_items').insert({
    name: String(body.name).trim(),
    fallback_guide: parseGuide(body.fallback_guide) as never,
    active: body.active !== false,
    sort_order: Number(body.sort_order ?? 0),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新設備項目。body: { id, ...欄位 } */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少項目 id' }, { status: 400 })
  if (fields.name !== undefined && !String(fields.name).trim()) {
    return NextResponse.json({ error: '項目名稱不可為空' }, { status: 400 })
  }

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.name !== undefined) payload.name = String(fields.name).trim()
  if (fields.fallback_guide !== undefined) payload.fallback_guide = parseGuide(fields.fallback_guide)
  if (fields.active !== undefined) payload.active = Boolean(fields.active)
  if (fields.sort_order !== undefined) payload.sort_order = Number(fields.sort_order)

  const { data, error } = await supabaseAdmin
    .from('repair_items').update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除設備項目（連帶刪除其問題字典；既有案件保留名稱快照不受影響） */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少項目 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('repair_items').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
