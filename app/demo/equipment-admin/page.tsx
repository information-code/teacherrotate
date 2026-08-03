import { notFound } from 'next/navigation'
import DemoAdmin from './DemoAdmin'

export const dynamic = 'force-dynamic'

/** 介紹影片截圖用示範頁（假資料、不碰資料庫）；正式環境不開放 */
export default function DemoEquipmentAdminPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <DemoAdmin />
}
