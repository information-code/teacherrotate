// 設備報修：維修工作單 PDF（給維護志工帶出去處理用）。
// jsPDF＋autotable，中文字型 Noto Sans TC 按下時才從 CDN 抓（比照 schedule-export）。

export interface WorkOrderCase {
  item_name: string
  issue_text: string
  location: string
  teacher_name: string
  created_at: string
  admin_note: string
}

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

function timeText(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export async function casesToWorkOrderPdf(cases: WorkOrderCase[], onStatus?: (s: string) => void): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void }).default
  const font = await loadFontBase64(onStatus)
  onStatus?.('排版中…')

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  doc.addFileToVFS('NotoSansTC.ttf', font)
  doc.addFont('NotoSansTC.ttf', 'NotoSansTC', 'normal')
  doc.addFont('NotoSansTC.ttf', 'NotoSansTC', 'bold')

  doc.setFont('NotoSansTC', 'bold')
  doc.setFontSize(16)
  doc.text('設備報修工作單', 105, 16, { align: 'center' })
  doc.setFont('NotoSansTC', 'normal')
  doc.setFontSize(10)
  const printed = new Date().toLocaleString('zh-TW', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  doc.text(`列印：${printed}｜共 ${cases.length} 件`, 196, 23, { align: 'right' })

  const body = cases.map((c, i) => [
    String(i + 1),
    c.item_name,
    c.admin_note ? `${c.issue_text}\n（說明：${c.admin_note}）` : c.issue_text,
    c.location,
    c.teacher_name,
    timeText(c.created_at),
    '',  // 處理情形：留白給志工填寫
  ])

  autoTable(doc, {
    startY: 27, margin: { left: 14, right: 14 },
    head: [['#', '設備', '問題', '地點', '報修人', '報修時間', '處理情形']],
    body,
    theme: 'grid',
    styles: {
      font: 'NotoSansTC', fontStyle: 'normal', fontSize: 9.5,
      valign: 'middle', cellPadding: 1.6,
      lineColor: 30, lineWidth: 0.25, textColor: 10,
      minCellHeight: 14, overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [245, 245, 245], textColor: 10, fontStyle: 'bold',
      halign: 'center', minCellHeight: 8, lineWidth: 0.25, lineColor: 30,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 28 },
      2: { cellWidth: 52 },
      3: { cellWidth: 24 },
      4: { cellWidth: 20 },
      5: { cellWidth: 22, halign: 'center', fontSize: 8.5 },
      6: { cellWidth: 28 },
    },
  })

  return doc.output('blob')
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
}
