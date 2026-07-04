'use client'

import { useEffect } from 'react'

/**
 * 未儲存離開守衛：dirty 為 true 時——
 *  1. 攔截關閉分頁／重新整理／外部導航（beforeunload，瀏覽器原生確認框）
 *  2. 攔截站內連結點擊（App Router 的 Link 不觸發 beforeunload，用捕獲階段 click 確認）
 */
export function useUnsavedGuard(dirty: boolean, message = '資料尚未儲存完成，現在離開將遺失變更。確定要離開嗎？') {
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClickCapture = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href || href.startsWith('#') || a.target === '_blank' || href.startsWith('mailto:')) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [dirty, message])
}
