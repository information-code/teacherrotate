// 設備借用教學影片素材：對 /demo/equipment 示範頁逐步操作並截圖（假資料，不碰資料庫）
// 用法：先起 dev server，再 DEMO_BASE=http://localhost:3000 node remotion/lending/scripts/capture.mjs
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const BASE = process.env.DEMO_BASE ?? 'http://localhost:3000'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'shots')
mkdirSync(OUT, { recursive: true })
// 觸發上傳用的小圖（內容無所謂，示範模式會回傳示範照片）
const UPLOAD = join(tmpdir(), 'trotate-lending-upload.png')
writeFileSync(UPLOAD, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const shot = async (page, name) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log('✓', name)
}

const browser = await chromium.launch({ channel: 'msedge' })

// 桌機：借用情況（設備課表）
const desk = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 2 })
await desk.goto(`${BASE}/demo/equipment`)
await desk.getByText('設備課表').first().waitFor()
await shot(desk, 'board')

// 手機：預約 → 我的借用 → 借用手續 → 歸還手續
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const p = await phone.newPage()
p.on('dialog', d => d.accept())
await p.goto(`${BASE}/demo/equipment`)
await p.getByRole('button', { name: '短期借用' }).click()
const selects = p.locator('select')
await selects.nth(0).selectOption({ label: '第5節' })
await selects.nth(1).selectOption({ label: '第6節' })
await selects.nth(2).selectOption({ label: '筆記型電腦(教師機)' })
await p.getByRole('button', { name: '確定' }).click()
await p.getByRole('button', { name: '預約借用' }).first().waitFor()
await p.getByRole('button', { name: '預約借用' }).first().scrollIntoViewIfNeeded()
await shot(p, 'reserve')

await p.getByRole('button', { name: '預約借用' }).first().click()
await p.getByRole('button', { name: '開始借用' }).waitFor()
await p.evaluate(() => window.scrollTo(0, 0))
await shot(p, 'myloans')

await p.getByRole('button', { name: '開始借用' }).click()
const borrow = p.getByRole('dialog')
await borrow.getByRole('button', { name: /設備外觀無損壞/ }).click()
await borrow.locator('input[type="file"]').first().setInputFiles(UPLOAD)
await borrow.getByText('已拍照').waitFor()
await borrow.getByText('我已確認以上項目').click()
await shot(p, 'borrow')

await borrow.getByRole('button', { name: '完成借用' }).click()
await p.getByRole('button', { name: '辦理歸還' }).click()
const giveback = p.getByRole('dialog')
await giveback.locator('input[type="file"]').first().setInputFiles(UPLOAD)
await giveback.getByText('已拍照').waitFor()
await giveback.getByText('我已確認以上項目').click()
await shot(p, 'giveback')

await browser.close()
