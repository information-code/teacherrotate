import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const MAX_SIZE = 8 * 1024 * 1024 // 8MB

/** 上傳報修照片（FormData: file）。回傳 { path, url }，送出報修時夾帶 path。 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少檔案' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: '僅接受圖片檔' }, { status: 400 })
  if (file.size > MAX_SIZE) return NextResponse.json({ error: '圖片不可超過 8MB' }, { status: 400 })

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `repair/${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from('equipment-photos')
    .upload(path, await file.arrayBuffer(), { contentType: file.type })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: signed } = await supabaseAdmin.storage
    .from('equipment-photos')
    .createSignedUrl(path, 60 * 60)

  return NextResponse.json({ path, url: signed?.signedUrl ?? null })
}
