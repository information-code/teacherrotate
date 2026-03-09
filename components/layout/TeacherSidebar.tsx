'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/teacher/profile', label: '基本資料' },
  { href: '/teacher/scores',  label: '輪動分數 / 志願' },
]

export function TeacherSidebar() {
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
