import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 驗證呼叫者是 admin
  const { data: caller } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (caller?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: '請提供 email' }, { status: 400 })

  // 查詢目標教師
  const { data: target } = await supabaseAdmin
    .from('profiles')
    .select('id, role, name')
    .eq('email', email)
    .single()

  if (!target) {
    return NextResponse.json(
      { error: `找不到 ${email} 的使用者，請確認該教師已登入過系統` },
      { status: 404 }
    )
  }

  if (target.role === 'admin') {
    return NextResponse.json({ error: '此帳號已具有 admin 權限' }, { status: 400 })
  }

  // 升級為 admin
  await supabaseAdmin
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', target.id)

  return NextResponse.json({ success: true, name: target.name ?? email })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (caller?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, name, email, role')
    .eq('role', 'admin')
    .order('name')

  return NextResponse.json(data ?? [])
}
