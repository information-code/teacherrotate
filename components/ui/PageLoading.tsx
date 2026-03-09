export function PageLoading() {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-700 rounded-full animate-spin" />
        <span className="text-sm text-zinc-500">載入中...</span>
      </div>
    </div>
  )
}
