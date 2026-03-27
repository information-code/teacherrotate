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
        const admin = getAdminClient()

        // 先用 id 找（已登入過的情況）
        let { data: profile } = await admin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        // 找不到 → 可能是第一次登入，用 email 找管理者預建的 profile
        if (!profile && user.email) {
          const { data: byEmail } = await admin
            .from('profiles')
            .select('role')
            .eq('email', user.email)
            .single()

          if (byEmail) {
            // 將 profile.id 更新為真實 auth UUID（trigger 已處理，這裡是備援）
            await admin
              .from('profiles')
              .update({ id: user.id })
              .eq('email', user.email)
            profile = byEmail
          }
        }

        // profile 不存在 → 管理者尚未建立此帳號，拒絕進入
        if (!profile) {
          const response = NextResponse.redirect(`${origin}/unauthorized`)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
          })
          return response
        }

        const r = profile.role
        const dest = (r === 'admin' || r === 'superadmin') ? '/select-role' : '/teacher'
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
