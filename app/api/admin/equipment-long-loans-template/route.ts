import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import * as XLSX from 'xlsx'

const STATUS_LABEL: Record<string, string> = { active: '使用中', ended: '已結束' }

/** 下載長期借用清單 Excel：匯出全部現有紀錄，管理者編修/新增後再匯入 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: loans }, { data: equipment }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment_long_loans').select('*').order('status').order('due_date'),
    supabaseAdmin.from('equipment').select('id, name, asset_number'),
    supabaseAdmin.from('profiles').select('id, name, email'),
  ])
  const equipMap = new Map((equipment ?? []).map(e => [e.id, e]))
  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const rows = (loans ?? []).map(l => {
    const equip = equipMap.get(l.equipment_id)
    const teacher = profileMap.get(l.teacher_id)
    return {
      id: l.id,
      設備名稱: equip?.name ?? '（已刪除設備）',
      設備編號: equip?.asset_number ?? '',
      老師姓名: teacher?.name ?? '',
      老師Email: teacher?.email ?? '',
      起始日: l.start_date,
      到期日: l.due_date,
      狀態: STATUS_LABEL[l.status] ?? l.status,
      備註: l.notes,
    }
  })

  if (rows.length === 0) {
    rows.push({
      id: '',
      設備名稱: '（範例）攝影機',
      設備編號: '3001189',
      老師姓名: '王小明',
      老師Email: 'example@school.edu.tw',
      起始日: '2026-08-01',
      到期日: '2026-12-18',
      狀態: '使用中',
      備註: '教室固定使用',
    })
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 38 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 28 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 24 },
  ]
  // 狀態欄下拉驗證（H 欄）
  ;(ws as Record<string, unknown>)['!validations'] = [
    {
      sqref: `H2:H${rows.length + 200}`,
      type: 'list',
      formula1: '"使用中,已結束"',
      showErrorMessage: true,
      errorTitle: '輸入錯誤',
      error: '請選擇：使用中 或 已結束',
    },
  ]
  XLSX.utils.book_append_sheet(wb, ws, '長期借用')

  const help = XLSX.utils.aoa_to_sheet([
    ['長期借用 Excel 編修說明'],
    [''],
    ['本檔案為目前長期借用的完整資料，編修或新增後回到系統「Excel 匯入」即可套用。'],
    [''],
    ['id', '系統識別碼，請勿修改。有 id 的列＝更新該紀錄；id 留空的列＝新增。'],
    ['設備名稱', '必填。須與系統設備庫的名稱完全一致。'],
    ['設備編號', '同名設備有多台時必填，用來指定是哪一台。'],
    ['老師姓名', '僅供閱讀參考，匯入時以 Email 為準。'],
    ['老師Email', '必填。須與系統帳號 Email 一致。'],
    ['起始日', '必填。格式 2026-08-01（或用 Excel 日期格式）。'],
    ['到期日', '必填。不可早於起始日；到期前老師需拍照回傳續借。'],
    ['狀態', '使用中／已結束，留空視為「使用中」。'],
    ['備註', '選填。'],
    [''],
    ['注意：同一台設備同時只能有一筆「使用中」的長期借用。'],
    ['刪除檔案中的列「不會」刪除系統紀錄；結束借用請將狀態改為「已結束」。'],
    ['設備名稱以「（範例）」開頭的列匯入時會自動略過。'],
  ])
  help['!cols'] = [{ wch: 14 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(wb, help, '填寫說明')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="equipment_long_loans.xlsx"',
    },
  })
}
