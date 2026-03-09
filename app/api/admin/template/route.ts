import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import * as XLSX from 'xlsx'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 取得教師清單
  const { data: teachers } = await supabaseAdmin
    .from('profiles')
    .select('id, name, email')
    .eq('role', 'teacher')
    .order('name')

  const wb = XLSX.utils.book_new()

  // Sheet 1: 工作紀錄（每位教師預填一列，填入 year 和 work 即可）
  const templateData = (teachers ?? []).map(t => ({
    teacher_id: t.id,
    name: t.name ?? '',
    year: '',
    work: '',
  }))
  // 若無教師，補一列說明
  if (templateData.length === 0) {
    templateData.push({ teacher_id: '（無教師資料）', name: '', year: '', work: '' })
  }
  const ws1 = XLSX.utils.json_to_sheet(templateData)
  ws1['!cols'] = [{ wch: 38 }, { wch: 12 }, { wch: 8 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws1, '工作紀錄')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="rotations_template.xlsx"',
    },
  })
}
