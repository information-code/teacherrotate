export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <div className="card max-w-sm w-full text-center space-y-4 p-8">
        <div className="text-4xl text-zinc-300">🔒</div>
        <h1 className="text-lg font-semibold text-zinc-800">無法進入系統</h1>
        <p className="text-sm text-zinc-500 leading-relaxed">
          您的帳號尚未取得授權。<br />
          請聯繫本校資訊組。
        </p>
        <a
          href="/login"
          className="block text-xs text-zinc-400 hover:text-zinc-600 pt-2"
        >
          返回登入頁
        </a>
      </div>
    </div>
  )
}
