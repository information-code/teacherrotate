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

/** 同名設備編號唯一檢查（不同名稱可同編號）。有衝突回傳 true */
async function assetNumberConflict(name: string, assetNumber: string, excludeId?: string): Promise<boolean> {
  const num = assetNumber.trim()
  if (!num) return false
  let query = supabaseAdmin.from('equipment')
    .select('id').eq('name', name.trim()).eq('asset_number', num)
  if (excludeId) query = query.neq('id', excludeId)
  const { data } = await query.limit(1)
  return Boolean(data && data.length > 0)
}

/** 設備庫列表 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { data, error } = await supabaseAdmin
    .from('equipment').select('*').order('name').order('asset_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

/** 新增設備 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const body = await request.json()
  if (!body?.name?.trim()) return NextResponse.json({ error: '請填寫設備名稱' }, { status: 400 })

  if (await assetNumberConflict(String(body.name), String(body.asset_number ?? ''))) {
    return NextResponse.json(
      { error: `「${String(body.name).trim()}」已有編號「${String(body.asset_number).trim()}」的設備，同名設備編號不可重複。` },
      { status: 400 }
    )
  }

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
  // 名稱或編號有變動時，以「更新後的名稱＋編號」檢查同名唯一
  if (fields.name !== undefined || fields.asset_number !== undefined) {
    const { data: current } = await supabaseAdmin
      .from('equipment').select('name, asset_number').eq('id', id).maybeSingle()
    if (!current) return NextResponse.json({ error: '找不到設備' }, { status: 404 })
    const effectiveName = String(fields.name ?? current.name)
    const effectiveNumber = String(fields.asset_number ?? current.asset_number)
    if (await assetNumberConflict(effectiveName, effectiveNumber, id)) {
      return NextResponse.json(
        { error: `「${effectiveName.trim()}」已有編號「${effectiveNumber.trim()}」的設備，同名設備編號不可重複。` },
        { status: 400 }
      )
    }
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
