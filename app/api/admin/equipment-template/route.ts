import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import { EQUIPMENT_STATUS_LABEL, type ChecklistItem } from '@/lib/equipment'
import * as XLSX from 'xlsx'

/** 檢查清單 → 「項目、項目*」文字（*＝需拍照），與匯入解析互為反向 */
function checklistText(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  return (raw as ChecklistItem[])
    .map(item => (item.requiresPhoto ? `${item.label}*` : item.label))
    .join('、')
}

/** 下載設備庫 Excel：匯出全部現有設備，管理者編修/新增後再匯入 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: equipment } = await supabaseAdmin
    .from('equipment').select('*').order('sort_order').order('created_at')

  const rows = (equipment ?? []).map(e => ({
    id: e.id,
    名稱: e.name,
    位置: e.location,
    編號: e.asset_number,
    狀態: EQUIPMENT_STATUS_LABEL[e.status] ?? e.status,
    週邊配件: (Array.isArray(e.peripherals) ? (e.peripherals as string[]) : []).join('、'),
    借用檢查項目: checklistText(e.borrow_checklist),
    歸還檢查項目: checklistText(e.return_checklist),
    備註: e.notes,
  }))

  // 資料庫還沒有設備時附一列範例（匯入時自動略過）
  if (rows.length === 0) {
    rows.push({
      id: '',
      名稱: '（範例）攝影機-1',
      位置: '資訊組防潮櫃',
      編號: '3001189',
      狀態: '可借用',
      週邊配件: '充電線、USB延長線、變壓器',
      借用檢查項目: '設備外觀無損壞、設備財產標籤*',
      歸還檢查項目: '設備已歸回原位*、配件齊全',
      備註: 'SONY-CX-450',
    })
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 38 }, { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 10 },
    { wch: 30 }, { wch: 36 }, { wch: 36 }, { wch: 20 },
  ]
  // 狀態欄下拉驗證（E 欄）
  ;(ws as Record<string, unknown>)['!validations'] = [
    {
      sqref: `E2:E${rows.length + 200}`,
      type: 'list',
      formula1: '"可借用,維修中,停用"',
      showErrorMessage: true,
      errorTitle: '輸入錯誤',
      error: '請選擇：可借用、維修中 或 停用',
    },
  ]
  XLSX.utils.book_append_sheet(wb, ws, '設備清單')

  const help = XLSX.utils.aoa_to_sheet([
    ['設備庫 Excel 編修說明'],
    [''],
    ['本檔案為目前設備庫的完整資料，編修或新增後回到系統「批次匯入」即可套用。'],
    [''],
    ['id', '系統識別碼，請勿修改。有 id 的列＝更新該設備；id 留空的列＝新增設備。'],
    ['名稱', '必填。同名視為不同台，建議自行編號（例：攝影機-1、攝影機-2）。'],
    ['位置', '選填。設備存放位置。'],
    ['編號', '財產或自訂編號。名稱可以相同，但編號每台不可重複（留空不受限）。'],
    ['狀態', '可借用／維修中／停用，留空視為「可借用」。'],
    ['週邊配件', '多項以「、」或「,」分隔。'],
    ['借用檢查項目', '多項以「、」或「,」分隔；項目結尾加「*」代表該項需拍照。'],
    ['歸還檢查項目', '同上。'],
    ['備註', '選填。'],
    [''],
    ['注意：刪除檔案中的列「不會」刪除系統中的設備，刪除請在系統設備庫操作。'],
    ['名稱以「（範例）」開頭的列匯入時會自動略過。'],
  ])
  help['!cols'] = [{ wch: 14 }, { wch: 84 }]
  XLSX.utils.book_append_sheet(wb, help, '填寫說明')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="equipment_library.xlsx"',
    },
  })
}
