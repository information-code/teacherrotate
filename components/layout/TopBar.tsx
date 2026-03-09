'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface TopBarProps {
  userName: string
  role: 'teacher' | 'admin'
  isAdmin?: boolean
}

export function TopBar({ userName, role, isAdmin }: TopBarProps) {
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-12 border-b border-zinc-200 bg-white flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-900">{userName}</span>
        <span className={`badge ${role === 'admin' ? 'badge-warn' : 'badge-default'}`}>
          {role === 'admin' ? '管理員' : '教師'}
        </span>
      </div>
      <div className="flex items-center gap-4">
        {isAdmin && (
          <Link
            href={role === 'admin' ? '/teacher' : '/admin'}
            className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            切換至{role === 'admin' ? '教師端' : '管理端'}
          </Link>
        )}
        <button
          onClick={handleLogout}
          className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
        >
          登出
        </button>
      </div>
    </header>
  )
}
