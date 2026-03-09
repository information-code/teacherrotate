import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '教師輪動系統',
  description: '教師工作輪動管理平台',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  )
}
