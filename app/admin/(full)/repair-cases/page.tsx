import { guardPage } from '@/lib/staff-server'
import RepairCasesClient from './RepairCasesClient'

export const dynamic = 'force-dynamic'

export default async function RepairCasesPage() {
  await guardPage(['repair-cases'])
  return <RepairCasesClient />
}
