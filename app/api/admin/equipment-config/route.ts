import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin, loadEquipmentConfig } from '@/lib/equipment-server'
import { normalizeEquipmentConfig } from '@/lib/equipment'

/** 讀取設備借用全域設定（含預設值補齊） */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json(await loadEquipmentConfig())
}

/** 儲存設備借用全域設定。body: config 物件 */
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = normalizeEquipmentConfig(await request.json())
  const { error } = await supabaseAdmin
    .from('equipment_config')
    .upsert({ id: 1, config: config as never, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
