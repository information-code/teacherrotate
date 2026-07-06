import type { MetadataRoute } from 'next'
import { getSiteTitle } from '@/lib/site'

// 學校名稱改動要即時反映在安裝名稱上
export const dynamic = 'force-dynamic'

/** PWA manifest：讓 Android 可一鍵安裝、iOS 加入主畫面後以獨立視窗開啟 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const title = await getSiteTitle()
  return {
    name: title,
    short_name: title,
    description: '教師管理平台',
    start_url: '/teacher',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#27272a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
