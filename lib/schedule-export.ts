// 課表匯出（瀏覽器端）：整份＝班級課表＋科任教師課表＋科任教室課表，一頁一張，版面仿人工課表
// （標題「N 學年度 X年X班 功課表」、右上導師、節次＋時間欄、午休列、格內 科目／教師／教室／外師）。
// PDF：jsPDF＋autotable，中文字型用 Noto Sans TC（按下時才從 CDN 抓、jsPDF 只嵌用到的字）；
// Word：HTML 存成 .doc（Word 直接開）；CSV：一列一格（Excel 用 BOM）。
import { SCHEDULE_DAYS, classLabel, subjectClassKey, HOMEROOM_SELF, bandOf, type ScheduleConfig, type DerivedNativeSession } from './scheduling'
import { GRADES, GRADE_LABEL } from './allocation'
import type { PlacedResult, EngineInput } from './schedule-engine'

/** 本校作息（人工課表同）：節次 → [起, 迄]；4、5 節之間午休 */
export const PERIOD_TIMES: Record<number, [string, string]> = {
  1: ['8:40', '9:20'], 2: ['9:30', '10:10'], 3: ['10:30', '11:10'], 4: ['11:20', '12:00'],
  5: ['13:30', '14:10'], 6: ['14:20', '15:00'], 7: ['15:15', '15:55'],
}
const DAY_ZH = ['', '一', '二', '三', '四', '五']
/** 校名（標題用：「新竹市關埔國小 115學年度 四年2班 班級課表」） */
export const SCHOOL_NAME = '新竹市關埔國小'

export interface ExportCell { lines: string[]; subject?: string; teacher?: string; cls?: string; room?: string; note?: string }
export interface ExportSheet {
  section: '班級' | '教師' | '教室'
  title: string          // 「115 學年度 一年1 班 功課表」
  subtitle?: string      // 「導師: 黃政昱」
  name: string           // CSV 用：一年1班／黃政昱／自然教室一
  periods: number        // 每日節數（低年級 6、中高 7）
  cells: Record<string, ExportCell>   // slotKey → 格
}

export interface BuildArgs {
  year: number
  placed: PlacedResult[]
  config: ScheduleConfig
  input: Pick<EngineInput, 'rooms' | 'homeroomLocks'>   // 匯出只用到這兩項；教師端自行組即可
  teacherNames: Record<string, string>
  classCounts: Record<number, number>
  hrCells: Record<string, Record<string, string>>     // classKey → slot → 導師填的科目
  nativeSessions: DerivedNativeSession[]
  nativeRoomNames: Record<string, string>
}

const gradeZh = (g: number) => GRADE_LABEL[g] ?? `${g}年級`
const classZh = (g: number, i: number) => `${'一二三四五六'[g - 1] ?? g}年${i + 1}班`   // 標題仿人工課表「四年2班」

export function buildExportSheets(a: BuildArgs): ExportSheet[] {
  const { year, placed, config, input, teacherNames, classCounts, hrCells, nativeSessions, nativeRoomNames } = a
  const nameOf = (id: string) => teacherNames[id] ?? ''
  const roomLabelOf = new Map(input.rooms.map(r => [r.id, r.label]))
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const sheets: ExportSheet[] = []

  // ── 班級 ──
  const byClass = new Map<string, PlacedResult[]>()
  for (const p of placed) byClass.set(p.classKey, [...(byClass.get(p.classKey) ?? []), p])
  for (const g of GRADES) {
    for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const ck = `${g}-${i}`
      const periods = config.bands[bandOf(g)].periodsPerDay
      const homeroom = nameOf(config.classTeacher[ck] ?? '')
      const cells: Record<string, ExportCell> = {}
      const hr = hrCells[ck] ?? {}
      const hlocks = new Set(input.homeroomLocks[ck] ?? [])
      // 鎖課
      for (const [slot, tid] of Object.entries(config.lockCells[ck] ?? {})) {
        const t = lockTypeMap[tid]
        const subj = t ? (t.subject || t.label || '鎖課') : '鎖課'
        let teacher = ''
        if (hlocks.has(slot)) teacher = homeroom
        else if (t?.isNative) {
          const nt = config.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
          teacher = nt === HOMEROOM_SELF ? homeroom : nameOf(nt)
        }
        cells[slot] = { lines: [subj, teacher].filter(Boolean), subject: subj, teacher }
      }
      // 導師填的課
      for (const [slot, subj] of Object.entries(hr)) {
        if (cells[slot]) continue
        cells[slot] = { lines: [subj, homeroom].filter(Boolean), subject: subj, teacher: homeroom }
      }
      // 科任課
      for (const p of byClass.get(ck) ?? []) {
        const room = p.roomId ? (roomLabelOf.get(p.roomId) ?? '') : ''
        const co = p.coTeacherId ? `外師 ${p.coTeacherName ?? ''}`.trim() : ''
        if (p.parity !== 'weekly') {
          // 單雙週區塊：這一週科任、另一週導師（配對格）——兩格都寫清楚
          const disp = `${p.day}-${p.parity === 'odd' ? p.period : p.period + 1}`
          const other = `${p.day}-${p.parity === 'odd' ? p.period + 1 : p.period}`
          const wk = p.parity === 'odd' ? '單週' : '雙週'
          const owk = p.parity === 'odd' ? '雙週' : '單週'
          const hrSubj = hr[other]
          const mine: string[] = [`${p.subject}（${wk}）`, p.teacherName, room, co].filter(Boolean)
          const theirs: string[] = hrSubj ? [`${hrSubj}（${owk}）`, homeroom] : []
          for (const s of [disp, other]) cells[s] = { lines: [...mine, ...theirs], subject: `${p.subject}（${wk}）${hrSubj ? `／${hrSubj}（${owk}）` : ''}`, teacher: p.teacherName, room, note: co }
          continue
        }
        const slots = p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
        for (const s of slots) cells[s] = { lines: [p.subject, p.teacherName, room, co].filter(Boolean), subject: p.subject, teacher: p.teacherName, room, note: co }
      }
      sheets.push({ section: '班級', title: `${SCHOOL_NAME} ${year}學年度 ${classZh(g, i)} 班級課表`, subtitle: homeroom ? `導師: ${homeroom}` : undefined, name: classLabel(g, i), periods, cells })
    }
  }

  // ── 科任教師（含外師、本土語老師）──
  const tcells = new Map<string, Record<string, ExportCell>>()
  const put = (tid: string, slot: string, c: ExportCell) => { const m = tcells.get(tid) ?? {}; m[slot] = c; tcells.set(tid, m) }
  for (const p of placed) {
    const room = p.roomId ? (roomLabelOf.get(p.roomId) ?? '') : ''
    const wk = p.parity === 'weekly' ? '' : p.parity === 'odd' ? '（單週）' : '（雙週）'
    const slots = p.parity !== 'weekly'
      ? [`${p.day}-${p.parity === 'odd' ? p.period : p.period + 1}`]
      : p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
    for (const s of slots) {
      put(p.teacherId, s, { lines: [p.classLabel, `${p.subject}${wk}`, room, p.coTeacherId ? `外師 ${p.coTeacherName ?? ''}` : ''].filter(Boolean), cls: p.classLabel, subject: `${p.subject}${wk}`, room, note: p.coTeacherId ? `外師 ${p.coTeacherName ?? ''}` : '' })
      if (p.coTeacherId) put(p.coTeacherId, s, { lines: [p.classLabel, `${p.subject}${wk}`, room, `協同 ${p.teacherName}`].filter(Boolean), cls: p.classLabel, subject: `${p.subject}${wk}`, room, note: `協同 ${p.teacherName}` })
    }
  }
  // 本土語：閩南語原班（配班老師 × 該班本土語鎖課格）、語別場次（實體／線上）
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
  for (const [ck, cells] of Object.entries(config.lockCells)) {
    const [g, i] = ck.split('-').map(Number)
    const tid = config.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
    if (!tid || tid === HOMEROOM_SELF) continue
    for (const [slot, ltid] of Object.entries(cells)) {
      if (!nativeTypeIds.has(ltid)) continue
      put(tid, slot, { lines: [classLabel(g, i), '本土語', '原班（閩南語）'], cls: classLabel(g, i), subject: '本土語', note: '原班（閩南語）' })
    }
  }
  for (const sn of nativeSessions) {
    if (sn.state === 'cancelled' || !sn.teacherId) continue
    const room = sn.roomId ? (nativeRoomNames[sn.roomId] ?? '') : ''
    put(sn.teacherId, sn.slot, { lines: [gradeZh(sn.grade), `本土語（${sn.lang}）${sn.state === 'stream' ? '・線上' : ''}`, room].filter(Boolean), cls: gradeZh(sn.grade), subject: `本土語（${sn.lang}）`, room, note: sn.state === 'stream' ? '線上' : '' })
  }
  const tids = Array.from(tcells.keys()).sort((x, y) => nameOf(x).localeCompare(nameOf(y), 'zh-Hant'))
  for (const tid of tids) {
    const name = nameOf(tid) || placed.find(p => p.coTeacherId === tid)?.coTeacherName || '？'
    sheets.push({ section: '教師', title: `${SCHOOL_NAME} ${year}學年度 ${name} 教師課表`, name, periods: 7, cells: tcells.get(tid)! })
  }

  // ── 科任教室（＋有場次的本土語言教室）──
  const rcells = new Map<string, Record<string, ExportCell>>()
  const putR = (rid: string, slot: string, c: ExportCell) => { const m = rcells.get(rid) ?? {}; m[slot] = c; rcells.set(rid, m) }
  for (const p of placed) {
    if (!p.roomId) continue
    const wk = p.parity === 'weekly' ? '' : p.parity === 'odd' ? '（單週）' : '（雙週）'
    const slots = p.parity !== 'weekly'
      ? [`${p.day}-${p.parity === 'odd' ? p.period : p.period + 1}`]
      : p.size === 2 ? [`${p.day}-${p.period}`, `${p.day}-${p.period + 1}`] : [`${p.day}-${p.period}`]
    for (const s of slots) putR(p.roomId, s, { lines: [p.classLabel, p.teacherName, `${p.subject}${wk}`].filter(Boolean), cls: p.classLabel, teacher: p.teacherName, subject: `${p.subject}${wk}` })
  }
  for (const sn of nativeSessions) {
    if (sn.state !== 'physical' || !sn.roomId) continue
    putR(sn.roomId, sn.slot, { lines: [gradeZh(sn.grade), nameOf(sn.teacherId), `本土語（${sn.lang}）`].filter(Boolean), cls: gradeZh(sn.grade), teacher: nameOf(sn.teacherId), subject: `本土語（${sn.lang}）` })
  }
  const roomOrder = [...input.rooms.map(r => ({ id: r.id, label: r.label })), ...Object.entries(nativeRoomNames).map(([id, label]) => ({ id, label }))]
  const seen = new Set<string>()
  for (const r of roomOrder) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const cells = rcells.get(r.id)
    if (!cells || !Object.keys(cells).length) continue
    sheets.push({ section: '教室', title: `${SCHOOL_NAME} ${year}學年度 ${r.label} 教室課表`, name: r.label, periods: 7, cells })
  }
  return sheets
}

// ───────────── 校務系統匯入格式（Excel）─────────────
// 一列一堂課：週次／節次／年級／班級／教師姓名／校訂課程名稱／上課頻率
//   連堂＝兩列（第 N 節、第 N+1 節）；單雙週區塊＝該區塊兩節各一列，科任那一週寫「單週上課」或「雙週上課」，
//   輪到導師的那一週另寫兩列（導師填的科目）。鎖課（種子班國數、本土語、游泳）也會列出，導師自上的填導師姓名。
const PERIOD_ZH = ['', '第一節', '第二節', '第三節', '第四節', '第五節', '第六節', '第七節']
export const IMPORT_HEADER = ['週次', '節次', '年級', '班級', '教師姓名', '校訂課程名稱', '上課頻率']
/** 校務系統課程資料匯入（CSV）欄位。科目／教師／教室三個「代碼」欄本系統沒有，留空給課務組貼上或由校務系統以名稱比對。 */
export const SCHOOL_CSV_HEADER = ['class_no', '班級', '科目', '科目名稱', '星期', '節次', '教師', '教師名稱', '教室', '教室名稱']
const FREQ_WEEKLY = '每週上課', FREQ_ODD = '單週上課', FREQ_EVEN = '雙週上課'

export function buildImportRows(a: BuildArgs): string[][] {
  const { placed, config, input, teacherNames, classCounts, hrCells } = a
  const nameOf = (id: string) => teacherNames[id] ?? ''
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  type Row = { g: number; i: number; day: number; period: number; teacher: string; subject: string; freq: string }
  const out: Row[] = []
  for (const g of GRADES) {
    for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const ck = `${g}-${i}`
      const homeroom = nameOf(config.classTeacher[ck] ?? '')
      const hlocks = new Set(input.homeroomLocks[ck] ?? [])
      const hr = hrCells[ck] ?? {}
      const used = new Set<string>()   // 已由科任課（含單雙週配對）佔用的格
      const push = (day: number, period: number, teacher: string, subject: string, freq: string) => {
        out.push({ g, i, day, period, teacher, subject, freq })
      }
      for (const p of placed) {
        if (p.classKey !== ck) continue
        if (p.parity !== 'weekly') {
          // 單雙週區塊：整塊兩節，這一週科任、另一週導師
          const wk = p.parity === 'odd' ? FREQ_ODD : FREQ_EVEN
          const owk = p.parity === 'odd' ? FREQ_EVEN : FREQ_ODD
          const disp = `${p.day}-${p.parity === 'odd' ? p.period : p.period + 1}`
          const other = `${p.day}-${p.parity === 'odd' ? p.period + 1 : p.period}`
          const hrSubj = hr[other]
          for (const q of [p.period, p.period + 1]) {
            used.add(`${p.day}-${q}`)
            push(p.day, q, p.teacherName, p.subject, wk)
            if (hrSubj) push(p.day, q, homeroom, hrSubj, owk)
          }
          used.add(disp); used.add(other)
          continue
        }
        for (const q of p.size === 2 ? [p.period, p.period + 1] : [p.period]) {
          used.add(`${p.day}-${q}`)
          push(p.day, q, p.teacherName, p.subject, FREQ_WEEKLY)
        }
      }
      // 鎖課（種子班國數、班級活動、本土語、游泳…）
      for (const [slot, tid] of Object.entries(config.lockCells[ck] ?? {})) {
        if (used.has(slot)) continue
        const t = lockTypeMap[tid]
        const subject = t ? (t.subject || t.label || '鎖課') : '鎖課'
        let teacher = ''
        if (hlocks.has(slot)) teacher = homeroom
        else if (t?.isNative) {
          const nt = config.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
          teacher = nt === HOMEROOM_SELF ? homeroom : nameOf(nt)
        }
        const [day, period] = slot.split('-').map(Number)
        used.add(slot)
        push(day, period, teacher, subject, FREQ_WEEKLY)
      }
      // 導師填的課（單雙週配對格已在上面處理）
      for (const [slot, subject] of Object.entries(hr)) {
        if (used.has(slot)) continue
        const [day, period] = slot.split('-').map(Number)
        push(day, period, homeroom, subject, FREQ_WEEKLY)
      }
    }
  }
  out.sort((x, y) => x.g - y.g || x.i - y.i || x.day - y.day || x.period - y.period || x.subject.localeCompare(y.subject, 'zh-Hant'))
  return [IMPORT_HEADER, ...out.map(r => [
    `週${DAY_ZH[r.day]}`, PERIOD_ZH[r.period] ?? `第${r.period}節`,
    GRADE_LABEL[r.g] ?? `${r.g}年級`, `第${String(r.i + 1).padStart(2, '0')}班`,
    r.teacher, r.subject, r.freq,
  ])]
}

/** 校務系統課程資料（CSV）：一列一堂課。
 *  class_no／班級＝班級代碼（年級×100＋班序，如 1年1班＝101）；星期、節次為數字；
 *  科目／教師／教室代碼本系統沒有（留空）；教室代碼取教室設定的「編號」欄。
 *  不列入：本土語其他語別的場次老師（只列原班閩南語的授課老師）、英語外師（協同者不另列一行）。
 *  單雙週（視藝）：該區塊兩節各列一行，科目名稱後加註（單週）／（雙週），輪到導師的那一週另列導師的課。 */
export function buildSchoolCsvRows(a: BuildArgs): string[][] {
  const { placed, config, input, teacherNames, classCounts, hrCells } = a
  const nameOf = (id: string) => teacherNames[id] ?? ''
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))
  const roomById = new Map(input.rooms.map(r => [r.id, r]))
  const roomNoById = new Map<string, string>()
  for (const z of config.roomZones) for (const r of z.rooms) if (r.no) roomNoById.set(r.id, r.no)
  type Row = { g: number; i: number; day: number; period: number; subject: string; teacher: string; roomNo: string; roomName: string }
  const out: Row[] = []
  for (const g of GRADES) {
    for (let i = 0; i < (classCounts[g] ?? 0); i++) {
      const ck = `${g}-${i}`
      const homeroom = nameOf(config.classTeacher[ck] ?? '')
      const hlocks = new Set(input.homeroomLocks[ck] ?? [])
      const hr = hrCells[ck] ?? {}
      const used = new Set<string>()
      const push = (day: number, period: number, subject: string, teacher: string, roomId?: string | null) => {
        const r = roomId ? roomById.get(roomId) : undefined
        out.push({ g, i, day, period, subject, teacher, roomNo: roomId ? (roomNoById.get(roomId) ?? '') : '', roomName: r?.label ?? '' })
      }
      for (const p of placed) {
        if (p.classKey !== ck) continue
        if (p.parity !== 'weekly') {
          // 單雙週：校務系統用「節次的奇偶」分辨——單週寫在奇數節、雙週寫在偶數節。
          // 區塊一律對齊 (1-2)(3-4)(5-6)，所以起始節是奇數、次節是偶數；每一週各一列，不加註（單週）／（雙週）。
          const oddQ = p.period, evenQ = p.period + 1
          const mineQ = p.parity === 'odd' ? oddQ : evenQ
          const hrQ = p.parity === 'odd' ? evenQ : oddQ
          const hrSubj = hr[`${p.day}-${p.parity === 'odd' ? evenQ : oddQ}`]
          push(p.day, mineQ, p.subject, p.teacherName, p.roomId)
          if (hrSubj) push(p.day, hrQ, hrSubj, homeroom)
          used.add(`${p.day}-${oddQ}`); used.add(`${p.day}-${evenQ}`)
          continue
        }
        for (const q of p.size === 2 ? [p.period, p.period + 1] : [p.period]) {
          used.add(`${p.day}-${q}`)
          push(p.day, q, p.subject, p.teacherName, p.roomId)
        }
      }
      for (const [slot, tid] of Object.entries(config.lockCells[ck] ?? {})) {
        if (used.has(slot)) continue
        const t = lockTypeMap[tid]
        const subject = t ? (t.subject || t.label || '鎖課') : '鎖課'
        let teacher = ''
        if (hlocks.has(slot)) teacher = homeroom
        else if (t?.isNative) {
          // 本土語：只列原班（閩南語）的授課老師；其他語別的場次老師不列入
          const nt = config.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
          teacher = nt === HOMEROOM_SELF ? homeroom : nameOf(nt)
        }
        const [day, period] = slot.split('-').map(Number)
        used.add(slot)
        push(day, period, subject, teacher)
      }
      for (const [slot, subject] of Object.entries(hr)) {
        if (used.has(slot)) continue
        const [day, period] = slot.split('-').map(Number)
        push(day, period, subject, homeroom)
      }
    }
  }
  out.sort((x, y) => x.g - y.g || x.i - y.i || x.day - y.day || x.period - y.period || x.subject.localeCompare(y.subject, 'zh-Hant'))
  return [SCHOOL_CSV_HEADER, ...out.map(r => {
    const no = String(r.g * 100 + r.i + 1)
    return [no, no, '', r.subject, String(r.day), String(r.period), '', r.teacher, r.roomNo, r.roomName]
  })]
}

/** 列陣列 → CSV（Excel 用 BOM）。 */
export function rowsToCsv(rows: string[][]): string {
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return '\ufeff' + rows.map(r => r.map(esc).join(',')).join('\r\n')
}

/** 列陣列 → .xlsx（SheetJS，按下時才載入）。 */
export async function rowsToXlsx(rows: string[][], sheetName = '課程'): Promise<Blob> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 24 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

// ───────────── CSV ─────────────
export function sheetsToCsv(sheets: ExportSheet[]): string {
  const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  const rows: string[][] = [['類別', '名稱', '星期', '節次', '時間', '科目', '教師', '班級', '教室', '備註']]
  for (const sh of sheets) {
    for (let q = 1; q <= sh.periods; q++) for (const d of SCHEDULE_DAYS) {
      const c = sh.cells[`${d}-${q}`]
      if (!c) continue
      const t = PERIOD_TIMES[q]
      rows.push([sh.section, sh.name, `星期${DAY_ZH[d]}`, String(q), t ? `${t[0]}-${t[1]}` : '', c.subject ?? '', c.teacher ?? '', c.cls ?? '', c.room ?? '', c.note ?? ''])
    }
  }
  return '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')
}

// ───────────── Word（真正的 .docx；docx 套件）─────────────
// 一張課表一頁（分頁符號）、表格 7 欄：節次／時間／星期一～五；標楷體；版面同 PDF。
export async function sheetsToDocx(sheets: ExportSheet[]): Promise<Blob> {
  const d = await import('docx')
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, VerticalAlign, BorderStyle, PageBreak } = d
  const FONT = '標楷體'
  const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' }
  const borders = { top: border, bottom: border, left: border, right: border }
  // A4 11906 twips 寬、左右邊界各 850 → 內容 10206；節次 700、時間 1000、五天各 1701
  const W = { p: 700, t: 1000, d: 1701 }
  const colWidths = [W.p, W.t, W.d, W.d, W.d, W.d, W.d]
  const run = (text: string, opts: { size?: number; bold?: boolean } = {}) => new TextRun({ text, font: FONT, size: opts.size ?? 21, bold: opts.bold })
  const para = (lines: string[], opts: { size?: number; bold?: boolean } = {}) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 276 },
      children: lines.flatMap((ln, i) => i === 0 ? [run(ln, opts)] : [new TextRun({ text: ln, font: FONT, size: opts.size ?? 21, bold: opts.bold, break: 1 })]) })
  const cell = (lines: string[], width: number, opts: { size?: number; colSpan?: number } = {}) =>
    new TableCell({ width: { size: width, type: WidthType.DXA }, columnSpan: opts.colSpan, verticalAlign: VerticalAlign.CENTER, borders,
      margins: { top: 40, bottom: 40, left: 40, right: 40 }, children: [para(lines.length ? lines : [''], { size: opts.size })] })
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = []
  sheets.forEach((sh, idx) => {
    const rowH = sh.periods >= 7 ? 1460 : 1680   // twips：7 節一頁剛好
    const rows: InstanceType<typeof TableRow>[] = []
    rows.push(new TableRow({ tableHeader: true, height: { value: 440, rule: 'exact' }, children: [cell([''], W.p), cell([''], W.t), ...SCHEDULE_DAYS.map(dd => cell([`星期${DAY_ZH[dd]}`], W.d))] }))
    for (let q = 1; q <= sh.periods; q++) {
      if (q === 5) rows.push(new TableRow({ height: { value: 440, rule: 'exact' }, children: [cell(['午　　休'], W.p + W.t + W.d * 5, { colSpan: 7 })] }))
      const t = PERIOD_TIMES[q]
      rows.push(new TableRow({ height: { value: rowH, rule: 'exact' }, children: [
        cell([String(q)], W.p),
        cell(t ? [t[0], t[1]] : [''], W.t, { size: 18 }),
        ...SCHEDULE_DAYS.map(dd => cell(sh.cells[`${dd}-${q}`]?.lines ?? [], W.d)),
      ] }))
    }
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 60 }, children: [...(idx > 0 ? [new PageBreak()] : []), run(sh.title, { size: 32, bold: true })] }))
    children.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 80 }, children: [run(sh.subtitle ?? ' ', { size: 21 })] }))
    children.push(new Table({ width: { size: W.p + W.t + W.d * 5, type: WidthType.DXA }, columnWidths: colWidths, rows }))
  })
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1020, bottom: 800, left: 850, right: 850 } } }, children }],
  })
  return Packer.toBlob(doc)
}

// ───────────── PDF（jsPDF）─────────────
const FONT_URL = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf'
let fontCache: string | null = null
async function loadFontBase64(onStatus?: (s: string) => void): Promise<string> {
  if (fontCache) return fontCache
  onStatus?.('下載中文字型（首次約 12MB）…')
  const res = await fetch(FONT_URL)
  if (!res.ok) throw new Error('字型下載失敗')
  const buf = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CH)))
  fontCache = btoa(bin)
  return fontCache
}

export async function sheetsToPdf(sheets: ExportSheet[], onStatus?: (s: string) => void): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void }).default
  const font = await loadFontBase64(onStatus)
  onStatus?.('排版中…')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.addFileToVFS('NotoSansTC.ttf', font)
  doc.addFont('NotoSansTC.ttf', 'NotoSansTC', 'normal')
  doc.addFont('NotoSansTC.ttf', 'NotoSansTC', 'bold')
  sheets.forEach((sh, idx) => {
    if (idx > 0) doc.addPage()
    doc.setFont('NotoSansTC', 'bold'); doc.setFontSize(16)
    doc.text(sh.title, 105, 18, { align: 'center' })
    doc.setFont('NotoSansTC', 'normal'); doc.setFontSize(10.5)
    if (sh.subtitle) doc.text(sh.subtitle, 196, 26, { align: 'right' })
    const body: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = []
    for (let q = 1; q <= sh.periods; q++) {
      if (q === 5) body.push([{ content: '午　休', colSpan: 7, styles: { minCellHeight: 8, fontSize: 10 } }])
      const t = PERIOD_TIMES[q]
      body.push([String(q), t ? `${t[0]}\n${t[1]}` : '', ...SCHEDULE_DAYS.map(d => (sh.cells[`${d}-${q}`]?.lines ?? []).join('\n'))])
    }
    const rowH = sh.periods >= 7 ? 26 : 30
    autoTable(doc, {
      startY: 30, margin: { left: 14, right: 14 },
      head: [['', '', '星期一', '星期二', '星期三', '星期四', '星期五']],
      body,
      theme: 'grid',
      styles: { font: 'NotoSansTC', fontStyle: 'normal', fontSize: 9.5, halign: 'center', valign: 'middle', cellPadding: 1.2, lineColor: 30, lineWidth: 0.25, textColor: 10, minCellHeight: rowH, overflow: 'linebreak' },
      headStyles: { fillColor: [255, 255, 255], textColor: 10, fontStyle: 'normal', minCellHeight: 9, lineWidth: 0.25, lineColor: 30 },
      columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 16, fontSize: 9 }, 2: { cellWidth: 31.2 }, 3: { cellWidth: 31.2 }, 4: { cellWidth: 31.2 }, 5: { cellWidth: 31.2 }, 6: { cellWidth: 31.2 } },
    })
  })
  return doc.output('blob')
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
}
