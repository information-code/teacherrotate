import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'

const BOOL_FIELDS = new Set([
  'local_language', 'four_language', 'sea_language', 'sign_language',
  'local_language_qualifications', 'english_specialty', 'english_specialty_20',
  'english_specialty_cef', 'guidance_specialty_qua', 'guidance_specialty_graduate',
  'guidance_specialty', 'bilingual_specialty', 'nature_specialty', 'tech_specialty',
  'life_specialty',
])

// Google Sheet 欄位名稱 → DB 欄位名稱
const COL_MAP: Record<string, string> = {
  phone:                      'phone',
  lineId:                     'line_id',
  university:                 'university',
  graduateSchool:             'graduate_school',
  creditClass:                'credit_class',
  otherEducation:             'other_education',
  localLanguage:              'local_language',
  'localLanguage-grade':      'local_language_grade',
  fourLanguage:               'four_language',
  'fourLanguage-grade':       'four_language_grade',
  seaLanguage:                'sea_language',
  'seaLanguage-grade':        'sea_language_grade',
  signlanguage:               'sign_language',
  'signlanguage-grade':       'sign_language_grade',
  localLanguagequalifications:'local_language_qualifications',
  englishSpecialty:           'english_specialty',
  'englishSpecialty-20':      'english_specialty_20',
  'englishSpecialty-CEF':     'english_specialty_cef',
  'guidanceSpecialty-qua':    'guidance_specialty_qua',
  'guidanceSpecialty-graduate':'guidance_specialty_graduate',
  guidanceSpecialty:          'guidance_specialty',
  'EnglishSpecialty-grade':   'english_specialty_grade',
  EnglishSpecialty:           'bilingual_specialty',
  natureSpecialty:            'nature_specialty',
  techSpecialty:              'tech_specialty',
  lifeSpecialty:              'life_specialty',
  othercheckbox:              'other_checkbox',
  otherLanguageText:          'other_language_text',
  'study-experience':         'study_experience',
  'research-publication':     'research_publication',
  'effective-teaching':       'effective_teaching',
  'public-lesson':            'public_lesson',
  'class-management':         'class_management',
  'professional-community':   'professional_community',
  'public-lecture':           'public_lecture',
  other:                      'other',
  'special-class-management': 'special_class_management',
  'competition-guidance':     'competition_guidance',
}

function parseBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val !== 0
  const s = String(val ?? '').trim().toUpperCase()
  return ['TRUE', '1', '是', 'O', '✓', 'Y', 'YES', 'V', 'OO'].includes(s)
}

function parseStr(val: unknown): string | null {
  const s = String(val ?? '').trim()
  return s || null
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = getAdminClient()
  const { data } = await admin.from('profiles').select('role').eq('id', user.id).single()
  return data?.role === 'admin' ? user : null
}

export async function POST(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: '無效的請求格式' }, { status: 400 })
  }

  const rows = (body as Record<string, unknown>)?.rows as Array<Record<string, unknown>>
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '無資料' }, { status: 400 })
  }

  // Debug: 回傳第一行的欄位名稱，確認 Excel 欄位是否對應
  const receivedColumns = Object.keys(rows[0] ?? {})
  const mappedColumns = receivedColumns.filter(c => c in COL_MAP)
  if (mappedColumns.length === 0) {
    return NextResponse.json({
      error: '欄位名稱無法對應，請確認 Excel 標題列',
      receivedColumns,
      expectedSample: Object.keys(COL_MAP).slice(0, 10),
    }, { status: 400 })
  }

  const admin = getAdminClient()
  let updated = 0
  let notFound = 0
  const errors: string[] = []

  for (const row of rows) {
    const email = parseStr(row['teacherMail'])
    if (!email || !email.includes('@')) continue

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (!profile) {
      notFound++
      errors.push(`${email}：找不到此教師帳號`)
      continue
    }

    // 建立 profile 更新物件
    const profileUpdate: Record<string, unknown> = {}
    for (const [col, field] of Object.entries(COL_MAP)) {
      if (!(col in row)) continue
      profileUpdate[field] = BOOL_FIELDS.has(field) ? parseBool(row[col]) : parseStr(row[col])
    }

    // Experience1 → experience JSONB
    const exp1 = parseStr(row['Experience1'])
    if (exp1 !== null) {
      profileUpdate['experience'] = JSON.stringify([{ year: '', detail: exp1 }])
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error: updateErr } = await admin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', profile.id)

      if (updateErr) {
        errors.push(`${email}：${updateErr.message}`)
        continue
      }
    }

    // 志願序
    const pref1 = parseStr(row['firstChoice'])
    const pref2 = parseStr(row['secondChoice'])
    const pref3 = parseStr(row['thirdChoice'])
    if (pref1 || pref2 || pref3) {
      await admin.from('preferences').upsert(
        { teacher_id: profile.id, preference1: pref1, preference2: pref2, preference3: pref3 },
        { onConflict: 'teacher_id' }
      )
    }

    updated++
  }

  return NextResponse.json({ updated, notFound, errors })
}
