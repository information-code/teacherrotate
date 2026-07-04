import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 取得目前民國年 */
export function getCurrentROCYear(): number {
  return new Date().getFullYear() - 1911
}

/** 民國年轉西元年 */
export function rocToAD(rocYear: number): number {
  return rocYear + 1911
}

// ── 虛擬（待聘）帳號 ──
// 甄選未放榜前先建帳號假性配課排課；以占位 email 表示，考上後把 email 改成
// 真實信箱即「轉正」——老師登入時由 handle_new_user trigger 自動換綁 id，
// 配課、配班、排課引用全部保留。
export const VIRTUAL_EMAIL_DOMAIN = '@virtual.local'
export function isVirtualEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(VIRTUAL_EMAIL_DOMAIN))
}
