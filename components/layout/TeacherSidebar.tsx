'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useMobileNav } from '@/components/layout/MobileNav'

const FORMAL_ITEMS = [
  { href: '/teacher/profile',     label: '基本資料' },
  { href: '/teacher/scores',      label: '輪動分數' },
  { href: '/teacher/preferences', label: '選填志願' },
  { href: '/teacher/allocation',  label: '配課選填' },
]
// 代理：不輪動、不選志願，只看基本資料與配課選填
const SUBSTITUTE_ITEMS = [
  { href: '/teacher/profile',    label: '基本資料' },
  { href: '/teacher/allocation', label: '配課選填' },
]

export function TeacherSidebar({ isSubstitute = false }: { isSubstitute?: boolean }) {
  const pathname = usePathname()
  const navItems = isSubstitute ? SUBSTITUTE_ITEMS : FORMAL_ITEMS
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
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => (
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
        </nav>
      </aside>
    </>
  )
}
