import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Service role client — 懶式建立，僅在 API Routes 呼叫時初始化
// 絕對不在前端（Client Components）使用
let _admin: SupabaseClient<Database> | null = null

export function getAdminClient(): SupabaseClient<Database> {
  if (!_admin) {
    _admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
  }
  return _admin
}

// 向下相容的 proxy 物件
export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop) {
    return (getAdminClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
