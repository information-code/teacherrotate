import type { Metadata, Viewport } from 'next'
import { getSiteTitle } from '@/lib/site'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await getSiteTitle(),
    description: '教師管理平台',
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
