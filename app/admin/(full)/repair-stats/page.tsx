import { guardPage } from '@/lib/staff-server'
import RepairStatsClient from './RepairStatsClient'

export const dynamic = 'force-dynamic'

export default async function RepairStatsPage() {
  await guardPage(['repair-stats'])
  return <RepairStatsClient />
}
