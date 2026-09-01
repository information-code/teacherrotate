/**
 * 教師帳號批次匯出／匯入的欄位定義。
 * 匯出（TeachersClient）與匯入（/api/admin/teacher-import）共用同一份，避免標題列對不上。
 *
 * 規則：
 *  - email 是比對鍵，永遠不可改（要改 email 請走白名單頁）。
 *  - 「標題列沒有這一欄」＝ 整欄不動；「有這一欄但格子空白」＝ 清空／false／0。
 *    所以只想改幾欄時，可以只留 email + 那幾欄上傳。
 */

export const EMAIL_HEADER = 'email'
/** 匯出時附上的參考欄，匯入時一律忽略 */
export const READONLY_HEADERS = ['關埔正式年資（唯讀）']

export type TeacherFieldType = 'str' | 'bool' | 'num' | 'employment' | 'status'

export interface TeacherColumn {
  header: string
  field: string
  type: TeacherFieldType
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  formal: '正式',
  substitute: '代理',
  hourly: '鐘點',
  foreign: '外師',
  special_ed: '特教',
}
const EMPLOYMENT_BY_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => [v, k])
)

export const STATUS_LABELS: Record<string, string> = {
  active: '在校',
  inactive: '離校',
}

export const TEACHER_COLUMNS: TeacherColumn[] = [
  { header: '姓名',              field: 'name',                   type: 'str' },
  { header: '聘任別',            field: 'employment_type',        type: 'employment' },
  { header: '在校狀態',          field: 'status',                 type: 'status' },
  { header: '電話',              field: 'phone',                  type: 'str' },
  { header: 'Line ID',           field: 'line_id',                type: 'str' },
  { header: '關埔代理年資',      field: 'kanpu_substitute_years', type: 'num' },
  { header: '他校年資',          field: 'other_school_years',     type: 'num' },
  { header: '大學',              field: 'university',             type: 'str' },
  { header: '研究所',            field: 'graduate_school',        type: 'str' },
  { header: '學分班',            field: 'credit_class',           type: 'str' },
  { header: '其他學歷',          field: 'other_education',        type: 'str' },
  { header: '閩南語',            field: 'local_language',         type: 'bool' },
  { header: '閩南語級別',        field: 'local_language_grade',   type: 'str' },
  { header: '客語四線',          field: 'four_language',          type: 'bool' },
  { header: '客語四線級別',      field: 'four_language_grade',    type: 'str' },
  { header: '客語海線',          field: 'sea_language',           type: 'bool' },
  { header: '客語海線級別',      field: 'sea_language_grade',     type: 'str' },
  { header: '手語',              field: 'sign_language',          type: 'bool' },
  { header: '手語級別',          field: 'sign_language_grade',    type: 'str' },
  { header: '本土語教支資格',    field: 'local_language_qualifications', type: 'bool' },
  { header: '英語專長',          field: 'english_specialty',      type: 'bool' },
  { header: '英語20學分班',      field: 'english_specialty_20',   type: 'bool' },
  { header: 'CEF B2',            field: 'english_specialty_cef',  type: 'bool' },
  { header: '雙語增能學分班',    field: 'english_specialty_grade', type: 'str' },
  { header: '專輔資格',          field: 'guidance_specialty_qua', type: 'bool' },
  { header: '輔導相關系所',      field: 'guidance_specialty_graduate', type: 'bool' },
  { header: '輔導專長',          field: 'guidance_specialty',     type: 'bool' },
  { header: '雙語專長',          field: 'bilingual_specialty',    type: 'bool' },
  { header: '自然專長',          field: 'nature_specialty',       type: 'bool' },
  { header: '資訊專長',          field: 'tech_specialty',         type: 'bool' },
  { header: '生活研習',          field: 'life_specialty',         type: 'bool' },
  { header: '其他語言',          field: 'other_language_text',    type: 'str' },
  { header: '其他專長',          field: 'other_checkbox',         type: 'str' },
]

export const COLUMN_BY_HEADER: Record<string, TeacherColumn> =
  Object.fromEntries(TEACHER_COLUMNS.map(c => [c.header, c]))

const TRUTHY = ['TRUE', '1', '是', 'O', '✓', 'V', 'Y', 'YES', 'OO']

/** 把 Excel 的格子轉成 DB 值；回傳 { ok, value } 或 { ok:false, message } */
export function parseCell(
  col: TeacherColumn,
  raw: unknown
): { ok: true; value: string | boolean | number | null } | { ok: false; message: string } {
  const s = String(raw ?? '').trim()
  switch (col.type) {
    case 'str':
      return { ok: true, value: s || null }
    case 'bool':
      if (!s) return { ok: true, value: false }
      return { ok: true, value: TRUTHY.includes(s.toUpperCase()) }
    case 'num': {
      if (!s) return { ok: true, value: 0 }
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0 || n > 60) {
        return { ok: false, message: `「${col.header}」應為 0~60 的數字（收到「${s}」）` }
      }
      return { ok: true, value: Math.round(n * 100) / 100 }
    }
    case 'employment': {
      if (!s) return { ok: true, value: 'formal' }
      const v = EMPLOYMENT_BY_LABEL[s] ?? (s in EMPLOYMENT_LABELS ? s : null)
      if (!v) {
        return { ok: false, message: `「聘任別」只能填 ${Object.values(EMPLOYMENT_LABELS).join('／')}（收到「${s}」）` }
      }
      return { ok: true, value: v }
    }
    case 'status': {
      if (!s) return { ok: true, value: 'active' }
      if (s === '在校' || s === 'active') return { ok: true, value: 'active' }
      if (s === '離校' || s === 'inactive') return { ok: true, value: 'inactive' }
      return { ok: false, message: `「在校狀態」只能填 在校／離校（收到「${s}」）` }
    }
  }
}

/** 把 DB 值轉成 Excel 的格子 */
export function formatCell(col: TeacherColumn, value: unknown): string | number {
  switch (col.type) {
    case 'bool':
      return value === true ? 'V' : ''
    case 'num':
      return Number(value ?? 0)
    case 'employment':
      return EMPLOYMENT_LABELS[String(value ?? '')] ?? String(value ?? '')
    case 'status':
      return STATUS_LABELS[String(value ?? '')] ?? String(value ?? '')
    default:
      return String(value ?? '')
  }
}

/** 顯示用：把 DB 值印成人看得懂的字（預覽差異表用） */
export function displayValue(col: TeacherColumn, value: unknown): string {
  const v = formatCell(col, value)
  return v === '' ? '（空）' : String(v)
}
