'use client'

import { installDemoFetch } from '../demo-fetch'
import EquipmentManageClient from '@/app/admin/(full)/equipment/EquipmentManageClient'

installDemoFetch()

const equipment = [
  { id: 't1', name: '平板電腦(教師機)', status: 'available', asset_number: 'gpps-114-01', group_id: 'g1' },
  { id: 't2', name: '平板電腦(教師機)', status: 'available', asset_number: 'gpps-114-02', group_id: 'g1' },
  { id: 'n1', name: '筆記型電腦(教師機)', status: 'available', asset_number: 'NB-01', group_id: null },
  { id: 'c1', name: '攝影機', status: 'available', asset_number: '3000063', group_id: null },
]
const groups = [{ id: 'g1', name: '平板充電車 A 車', status: 'available', member_count: 4 }]
const teachers = [
  { id: 'p1', name: '王小明' },
  { id: 'p2', name: '林美惠' },
  { id: 'p3', name: '張志成' },
]

export default function DemoAdmin() {
  return (
    <main className="min-h-screen bg-zinc-50 p-6">
      <EquipmentManageClient
        equipment={equipment}
        groups={groups}
        teachers={teachers}
        overdueTemplate="{老師}老師您好，提醒您歸還{設備}。"
        renewalWeeks={20}
      />
    </main>
  )
}
