// 介紹影片素材自動截圖：對 /demo 示範頁逐步操作，輸出高解析截圖。
// 用法：先起 dev server（npm run dev），再 node remotion/scripts/capture.mjs
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.DEMO_BASE ?? 'http://localhost:3000'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'shots')
mkdirSync(OUT, { recursive: true })

// 觸發檔案上傳用的小圖（內容無所謂，shim 會回示範照片）
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const TMP_PHOTO = join(OUT, '_upload.png')
writeFileSync(TMP_PHOTO, TINY_PNG)

const shot = async (page, name) => {
  await page.waitForTimeout(450) // 等動畫/字型穩定
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log('✓', name)
}

const browser = await chromium.launch()

// ---------- 教師端（手機 390×844 @2x） ----------
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const p = await phone.newPage()
await p.goto(`${BASE}/demo/equipment`)
await p.getByText('預約借用', { exact: true }).first().waitFor()
await shot(p, 's02-teacher-home')

// 選時段與設備
const selects = p.locator('select')
await selects.nth(0).selectOption({ label: '第2節' })   // 開始時段
await selects.nth(1).selectOption({ label: '第4節' })   // 結束時段
await selects.nth(2).selectOption({ label: '平板電腦(教師機)' }) // 借用設備
await shot(p, 's03a-selected')

await p.getByRole('button', { name: '確定' }).click()
await p.getByText('可借用', { exact: false }).first().waitFor()
await shot(p, 's03b-results')

await p.getByRole('button', { name: '預約借用' }).first().click()
await p.getByText('我的借用').waitFor()
await shot(p, 's03c-reserved')

// 借用手續
await p.getByRole('button', { name: '開始借用' }).click()
await p.getByText('借用手續（1/2）', { exact: false }).waitFor()
await shot(p, 's04a-agreement')

await p.locator('.fixed input[type="checkbox"]').first().check()
await p.getByRole('button', { name: '下一步' }).click()
await p.getByText('（需拍照）').waitFor()
const boxes = p.locator('.fixed input[type="checkbox"]')
await boxes.nth(0).check()
await boxes.nth(1).check()
await p.locator('.fixed input[type="file"]').first().setInputFiles(TMP_PHOTO)
await p.locator('.fixed img[alt="上傳照片"]').first().waitFor()
await shot(p, 's04b-checklist')

await p.getByRole('button', { name: '完成借用' }).click()
await p.getByText('辦理歸還').waitFor()
await shot(p, 's04c-borrowed')

// 歸還手續
await p.getByRole('button', { name: '辦理歸還' }).click()
await p.getByText('歸還手續（1/2）', { exact: false }).waitFor()
await p.locator('.fixed input[type="checkbox"]').first().check()
await p.getByRole('button', { name: '下一步' }).click()
await p.getByText('（需拍照）').waitFor()
await p.locator('.fixed input[type="checkbox"]').first().check()
await p.locator('.fixed input[type="file"]').first().setInputFiles(TMP_PHOTO)
await p.locator('.fixed img[alt="上傳照片"]').first().waitFor()
await shot(p, 's05a-return')

await p.getByRole('button', { name: '完成歸還' }).click()
await p.getByText('近期紀錄').waitFor()
await shot(p, 's05b-done')

// 整組借用
await selects.nth(0).selectOption({ label: '第1節' })
await selects.nth(1).selectOption({ label: '第4節' })
await selects.nth(2).selectOption({ label: '平板充電車 A 車〔整組 4 台〕' })
await p.getByRole('button', { name: '確定' }).click()
await p.getByText('整組可借').waitFor()
await shot(p, 's06-group')

// 長期借用與續借
await p.getByRole('button', { name: '長期借用' }).click()
await p.getByText('長期借用中').waitFor()
await shot(p, 's07a-long')

await p.getByRole('button', { name: '續借回傳' }).click()
await p.getByText('續借回傳：', { exact: false }).waitFor()
await p.locator('.fixed input[type="file"]').first().setInputFiles(TMP_PHOTO)
await p.locator('.fixed img[alt="上傳照片"]').first().waitFor()
await p.locator('.fixed input[type="checkbox"]').first().check()
await shot(p, 's07b-renewal')

await phone.close()

// ---------- 管理端（桌機 1440×900 @2x） ----------
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
const d = await desktop.newPage()
await d.goto(`${BASE}/demo/equipment-admin`)
await d.getByText('設備借用管理').waitFor()
await d.getByText('王小明').first().waitFor()
await shot(d, 's08a-admin-overview')

await d.getByRole('button', { name: '短期借用' }).click()
await d.getByText('操作的歷史日誌', { exact: false }).waitFor()
await d.getByText('#gpps-114-02').first().waitFor()
await shot(d, 's08b-admin-log')

await desktop.close()
await browser.close()
console.log('全部截圖完成 →', OUT)
