'use client'

import { useEffect, useState } from 'react'

/** Android Chrome 的原生安裝事件（標準尚未定案，自行定義型別） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'a2hs_guide_dismissed'

type Platform = 'ios' | 'android' | 'desktop'

/**
 * 「加到主畫面」教學：
 * - Android（Chrome）攔截 beforeinstallprompt 可一鍵觸發原生安裝
 * - iOS 顯示 Safari 分享→加入主畫面 的圖解步驟
 * - 手機/平板首次進入自動跳出；勾「不再顯示」記在該裝置（localStorage）
 */
export function InstallGuide({ autoPrompt = false }: { autoPrompt?: boolean }) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState<Platform>('desktop')
  const [standalone, setStandalone] = useState(false)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  useEffect(() => {
    const ua = navigator.userAgent
    const isIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    const isAndroid = /Android/.test(ua)
    const detected: Platform = isIos ? 'ios' : isAndroid ? 'android' : 'desktop'
    setPlatform(detected)

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    setStandalone(isStandalone)

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setInstallEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // 手機/平板、非 App 模式、未勾過不再顯示 → 自動跳教學
    if (autoPrompt && detected !== 'desktop' && !isStandalone && !localStorage.getItem(DISMISS_KEY)) {
      setOpen(true)
    }
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [autoPrompt])

  const close = () => {
    if (dontShowAgain) localStorage.setItem(DISMISS_KEY, '1')
    setOpen(false)
  }

  const nativeInstall = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') {
      localStorage.setItem(DISMISS_KEY, '1')
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-zinc-500 hover:text-zinc-800 transition-colors whitespace-nowrap"
      >
        加到主畫面
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-md shadow-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="font-semibold text-zinc-900">把系統加到手機主畫面</h3>
              <p className="text-sm text-zinc-500 mt-1">
                設定一次之後，從主畫面點圖示就能像 App 一樣全螢幕使用，拍照借還設備更方便。
              </p>
            </div>

            {standalone ? (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-3">
                您現在就是從主畫面的 App 開啟的，不需要再設定 🎉
              </p>
            ) : platform === 'android' && installEvent ? (
              <div className="space-y-3">
                <button className="btn-primary w-full" onClick={nativeInstall}>
                  一鍵安裝到主畫面
                </button>
                <p className="text-xs text-zinc-500 text-center">
                  按下後手機會跳出安裝確認，點「安裝」即完成。
                </p>
              </div>
            ) : platform === 'android' ? (
              <ol className="space-y-3">
                <Step n={1} icon={<DotsIcon />} text={<>點瀏覽器右上角的「<b>⋮</b>」選單</>} />
                <Step n={2} icon={<AddBoxIcon />} text={<>選「<b>加入主畫面</b>」或「<b>安裝應用程式</b>」</>} />
                <Step n={3} icon={<CheckIcon />} text={<>按「<b>安裝</b>」，主畫面就會出現系統圖示</>} />
              </ol>
            ) : platform === 'ios' ? (
              <div className="space-y-3">
                <ol className="space-y-3">
                  <Step n={1} icon={<ShareIcon />} text={<>點 Safari 下方工具列的「<b>分享</b>」按鈕</>} />
                  <Step n={2} icon={<AddBoxIcon />} text={<>選單往下捲，選「<b>加入主畫面</b>」</>} />
                  <Step n={3} icon={<CheckIcon />} text={<>右上角按「<b>新增</b>」，主畫面就會出現系統圖示</>} />
                </ol>
                <p className="text-xs text-zinc-400">
                  ※ 需使用 Safari 瀏覽器開啟本網站才有「加入主畫面」選項。
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-600 bg-zinc-50 border border-zinc-200 rounded p-3">
                請改用<b>手機</b>開啟本網站（iPhone 用 Safari、Android 用 Chrome），
                再點右上角的「加到主畫面」按鈕，即可依步驟安裝。
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-100">
              <label className="flex items-center gap-2 text-sm text-zinc-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={e => setDontShowAgain(e.target.checked)}
                />
                我已設定完成，不要再自動顯示
              </label>
              <button className="btn-secondary flex-1 sm:flex-none" onClick={close}>關閉</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Step({ n, icon, text }: { n: number; icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border border-zinc-200 rounded p-3">
      <span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <span className="w-9 h-9 flex items-center justify-center text-zinc-700 bg-zinc-100 rounded flex-shrink-0">
        {icon}
      </span>
      <span className="text-sm text-zinc-700">{text}</span>
    </li>
  )
}

/** iOS 分享圖示：方框＋向上箭頭 */
function ShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 9H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1" />
      <line x1="12" y1="14" x2="12" y2="3" />
      <polyline points="8,6.5 12,2.5 16,6.5" />
    </svg>
  )
}

/** 加入主畫面圖示：圓角方框＋加號 */
function AddBoxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <line x1="12" y1="8.5" x2="12" y2="15.5" />
      <line x1="8.5" y1="12" x2="15.5" y2="12" />
    </svg>
  )
}

/** Android 直向選單「⋮」 */
function DotsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,12.5 10,18.5 20,6.5" />
    </svg>
  )
}
