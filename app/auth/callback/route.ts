import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    // 收集 exchangeCodeForSession 產生的 session cookies
    const cookiesToSet: Array<{ name: string; value: string; options: Record<string, unknown> }> = []

    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cs) { cookiesToSet.push(...cs) },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // 用 admin client 繞過 RLS 查詢 role（session cookie 尚未傳給 browser）
        const admin = getAdminClient()
        let profile = null
        for (let i = 0; i < 3; i++) {
          const { data } = await admin
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
          if (data) { profile = data; break }
          await new Promise(r => setTimeout(r, 500))
        }

        const dest = profile?.role === 'admin' ? '/select-role' : '/teacher'
        const response = NextResponse.redirect(`${origin}${dest}`)

        // 把 session cookies 掛到 redirect response，瀏覽器才能在下一頁帶上 session
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
        })
        return response
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
