import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // 靜態資源跳過
  if (pathname.startsWith('/_next') || pathname.startsWith('/api/auth')) {
    return supabaseResponse
  }

  // 未登入 → 導向 /login
  if (!user && pathname !== '/login' && !pathname.startsWith('/auth')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // 已登入且在 /login → 導向對應頁面
  if (user && pathname === '/login') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = profile?.role
    const dest = (role === 'admin' || role === 'superadmin') ? '/select-role' : '/teacher'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // /select-role 只需確認已登入（角色由頁面自行驗證）
  if (pathname === '/select-role' && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // /admin 角色驗證由 admin layout 處理（middleware 只確認已登入）

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)',
  ],
}
