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
  if (caller?.role !== 'admin' && caller?.role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 取得所有在職使用者（排除 inactive 離校教師）
  const [{ data: teachers }, { data: scoremapRows }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, name, email')
      .neq('status', 'inactive')
      .order('name'),
    supabaseAdmin
      .from('scoremap')
      .select('work')
      .order('sort_order', { ascending: true }),
  ])

  const WORK_LIST = (scoremapRows ?? []).map(r => r.work)

  const wb = XLSX.utils.book_new()

  // Sheet 1: 工作紀錄（每位教師預填一列，填入 year、work、semester 即可）
  const templateData = (teachers ?? []).map(t => ({
    teacher_id: t.id,
    name: t.name ?? '',
    year: '',
    work: '',
    semester: '全學年',
  }))
  // 若無教師，補一列說明
  if (templateData.length === 0) {
    templateData.push({ teacher_id: '（無教師資料）', name: '', year: '', work: '', semester: '全學年' })
  }
  const ws1 = XLSX.utils.json_to_sheet(templateData)
  ws1['!cols'] = [{ wch: 38 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 12 }]

  // 加入下拉驗證
  const dataRows = Math.max(templateData.length, 1)
  ws1['!validations'] = [
    {
      sqref: `D2:D${dataRows + 100}`,
      type: 'list',
      formula1: `'職務清單'!$A$1:$A$${WORK_LIST.length}`,
      showErrorMessage: true,
      errorTitle: '輸入錯誤',
      error: '請從下拉選單選取職務名稱',
    },
    {
      sqref: `E2:E${dataRows + 100}`,
      type: 'list',
      formula1: '"上學期,下學期,全學年"',
      showErrorMessage: true,
      errorTitle: '輸入錯誤',
      error: '請選擇：上學期、下學期 或 全學年',
    },
  ]

  XLSX.utils.book_append_sheet(wb, ws1, '工作紀錄')

  // Sheet 2: 職務清單（隱藏，供下拉選單引用）
  const wsWorks = XLSX.utils.aoa_to_sheet(WORK_LIST.map(w => [w]))
  wsWorks['!cols'] = [{ wch: 22 }]
  XLSX.utils.book_append_sheet(wb, wsWorks, '職務清單')

  // 隱藏職務清單工作表
  wb.Workbook = {
    Sheets: [
      { Hidden: 0 },           // 工作紀錄：顯示
      { Hidden: 1 },           // 職務清單：隱藏
    ],
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="rotations_template.xlsx"',
    },
  })
}
