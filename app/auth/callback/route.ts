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
        const byId = await admin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
        let profile = byId.data
        let lookupFailed = !!byId.error

        // 找不到 → 可能是第一次登入，用 email 找管理者預建的 profile
        if (!profile && user.email) {
          const byEmail = await admin
            .from('profiles')
            .select('id, role')
            .eq('email', user.email)
            .maybeSingle()
          lookupFailed = lookupFailed || !!byEmail.error

          if (byEmail.data) {
            // 將 profile.id 更新為真實 auth UUID（trigger 已處理，這裡是備援），
            // 並同步 JSON 引用（配班、排課、撕榜）
            const oldId = byEmail.data.id
            await admin
              .from('profiles')
              .update({ id: user.id })
              .eq('email', user.email)
            if (oldId && oldId !== user.id) {
              await admin.rpc('relink_profile_refs', { old_id: oldId, new_id: user.id })
            }
            profile = byEmail.data
          }
        }

        // profile 不存在 → 管理者尚未建立此帳號，拒絕進入。
        // 同時刪除這次登入產生的 auth 帳號、且不發 session：
        // 強制「管理者先建立帳號，老師才能登入」——太早登入不留下任何殘留，
        // 等 profile 建好後老師重新登入會產生全新 auth 帳號，由 on_auth_user_created
        // trigger 以 email 連結 profile，id 永遠一致（避免先登入後建檔造成的 id 錯位）。
        if (!profile) {
          if (!lookupFailed) await admin.auth.admin.deleteUser(user.id)  // 查詢異常時不誤刪
          return NextResponse.redirect(`${origin}/unauthorized`)
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
