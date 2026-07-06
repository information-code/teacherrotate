export const dynamic = 'force-dynamic'

import { getSiteTitle } from '@/lib/site'
import LoginClient from './LoginClient'

export default async function LoginPage() {
  return <LoginClient siteTitle={await getSiteTitle()} />
}
