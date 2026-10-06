'use client'

import { installDemoFetch } from '../demo-fetch'
import LendingOverviewClient from '@/components/admin/equipment/LendingOverviewClient'

installDemoFetch()

export default function DemoAdmin() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <LendingOverviewClient
        overdueTemplate="{老師}老師您好，提醒您歸還{設備}。"
        pickupTemplate="{老師}老師您好，您於{日期}{時段}預約的「{設備}」尚未按下開始借用，請至系統補辦手續。"
      />
    </main>
  )
}
