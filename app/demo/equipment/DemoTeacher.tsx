'use client'

import { installDemoFetch } from '../demo-fetch'
import { EquipmentPage } from '@/components/teacher/EquipmentPage'

installDemoFetch()

export default function DemoTeacher() {
  return (
    <main className="min-h-screen bg-zinc-50 p-3">
      <EquipmentPage />
    </main>
  )
}
