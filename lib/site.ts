import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** 學校名稱（系統偏好設定，settings key: school_name） */
export async function getSchoolName(): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('settings').select('value').eq('key', 'school_name').maybeSingle()
    return (data?.value ?? '').trim()
  } catch {
    return ''
  }
}

/** 網站標題：「(學校名稱)教師系統」，未設定學校名稱時為「教師系統」 */
export async function getSiteTitle(): Promise<string> {
  return `${await getSchoolName()}教師系統`
}
