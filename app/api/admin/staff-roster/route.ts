import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ADMIN_DUTIES, ALL_PERM_KEYS, DUTY_OFFICE_MAP } from '@/lib/staff'
import { hasPerms } from '@/lib/staff-server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!(await hasPerms(user.id, []))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { user }
}

/**
 * 權限名冊＋學年度現況。
 * 回傳 { roster, teachers, currentSchoolYear, preferenceYear }
 * roster 依處室、職務排序；teachers 為在職名單（改人下拉用）。
 */
export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const [roster, teachers, currentYear, prefYear] = await Promise.all([
    supabaseAdmin.from('staff_roster').select('*'),
    supabaseAdmin.from('profiles').select('id, name, email')
      .neq('status', 'inactive').order('name'),
    supabaseAdmin.from('settings').select('value').eq('key', 'current_school_year').maybeSingle(),
    supabaseAdmin.from('settings').select('value').eq('key', 'preference_year').maybeSingle(),
  ])
  const firstError = roster.error ?? teachers.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const nameMap = new Map((teachers.data ?? []).map(t => [t.id, t.name ?? t.email]))
  const order = new Map(ADMIN_DUTIES.map((d, i) => [d, i]))
  const rows = (roster.data ?? [])
    .sort((a, b) => (order.get(a.duty) ?? 99) - (order.get(b.duty) ?? 99))
    .map(r => ({ ...r, teacher_name: r.teacher_id ? nameMap.get(r.teacher_id) ?? null : null }))

  return NextResponse.json({
    roster: rows,
    teachers: teachers.data ?? [],
    currentSchoolYear: Number(currentYear.data?.value) || null,
    preferenceYear: Number(prefYear.data?.value) || null,
  })
}

/** 改人或改權限。body: { duty, teacher_id?, perms? } */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return auth.error

  const { duty, teacher_id, perms } = await request.json()
  if (!duty || !DUTY_OFFICE_MAP[duty]) {
    return NextResponse.json({ error: '職務無效' }, { status: 400 })
  }
  if (perms !== undefined
      && (!Array.isArray(perms) || perms.some(p => !ALL_PERM_KEYS.includes(String(p))))) {
    return NextResponse.json({ error: '權限項目無效' }, { status: 400 })
  }

  const payload: Record<string, unknown> = {
    duty,
    office: DUTY_OFFICE_MAP[duty],
    updated_at: new Date().toISOString(),
  }
  if (teacher_id !== undefined) payload.teacher_id = teacher_id || null
  if (perms !== undefined) payload.perms = perms

  const { data, error } = await supabaseAdmin.from('staff_roster')
    .upsert(payload as never, { onConflict: 'duty' }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
