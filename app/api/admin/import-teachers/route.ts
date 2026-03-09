import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = getAdminClient()
  const { data: caller } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (caller?.role !== 'admin') return null
  return user
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, name, email')
    .eq('role', 'teacher')
    .order('name')

  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '無效的請求格式' }, { status: 400 })
  }

  const teachers: Array<{ email: string; name?: string }> =
    (body as Record<string, unknown>)?.teachers as Array<{ email: string; name?: string }> ?? []

  if (!Array.isArray(teachers) || teachers.length === 0) {
    return NextResponse.json({ error: '請提供教師清單' }, { status: 400 })
  }

  const admin = getAdminClient()
  let created = 0
  let skipped = 0
  const errors: string[] = []
  const createdTeachers: Array<{ id: string; email: string; name: string | null }> = []

  for (const teacher of teachers) {
    const email = teacher.email?.trim()
    if (!email) continue

    try {
      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (existing) {
        skipped++
        continue
      }

      // 直接用 PostgreSQL function 寫入 auth.users，完全繞過 GoTrue 的 email 驗證
      const { data: authId, error: createErr } = await admin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .rpc('create_teacher_account' as never, { p_email: email, p_name: teacher.name ?? '' } as never)

      if (createErr || !authId) {
        errors.push(`${teacher.name ? teacher.name + ' ' : ''}${email}: ${createErr?.message ?? '建立失敗'}`)
        continue
      }

      const { error: upsertError } = await admin
        .from('profiles')
        .upsert({
          id: authId,
          email,
          name: teacher.name || null,
          role: 'teacher',
        })

      if (upsertError) {
        errors.push(`${email}: profile 建立失敗 - ${upsertError.message}`)
        continue
      }

      createdTeachers.push({ id: authId, email, name: teacher.name || null })
      created++
    } catch (e) {
      errors.push(`${email}: ${e instanceof Error ? e.message : '未知錯誤'}`)
    }
  }

  return NextResponse.json({ created, skipped, errors, teachers: createdTeachers })
}
