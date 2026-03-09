import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'

export default async function SelectRolePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('name, email, role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/teacher')

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-900">教師輪動系統</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {profile?.name ?? profile?.email}，請選擇進入身份
          </p>
        </div>

        <div className="card space-y-3">
          <Link
            href="/teacher"
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <span>以教師身份進入</span>
          </Link>
          <Link
            href="/admin"
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <span>以管理員身份進入</span>
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-400">
          如有問題請聯絡學校系統管理員
        </p>
      </div>
    </div>
  )
}
