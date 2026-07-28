/** 登入被拒頁：顯示這次用哪個信箱登入，讓「選錯 Google 帳號」可以自我診斷。 */
export default function UnauthorizedPage({ searchParams }: { searchParams?: { email?: string } }) {
  const email = searchParams?.email
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <div className="card max-w-sm w-full text-center space-y-4 p-8">
        <div className="text-4xl text-zinc-300">🔒</div>
        <h1 className="text-lg font-semibold text-zinc-800">無法進入系統</h1>
        {email ? (
          <div className="text-sm text-zinc-500 leading-relaxed space-y-2">
            <p>
              您這次是以<br />
              <span className="font-medium text-zinc-800 break-all">{email}</span><br />
              登入，但系統查無此信箱的帳號資料。
            </p>
            <p>
              請改用<b>學校配發的 Google 帳號</b>重新登入
              （Google 選擇帳號時請留意選對）；<br />
              若確定信箱無誤，請聯繫資訊組確認帳號資料。
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 leading-relaxed">
            您的帳號尚未取得授權。<br />
            請聯繫本校資訊組。
          </p>
        )}
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
