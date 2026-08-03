import { notFound } from 'next/navigation'
import NavClient from './NavClient'

export const dynamic = 'force-dynamic'

/** 介紹影片截圖用：含側欄/頂欄的完整教師端外框（假資料、不碰資料庫）；正式環境不開放 */
export default function DemoNavPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <NavClient />
}
