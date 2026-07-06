import type { Metadata, Viewport } from 'next'
import { getSiteTitle } from '@/lib/site'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const title = await getSiteTitle()
  return {
    title,
    description: '教師管理平台',
    icons: { apple: '/icons/apple-touch-icon.png' },
    // iOS 加入主畫面後以獨立視窗（假性 App）開啟
    appleWebApp: { capable: true, title, statusBarStyle: 'default' },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  )
}
