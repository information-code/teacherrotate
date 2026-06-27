'use client'

import { createContext, useContext, useState } from 'react'

// 手機抽屜側欄開關狀態：由 TopBar 漢堡鈕觸發、Sidebar 消費。
// 桌機（md+）側欄恆顯示，此狀態不影響桌機版型。
const MobileNavContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({
  open: false,
  setOpen: () => {},
})

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>
}

export const useMobileNav = () => useContext(MobileNavContext)
