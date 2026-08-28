// 超鐘簽到 PDF（瀏覽器端）：版面仿人工文件。
//  - 個人簽到表（直式 A4，一師一頁）：標題框（校名＋民國年＋計畫名／減·授課鐘點 X月份 簽到表）、
//    教師列、序號/日期/星期/節次/班級/領域/簽名欄/備註，至少 15 列。
//  - 清冊（橫式 A4）：減代課員額鐘點費X月清冊，應領鐘點費（節數/節薪/鐘點費）＋
//    代扣款（勞保/健保/午餐/其他/合計）＋實領薪資＋合計列。
// 中文字型沿用課表匯出的 Noto Sans TC CDN 載入。
import { loadFontBase64, saveBlob } from './schedule-export'
import { OT_DAY_ZH, OT_PERIOD_ZH, rocYear, money, type OtPlan, type OtTeacher, type OtSessionRow } from './overtime'

export { saveBlob }

const SIGNIN_SCHOOL = '新竹市東區關埔國小'
const ROSTER_SCHOOL = '新竹市東區關埔國民小學'

type AutoTableFn = (doc: unknown, opts: unknown) => void

async function newDoc(orientation: 'portrait' | 'landscape', onStatus?: (s: string) => void) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = (autoTableMod as unknown as { default: AutoTableFn }).default
  const font = await loadFontBase64(onStatus)
  onStatus?.('排版中…')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation })
  doc.addFileToVFS('NotoSansTC.ttf', font)
  doc.addFont('NotoSansTC.ttf', 'NotoSansTC', 'normal')
  doc.addFont('NotoSansTC.ttf', 'NotoSansTC', 'bold')
  return { doc, autoTable }
}

export interface SigninSheet {
  teacher: OtTeacher
  sessions: OtSessionRow[]
}

/** 個人簽到表：一位教師一頁（該月無節次者也出一頁空白列，方便手寫補登） */
export async function exportSigninPdf(
  plan: OtPlan, month: string, sheets: SigninSheet[], onStatus?: (s: string) => void,
): Promise<Blob> {
  const { doc, autoTable } = await newDoc('portrait', onStatus)
  const monthNum = Number(month.slice(5, 7))
  const roc = rocYear(`${month}-01`)

  sheets.forEach((sh, idx) => {
    if (idx > 0) doc.addPage('a4', 'portrait')
    // 標題框
    doc.setFont('NotoSansTC', 'bold'); doc.setFontSize(14)
    const titleLines = doc.splitTextToSize(`${SIGNIN_SCHOOL} ${roc}年 ${plan.name}`, 168) as string[]
    const boxTop = 14
    const boxH = titleLines.length * 7 + 12
    doc.rect(14, boxTop, 182, boxH)
    titleLines.forEach((line, i) => doc.text(line, 105, boxTop + 8 + i * 7, { align: 'center' }))
    doc.setFontSize(12)
    doc.text(`減/授課鐘點 ${monthNum}月份 簽到表`, 105, boxTop + 8 + titleLines.length * 7, { align: 'center' })

    const body: string[][] = sh.sessions.map((s, i) => [
      String(i + 1),
      s.date.replace(/-/g, '/'),
      OT_DAY_ZH[s.weekday] ?? '',
      OT_PERIOD_ZH[s.period] ?? `第${s.period}節`,
      s.class_name,
      s.domain,
      '', '',
    ])
    while (body.length < 15) body.push([String(body.length + 1), '', '', '', '', '', '', ''])

    autoTable(doc, {
      startY: boxTop + boxH + 4,
      margin: { left: 14, right: 14 },
      head: [
        [{ content: `教師：${sh.teacher.name}`, colSpan: 8, styles: { halign: 'left', fontStyle: 'bold' } }],
        ['序號', '日期', '星期', '節次', '班級', '領域', '簽名欄', '備註'],
      ],
      body,
      theme: 'grid',
      styles: {
        font: 'NotoSansTC', fontStyle: 'normal', fontSize: 10, halign: 'center', valign: 'middle',
        cellPadding: 1.5, lineColor: 30, lineWidth: 0.25, textColor: 10, minCellHeight: 10,
      },
      headStyles: { fillColor: [255, 255, 255], textColor: 10, fontStyle: 'normal', minCellHeight: 9 },
      columnStyles: {
        0: { cellWidth: 14 }, 1: { cellWidth: 30 }, 2: { cellWidth: 16 }, 3: { cellWidth: 24 },
        4: { cellWidth: 20 }, 5: { cellWidth: 24 }, 6: { cellWidth: 28 }, 7: { cellWidth: 26 },
      },
    })
  })
  return doc.output('blob')
}

export interface RosterRow {
  teacher: OtTeacher
  count: number   // 該月節數
}

/** 清冊：同計畫全體一張（橫式），today＝表頭日期（YYYY-MM-DD） */
export async function exportRosterPdf(
  plan: OtPlan, month: string, rows: RosterRow[], today: string, onStatus?: (s: string) => void,
): Promise<Blob> {
  const { doc, autoTable } = await newDoc('landscape', onStatus)
  const monthNum = Number(month.slice(5, 7))

  doc.setFont('NotoSansTC', 'bold'); doc.setFontSize(15)
  doc.rect(12, 12, 273, 24)
  doc.text(`${ROSTER_SCHOOL} 減代課員額鐘點費${monthNum}月清冊`, 148.5, 21, { align: 'center' })
  doc.setFont('NotoSansTC', 'normal'); doc.setFontSize(10)
  doc.line(12, 26, 285, 26)
  doc.text(`計畫名稱：  ${plan.name}`, 16, 32)
  doc.text(`日期：  ${today.replace(/-/g, '/')}`, 281, 32, { align: 'right' })

  const body: (string | number)[][] = rows.map((r, i) => {
    const pay = r.count * plan.rate
    const deduct = r.teacher.labor_fee + r.teacher.health_fee + r.teacher.lunch_fee + r.teacher.other_fee
    return [
      i + 1, r.teacher.name, r.count, money(plan.rate), money(pay),
      money(r.teacher.labor_fee), money(r.teacher.health_fee), money(r.teacher.lunch_fee),
      money(r.teacher.other_fee), money(deduct), money(pay - deduct), r.teacher.note,
    ]
  })
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  const totalPay = rows.reduce((s, r) => s + r.count * plan.rate, 0)
  const totalDeduct = rows.reduce(
    (s, r) => s + r.teacher.labor_fee + r.teacher.health_fee + r.teacher.lunch_fee + r.teacher.other_fee, 0)
  body.push([
    { content: '合計', colSpan: 2, styles: { fontStyle: 'bold' } } as unknown as string,
    String(totalCount), '', money(totalPay), '', '', '', '', totalDeduct ? money(totalDeduct) : '', money(totalPay - totalDeduct), '',
  ])

  autoTable(doc, {
    startY: 38,
    margin: { left: 12, right: 12 },
    head: [
      [
        { content: '序號', rowSpan: 2 }, { content: '姓名', rowSpan: 2 },
        { content: '應領鐘點費', colSpan: 3 },
        { content: '代扣款(個人負擔部份)', colSpan: 5 },
        { content: '實領薪資', rowSpan: 2 }, { content: '備註', rowSpan: 2 },
      ],
      ['節數', '節薪', '鐘點費', '勞保費', '健保費', '午餐費代扣', '其他', '合計'],
    ],
    body,
    theme: 'grid',
    styles: {
      font: 'NotoSansTC', fontStyle: 'normal', fontSize: 10, halign: 'center', valign: 'middle',
      cellPadding: 1.6, lineColor: 30, lineWidth: 0.25, textColor: 10, minCellHeight: 11,
    },
    headStyles: { fillColor: [255, 255, 255], textColor: 10, fontStyle: 'bold', minCellHeight: 9 },
    columnStyles: {
      0: { cellWidth: 14 }, 1: { cellWidth: 30 }, 2: { cellWidth: 18 }, 3: { cellWidth: 20 },
      4: { cellWidth: 26 }, 5: { cellWidth: 22 }, 6: { cellWidth: 22 }, 7: { cellWidth: 28 },
      8: { cellWidth: 20 }, 9: { cellWidth: 22 }, 10: { cellWidth: 26 },
    },
  })
  return doc.output('blob')
}
