'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navSections = [
  {
    title: '教師管理',
    items: [
      { href: '/admin/whitelist', label: '帳號資料' },
      { href: '/admin/teachers',  label: '教師資料' },
      { href: '/admin/rotations', label: '工作紀錄' },
    ],
  },
  {
    title: '選填管理',
    items: [
      { href: '/admin/confirmations',     label: '確認統計' },
      { href: '/admin/statistics',        label: '志願統計' },
      { href: '/admin/selection-panel',   label: '選填面板' },
    ],
  },
  {
    title: '規則設定',
    items: [
      { href: '/admin/scoremap', label: '分數對照表' },
    ],
  },
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
      <nav className="flex-1 p-3 space-y-5 overflow-y-auto">
        {navSections.map(section => (
          <div key={section.title} className="space-y-1">
            <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              {section.title}
            </div>
            {section.items.map(item => (
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
          </div>
        ))}
      </nav>
    </aside>
  )
}
