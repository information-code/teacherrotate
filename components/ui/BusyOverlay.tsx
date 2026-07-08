/** 全螢幕處理中遮罩：半透明底＋轉圈＋文字，蓋在 modal（z-50）之上 */
export function BusyOverlay({ text = '處理中…' }: { text?: string }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center">
      <div className="bg-white rounded-md shadow-xl px-6 py-4 flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-zinc-200 border-t-zinc-700 rounded-full animate-spin" />
        <span className="text-sm text-zinc-700">{text}</span>
      </div>
    </div>
  )
}
