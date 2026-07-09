import { guardPage } from '@/lib/staff-server'
import { AnnouncementsAdminPage } from '@/components/admin/AnnouncementsAdminPage'

export const dynamic = 'force-dynamic'

export default async function AdminAnnouncementsPage() {
  await guardPage(['announcements'])
  return <AnnouncementsAdminPage />
}
