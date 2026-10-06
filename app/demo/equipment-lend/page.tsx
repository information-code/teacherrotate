import { notFound } from 'next/navigation'
import DemoLend from './DemoLend'

export const dynamic = 'force-dynamic'

/** 介紹影片截圖用示範頁（假資料、不碰資料庫）；正式環境不開放 */
export default function DemoEquipmentLendPage({ searchParams }: { searchParams: { tab?: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const tab = searchParams.tab === 'activity' || searchParams.tab === 'long' ? searchParams.tab : 'short'
  return <DemoLend tab={tab} />
}
