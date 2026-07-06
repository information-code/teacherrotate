'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useMobileNav } from '@/components/layout/MobileNav'
import { InstallGuide } from '@/components/layout/InstallGuide'

interface TopBarProps {
  userName: string
  role: 'teacher' | 'admin'
  isAdmin?: boolean
}

export function TopBar({ userName, role, isAdmin }: TopBarProps) {
  const router = useRouter()
  const supabase = createClient()
  const { setOpen } = useMobileNav()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-12 border-b border-zinc-200 bg-white flex items-center justify-between px-4 md:px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* 手機漢堡鈕：開啟抽屜側欄（桌機隱藏） */}
        <button
          type="button"
          aria-label="開啟選單"
          onClick={() => setOpen(true)}
          className="md:hidden -ml-1 mr-1 p-1.5 text-zinc-600 hover:text-zinc-900"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
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
        {/* 加到主畫面教學（教師端；手機/平板首次進入自動跳出） */}
        {role === 'teacher' && <InstallGuide autoPrompt />}
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
