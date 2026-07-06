import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkAdmin } from '@/lib/equipment-server'
import * as XLSX from 'xlsx'

/**
 * 下載長期借用指派表 Excel：
 * 每台設備一列（停用除外），已有使用中借用的預填老師與起訖日。
 * 管理者只需填「老師姓名（下拉）、起始日、到期日」，留空＝不指派。
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await checkAdmin(user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [{ data: equipment }, { data: loans }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('equipment').select('id, name, asset_number, status')
      .neq('status', 'retired').order('name').order('asset_number'),
    supabaseAdmin.from('equipment_long_loans').select('*').eq('status', 'active'),
    supabaseAdmin.from('profiles').select('id, name, email').neq('status', 'inactive').order('name'),
  ])

  const activeByEquipment = new Map((loans ?? []).map(l => [l.equipment_id, l]))

  // 同名老師以「姓名（email）」區分；姓名唯一者直接用姓名
  const nameCount = new Map<string, number>()
  for (const p of profiles ?? []) {
    const n = (p.name ?? '').trim()
    if (n) nameCount.set(n, (nameCount.get(n) ?? 0) + 1)
  }
  const displayName = (p: { name: string | null; email: string }) => {
    const n = (p.name ?? '').trim()
    return (nameCount.get(n) ?? 0) > 1 ? `${n}（${p.email}）` : n
  }
  const teacherDisplay = new Map((profiles ?? []).map(p => [p.id, displayName(p)]))

  const rows = (equipment ?? []).map(e => {
    const loan = activeByEquipment.get(e.id)
    // 系統外人員標示「（系統外）」，匯回時同格式即可
    const borrower = !loan ? ''
      : loan.teacher_id ? (teacherDisplay.get(loan.teacher_id) ?? '')
      : `${loan.external_name}（系統外）`
    return {
      設備名稱: e.name,
      設備編號: e.asset_number,
      老師姓名: borrower,
      起始日: loan?.start_date ?? '',
      到期日: loan?.due_date ?? '',
      備註: loan?.notes ?? '',
    }
  })

  if (rows.length === 0) {
    rows.push({
      設備名稱: '（尚無設備，請先到設備設定建立）',
      設備編號: '', 老師姓名: '', 起始日: '', 到期日: '', 備註: '',
    })
  }

  const NAME_LIST = Array.from(new Set(
    (profiles ?? []).map(p => displayName(p)).filter(Boolean)
  ))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 24 },
  ]
  // 老師姓名下拉（C 欄），引用隱藏的老師清單
  if (NAME_LIST.length > 0) {
    ;(ws as Record<string, unknown>)['!validations'] = [
      {
        sqref: `C2:C${rows.length + 100}`,
        type: 'list',
        formula1: `'老師清單'!$A$1:$A$${NAME_LIST.length}`,
        showErrorMessage: true,
        errorTitle: '輸入錯誤',
        error: '請從下拉選單選取老師姓名',
      },
    ]
  }
  XLSX.utils.book_append_sheet(wb, ws, '長期借用')

  const help = XLSX.utils.aoa_to_sheet([
    ['長期借用指派表 — 填寫說明'],
    [''],
    ['每台設備一列。要指派長期借用：選老師姓名＋填起始日、到期日即可；', ''],
    ['老師姓名留空的列匯入時會自動略過（不會影響該設備現有借用）。', ''],
    [''],
    ['設備名稱/編號', '請勿修改，匯入時用來比對設備。'],
    ['老師姓名', '從下拉選單選取（同名老師會顯示成「姓名（email）」）。Email 由系統自動比對，不需填寫。'],
    ['系統外人員', '借給沒有系統帳號的同仁：直接填「姓名（系統外）」，例如「王大明（系統外）」，系統會標記為系統外人員。'],
    ['起始日', '格式 2026-08-01（或用 Excel 日期格式）。'],
    ['到期日', '不可早於起始日；到期前老師需拍照回傳續借。'],
    ['備註', '選填。'],
    [''],
    ['已借出的設備列會預填現況：改老師＝換人借用（原借用自動結束）、改日期＝調整期限。'],
    ['結束借用請在系統「借用管理→長期借用」操作，把老師欄清空不會結束借用。'],
  ])
  help['!cols'] = [{ wch: 16 }, { wch: 76 }]
  XLSX.utils.book_append_sheet(wb, help, '填寫說明')

  // 老師清單（隱藏，供下拉引用）
  const wsNames = XLSX.utils.aoa_to_sheet(
    (NAME_LIST.length > 0 ? NAME_LIST : ['（無老師資料）']).map(n => [n])
  )
  wsNames['!cols'] = [{ wch: 16 }]
  XLSX.utils.book_append_sheet(wb, wsNames, '老師清單')
  wb.Workbook = {
    Sheets: [
      { Hidden: 0 }, // 長期借用：顯示
      { Hidden: 0 }, // 填寫說明：顯示
      { Hidden: 1 }, // 老師清單：隱藏
    ],
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="equipment_long_loans.xlsx"',
    },
  })
}
