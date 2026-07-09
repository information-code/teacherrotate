import { guardPage } from '@/lib/staff-server'
import { CalendarAdminPage } from '@/components/admin/CalendarAdminPage'

export const dynamic = 'force-dynamic'

export default async function AdminCalendarPage() {
  await guardPage(['calendar', 'holidays'])
  return <CalendarAdminPage />
}
