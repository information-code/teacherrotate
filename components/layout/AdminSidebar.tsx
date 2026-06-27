'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useMobileNav } from '@/components/layout/MobileNav'

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
    title: '配課管理',
    items: [
      { href: '/admin/allocation-config', label: '配課設定' },
      { href: '/admin/allocation-statistics', label: '配課統計' },
    ],
  },
  {
    title: '排課管理',
    items: [
      { href: '/admin/schedule-config', label: '排課設定' },
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
  const { open, setOpen } = useMobileNav()

  return (
    <>
      {/* 手機遮罩：抽屜開啟時顯示，點擊關閉（桌機隱藏） */}
      <div
        className={cn('fixed inset-0 z-30 bg-black/40 md:hidden', open ? 'block' : 'hidden')}
        onClick={() => setOpen(false)}
      />
      <aside
        className={cn(
          'w-56 bg-white border-r border-zinc-200 flex flex-col flex-shrink-0',
          // 手機：固定式抽屜，依 open 滑入/滑出；桌機（md+）：回到常駐排版
          'fixed inset-y-0 left-0 z-40 transition-transform md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
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
                  onClick={() => setOpen(false)}
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
    </>
  )
}
