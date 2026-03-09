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
