'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/admin/whitelist',  label: '帳號管理' },
  { href: '/admin/teachers',   label: '教師管理' },
  { href: '/admin/scoremap',   label: '分數對照表' },
  { href: '/admin/rotations',  label: '教師工作紀錄' },
  { href: '/admin/statistics',    label: '志願統計' },
  { href: '/admin/confirmations', label: '積分確認狀態' },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-white border-r border-zinc-200 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="h-12 border-b border-zinc-200 flex items-center px-5">
        <span className="text-sm font-semibold text-zinc-900">教師輪動系統</span>
      </div>

      {/* 導覽 */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'sidebar-link',
              pathname === item.href && 'active'
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
