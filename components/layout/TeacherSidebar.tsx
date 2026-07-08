'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useMobileNav } from '@/components/layout/MobileNav'

interface NavGroup { title: string; items: { href: string; label: string }[] }

const FORMAL_GROUPS: NavGroup[] = [
  {
    title: '常用功能',
    items: [
      { href: '/teacher/profile',   label: '基本資料' },
      { href: '/teacher/timetable', label: '我的課表' },
      { href: '/teacher/equipment', label: '設備借用' },
      { href: '/teacher/scores',    label: '輪動分數' },
    ],
  },
  {
    title: '選填調查',
    items: [
      { href: '/teacher/preferences',   label: '志願選填' },
      { href: '/teacher/allocation',    label: '配課選填' },
      { href: '/teacher/schedule-fill', label: '排課選填' },
    ],
  },
]
// 代理：不輪動、不選志願
const SUBSTITUTE_GROUPS: NavGroup[] = [
  {
    title: '常用功能',
    items: [
      { href: '/teacher/profile',   label: '基本資料' },
      { href: '/teacher/timetable', label: '我的課表' },
      { href: '/teacher/equipment', label: '設備借用' },
    ],
  },
  {
    title: '選填調查',
    items: [
      { href: '/teacher/allocation',    label: '配課選填' },
      { href: '/teacher/schedule-fill', label: '排課選填' },
    ],
  },
]
// 鐘點：課表與設備借用
const HOURLY_GROUPS: NavGroup[] = [
  {
    title: '常用功能',
    items: [
      { href: '/teacher/timetable', label: '我的課表' },
      { href: '/teacher/equipment', label: '設備借用' },
    ],
  },
]

export function TeacherSidebar({
  employmentType = 'formal',
  siteTitle = '教師系統',
}: {
  employmentType?: string
  siteTitle?: string
}) {
  const pathname = usePathname()
  const navGroups =
    employmentType === 'hourly' ? HOURLY_GROUPS
    : employmentType === 'substitute' ? SUBSTITUTE_GROUPS
    : FORMAL_GROUPS
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
          <span className="text-sm font-semibold text-zinc-900">{siteTitle}</span>
        </div>

        {/* 導覽 */}
        <nav className="flex-1 p-3 space-y-4">
          {navGroups.map(group => (
            <div key={group.title} className="space-y-1">
              <div className="px-3 text-[11px] font-medium text-zinc-400">{group.title}</div>
              {group.items.map(item => (
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
