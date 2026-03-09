'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function handleGoogleLogin() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError('登入失敗，請稍後再試。')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* 標題區 */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-900">教師輪動系統</h1>
          <p className="mt-2 text-sm text-zinc-500">請使用學校 Google 帳號登入</p>
        </div>

        {/* 登入卡片 */}
        <div className="card">
          {error && (
            <div className="mb-4 px-4 py-3 border border-red-200 bg-red-50 text-red-700 text-sm rounded-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-3"
          >
            {!loading && (
              <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                <path d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
                <path d="M6.3 14.7l7 5.1C15.1 16 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.6 7.4 6.3 14.7z" fill="#FF3D00"/>
                <path d="M24 46c5.8 0 10.7-1.9 14.6-5.2l-6.7-5.5C29.9 37 27.1 38 24 38c-5.8 0-10.7-3.9-12.5-9.2l-7 5.4C7.9 42 15.4 46 24 46z" fill="#4CAF50"/>
                <path d="M44.5 20H24v8.5h11.8c-1 3-3.3 5.5-6.3 7l6.7 5.5C40.4 37.4 44.5 31.3 44.5 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
              </svg>
            )}
            {loading ? '登入中...' : '以 Google 帳號登入'}
          </button>

          <p className="mt-4 text-xs text-zinc-400 text-center">
            登入即代表您已閱讀並同意本系統的使用規範
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-400">
          如有問題請聯絡學校系統管理員
        </p>
      </div>
    </div>
  )
}
