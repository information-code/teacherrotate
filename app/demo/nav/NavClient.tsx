'use client'

import { installDemoFetch } from '../demo-fetch'
import { EquipmentPage } from '@/components/teacher/EquipmentPage'
import { TeacherSidebar } from '@/components/layout/TeacherSidebar'
import { TopBar } from '@/components/layout/TopBar'
import { MobileNavProvider } from '@/components/layout/MobileNav'

installDemoFetch()

/** 比照 teacher layout 的外框組成，供側欄開合動畫截圖 */
export default function NavClient() {
  return (
    <MobileNavProvider>
      <div className="flex h-screen bg-zinc-50 overflow-hidden">
        <TeacherSidebar siteTitle="快樂國小教師系統" />
        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar userName="王小明" role="teacher" isAdmin={false} />
          <main className="relative flex-1 overflow-y-auto p-3 md:p-6">
            <EquipmentPage />
          </main>
        </div>
      </div>
    </MobileNavProvider>
  )
}
