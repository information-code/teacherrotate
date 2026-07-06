import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkAdmin } from '@/lib/equipment-server'
import * as XLSX from 'xlsx'

/** 下載設備批次匯入範本（Excel） */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const wb = XLSX.utils.book_new()

  // Sheet 1: 設備清單（含一列範例，匯入時會略過名稱為「（範例）」開頭的列）
  const example = {
    名稱: '（範例）攝影機-1',
    位置: '資訊組防潮櫃',
    編號: '3001189',
    狀態: '可借用',
    週邊配件: '充電線、USB延長線、變壓器',
    借用檢查項目: '設備外觀無損壞、設備財產標籤*',
    歸還檢查項目: '設備已歸回原位*、配件齊全',
    備註: 'SONY-CX-450',
  }
  const ws = XLSX.utils.json_to_sheet([example])
  ws['!cols'] = [
    { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 10 },
    { wch: 30 }, { wch: 36 }, { wch: 36 }, { wch: 20 },
  ]
  // 狀態欄下拉驗證
  ;(ws as Record<string, unknown>)['!validations'] = [
    {
      sqref: 'D2:D500',
      type: 'list',
      formula1: '"可借用,維修中,停用"',
      showErrorMessage: true,
      errorTitle: '輸入錯誤',
      error: '請選擇：可借用、維修中 或 停用',
    },
  ]
  XLSX.utils.book_append_sheet(wb, ws, '設備清單')

  // Sheet 2: 填寫說明
  const help = XLSX.utils.aoa_to_sheet([
    ['設備批次匯入範本 — 填寫說明'],
    [''],
    ['名稱', '必填。每列一台設備，同名設備視為不同台，建議自行編號（例：攝影機-1、攝影機-2）。'],
    ['位置', '選填。設備存放位置。'],
    ['編號', '選填。財產或自訂編號。'],
    ['狀態', '選填。可借用／維修中／停用，留空視為「可借用」。'],
    ['週邊配件', '選填。多項以「、」或「,」分隔。'],
    ['借用檢查項目', '選填。多項以「、」或「,」分隔；項目結尾加「*」代表該項需拍照。'],
    ['歸還檢查項目', '同上。'],
    ['備註', '選填。'],
    [''],
    ['範例列（名稱以「（範例）」開頭）匯入時會自動略過，可直接覆蓋修改。'],
  ])
  help['!cols'] = [{ wch: 14 }, { wch: 80 }]
  XLSX.utils.book_append_sheet(wb, help, '填寫說明')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="equipment_template.xlsx"',
    },
  })
}
