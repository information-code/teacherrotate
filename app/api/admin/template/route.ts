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
  const { data: teachers } = await supabaseAdmin
    .from('profiles')
    .select('id, name, email')
    .neq('status', 'inactive')
    .order('name')

  const WORK_LIST = [
    '高年級導師', '中年級導師', '低年級導師',
    '高年級接棒班', '中年級接棒班', '低年級接棒班',
    '教務主任', '學務主任', '總務主任', '輔導主任',
    '註冊組長', '課務組長', '課發組長', '資訊組長', '生教組長', '健體組長',
    '活動組長', '環衛組長', '文書組長', '輔導組長', '親職組長', '特教組長',
    '生活課程科任', '英語領域科任', '社會領域科任', '自然領域科任',
    '體育領域科任', '藝術領域科任', '科技創新任務科任', '其他領域科任',
    '留職停薪', '育嬰留停', '借調',
  ]

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

  // 加入 work 欄位的下拉驗證（引用隱藏的職務清單工作表）
  const dataRows = Math.max(templateData.length, 1)
  ws1['!validations'] = [{
    sqref: `D2:D${dataRows + 100}`,
    type: 'list',
    formula1: `'職務清單'!$A$1:$A$${WORK_LIST.length}`,
    showErrorMessage: true,
    errorTitle: '輸入錯誤',
    error: '請從下拉選單選取職務名稱',
  }]

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
