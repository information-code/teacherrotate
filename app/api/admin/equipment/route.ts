import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await checkAdmin(user.id))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/** 設備庫列表 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { data, error } = await supabaseAdmin
    .from('equipment').select('*').order('sort_order').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** 新增設備 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  if (!body?.name?.trim()) return NextResponse.json({ error: '請填寫設備名稱' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('equipment').insert({
    name: String(body.name).trim(),
    location: String(body.location ?? ''),
    asset_number: String(body.asset_number ?? ''),
    peripherals: body.peripherals ?? [],
    borrow_checklist: body.borrow_checklist ?? [],
    return_checklist: body.return_checklist ?? [],
    status: body.status ?? 'available',
    notes: String(body.notes ?? ''),
    sort_order: Number(body.sort_order ?? 0),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 更新設備。body: { id, ...欄位 } */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { id, ...fields } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少設備 id' }, { status: 400 })
  if (fields.name !== undefined && !String(fields.name).trim()) {
    return NextResponse.json({ error: '設備名稱不可為空' }, { status: 400 })
  }

  const allowed = ['name', 'location', 'asset_number', 'peripherals', 'borrow_checklist', 'return_checklist', 'status', 'notes', 'sort_order'] as const
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) if (fields[key] !== undefined) payload[key] = fields[key]

  const { data, error } = await supabaseAdmin
    .from('equipment').update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** 刪除設備（連帶借用紀錄，僅限沒有歷史需要保留時使用；一般建議改為停用） */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: '缺少設備 id' }, { status: 400 })

  const { error } = await supabaseAdmin.from('equipment').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
