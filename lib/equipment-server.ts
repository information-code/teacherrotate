import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizeEquipmentConfig, type ChecklistItem, type ChecklistResult, type EquipmentConfig } from '@/lib/equipment'

export const EQUIPMENT_PHOTO_BUCKET = 'equipment-photos'

export async function checkAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single()
  return data?.role === 'admin' || data?.role === 'superadmin'
}

export async function loadEquipmentConfig(): Promise<EquipmentConfig> {
  const { data } = await supabaseAdmin.from('equipment_config').select('config').eq('id', 1).maybeSingle()
  return normalizeEquipmentConfig(data?.config)
}

/** 產生照片簽名網址（私有 bucket），回傳 path → url 對照表 */
export async function signPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths)).filter(Boolean)
  if (unique.length === 0) return {}
  const { data } = await supabaseAdmin.storage
    .from(EQUIPMENT_PHOTO_BUCKET)
    .createSignedUrls(unique, 60 * 60)
  const map: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.signedUrl && item.path) map[item.path] = item.signedUrl
  }
  return map
}

/**
 * 寫入借用操作日誌（一個操作一條）。設備與人名以快照存文字。
 * 日誌寫入失敗不影響主流程。
 */
export async function logLoanEvent(opts: {
  loanId: string
  equipmentId: string
  teacherId: string
  action: 'reserved' | 'borrowed' | 'returned' | 'cancelled' | 'released' | 'closed'
  detail: string
  actorId?: string
}): Promise<void> {
  try {
    const [equipRes, teacherRes, actorRes] = await Promise.all([
      supabaseAdmin.from('equipment').select('name, asset_number').eq('id', opts.equipmentId).maybeSingle(),
      supabaseAdmin.from('profiles').select('name, email').eq('id', opts.teacherId).maybeSingle(),
      opts.actorId && opts.actorId !== opts.teacherId
        ? supabaseAdmin.from('profiles').select('name, email').eq('id', opts.actorId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const teacherName = teacherRes.data?.name ?? teacherRes.data?.email ?? ''
    await supabaseAdmin.from('equipment_loan_events').insert({
      loan_id: opts.loanId,
      equipment_id: opts.equipmentId,
      equipment_name: equipRes.data?.name ?? '（已刪除設備）',
      asset_number: equipRes.data?.asset_number ?? '',
      teacher_id: opts.teacherId,
      teacher_name: teacherName,
      action: opts.action,
      detail: opts.detail,
      actor_name: actorRes.data ? (actorRes.data.name ?? actorRes.data.email ?? '') : teacherName,
    })
  } catch {
    // 日誌失敗不影響借用主流程
  }
}

/** 從檢查結果快照收集所有照片 path */
export function collectChecklistPhotos(checklist: unknown): string[] {
  if (!Array.isArray(checklist)) return []
  return checklist.flatMap(item =>
    Array.isArray((item as ChecklistResult)?.photos) ? (item as ChecklistResult).photos : []
  )
}

/**
 * 驗證教師送出的檢查結果是否符合設備定義：
 * 項目一一對應、全部勾選、需拍照項目至少 1 張（至多 maxPhotos 張）。
 * 通過回傳正規化後的快照，不通過回傳錯誤訊息。
 */
export function validateChecklistResult(
  definition: ChecklistItem[],
  submitted: unknown,
  maxPhotos: number
): { ok: true; result: ChecklistResult[] } | { ok: false; error: string } {
  const list = Array.isArray(submitted) ? (submitted as ChecklistResult[]) : []
  if (list.length !== definition.length) return { ok: false, error: '檢查項目與設備定義不符，請重新整理後再試。' }

  const result: ChecklistResult[] = []
  for (let i = 0; i < definition.length; i++) {
    const def = definition[i]
    const sub = list[i]
    if (!sub || sub.label !== def.label) return { ok: false, error: '檢查項目與設備定義不符，請重新整理後再試。' }
    if (!sub.checked) return { ok: false, error: `「${def.label}」尚未完成勾選。` }
    const photos = Array.isArray(sub.photos) ? sub.photos.filter(p => typeof p === 'string') : []
    if (def.requiresPhoto && photos.length === 0) return { ok: false, error: `「${def.label}」需要拍照上傳。` }
    if (photos.length > maxPhotos) return { ok: false, error: `「${def.label}」照片最多 ${maxPhotos} 張。` }
    result.push({ label: def.label, requiresPhoto: def.requiresPhoto, checked: true, photos })
  }
  return { ok: true, result }
}
