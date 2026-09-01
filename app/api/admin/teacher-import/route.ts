import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { hasPerms } from '@/lib/staff-server'
import {
  EMAIL_HEADER,
  COLUMN_BY_HEADER,
  displayValue,
  parseCell,
  type TeacherColumn,
} from '@/lib/teacher-io'

export const dynamic = 'force-dynamic'

interface ChangeRow {
  header: string
  from: string
  to: string
}
interface UpdatePlan {
  id: string
  email: string
  name: string | null
  changes: ChangeRow[]
  patch: Record<string, unknown>
}
interface CreatePlan {
  email: string
  name: string | null
  patch: Record<string, unknown>
}

async function requireAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return (await hasPerms(user.id, ['teachers'])) ? user : null
}

export async function POST(request: Request) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '無效的請求格式' }, { status: 400 })
  }
  const { rows, commit } = (body ?? {}) as { rows?: Array<Record<string, unknown>>; commit?: boolean }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '無資料' }, { status: 400 })
  }

  // 檔案標題列裡認得的欄位；沒出現的欄位一律不動
  const headers = Object.keys(rows[0] ?? {})
  if (!headers.includes(EMAIL_HEADER)) {
    return NextResponse.json({
      error: `找不到「${EMAIL_HEADER}」欄，請用「匯出名單」下載的檔案修改後上傳`,
      receivedColumns: headers,
    }, { status: 400 })
  }
  const cols: TeacherColumn[] = headers
    .map(h => COLUMN_BY_HEADER[h])
    .filter((c): c is TeacherColumn => !!c)
  if (cols.length === 0) {
    return NextResponse.json({
      error: '除了 email 之外沒有任何認得的欄位，請確認標題列',
      receivedColumns: headers,
    }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: profiles, error: loadErr } = await admin
    .from('profiles')
    .select('*')
    .neq('role', 'superadmin')
  if (loadErr) {
    return NextResponse.json({ error: `讀取教師名單失敗：${loadErr.message}` }, { status: 500 })
  }
  const byEmail = new Map(
    (profiles ?? []).map(p => [String(p.email).trim().toLowerCase(), p])
  )

  const updates: UpdatePlan[] = []
  const creates: CreatePlan[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  let unchanged = 0

  rows.forEach((row, i) => {
    const lineNo = i + 2 // 標題列佔第 1 行
    const email = String(row[EMAIL_HEADER] ?? '').trim()
    if (!email) return // 整列留白，略過
    if (!email.includes('@')) {
      errors.push(`第 ${lineNo} 行：email 格式錯誤（${email}）`)
      return
    }
    const key = email.toLowerCase()
    if (seen.has(key)) {
      errors.push(`第 ${lineNo} 行：email 重複（${email}）`)
      return
    }
    seen.add(key)

    const patch: Record<string, unknown> = {}
    let bad = false
    for (const col of cols) {
      const parsed = parseCell(col, row[col.header])
      if (!parsed.ok) {
        errors.push(`第 ${lineNo} 行（${email}）：${parsed.message}`)
        bad = true
        continue
      }
      patch[col.field] = parsed.value
    }
    if (bad) return

    const existing = byEmail.get(key)
    if (!existing) {
      creates.push({
        email,
        name: (patch.name as string | null) ?? null,
        patch,
      })
      return
    }

    // 只留真的有變的欄位
    const changes: ChangeRow[] = []
    const diff: Record<string, unknown> = {}
    for (const col of cols) {
      const before = (existing as Record<string, unknown>)[col.field]
      const after = patch[col.field]
      const same = col.type === 'num'
        ? Number(before ?? 0) === Number(after ?? 0)
        : (before ?? null) === (after ?? null) || (!before && !after)
      if (same) continue
      diff[col.field] = after
      changes.push({
        header: col.header,
        from: displayValue(col, before),
        to: displayValue(col, after),
      })
    }
    if (changes.length === 0) { unchanged++; return }
    updates.push({ id: existing.id, email: existing.email, name: existing.name, changes, patch: diff })
  })

  // ── 預覽 ─────────────────────────────────────────────
  if (!commit) {
    return NextResponse.json({
      dryRun: true,
      recognizedColumns: cols.map(c => c.header),
      ignoredColumns: headers.filter(h => h !== EMAIL_HEADER && !COLUMN_BY_HEADER[h]),
      updates: updates.map(({ patch: _patch, ...u }) => u),
      creates: creates.map(({ patch: _patch, ...c }) => c),
      unchanged,
      errors,
    })
  }

  // ── 實際寫入 ─────────────────────────────────────────
  if (errors.length > 0) {
    return NextResponse.json({ error: '資料有誤，請先修正後再匯入', errors }, { status: 400 })
  }

  let updated = 0
  let created = 0
  const failed: string[] = []

  for (const u of updates) {
    const { error } = await admin.from('profiles').update(u.patch).eq('id', u.id)
    if (error) failed.push(`${u.email}：更新失敗 - ${error.message}`)
    else updated++
  }

  for (const c of creates) {
    const { data: authId, error: createErr } = await admin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .rpc('create_teacher_account' as never, { p_email: c.email, p_name: c.name ?? '' } as never)
    if (createErr || !authId) {
      failed.push(`${c.email}：建立帳號失敗 - ${createErr?.message ?? '未知錯誤'}`)
      continue
    }
    const { error: upsertErr } = await admin
      .from('profiles')
      .upsert({ ...c.patch, id: authId as string, email: c.email, role: 'teacher' })
    if (upsertErr) {
      failed.push(`${c.email}：profile 建立失敗 - ${upsertErr.message}`)
      continue
    }
    created++
  }

  return NextResponse.json({ updated, created, unchanged, failed })
}
