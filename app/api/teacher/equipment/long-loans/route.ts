import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadEquipmentConfig } from '@/lib/equipment-server'
import { addDays, todayStr } from '@/lib/equipment'

/** 我的長期借用（唯讀＋續借回傳）。回傳 { config 摘要, loans（含設備資訊與續借紀錄） } */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = await loadEquipmentConfig()
  const today = todayStr()

  const { data: loans, error } = await supabaseAdmin
    .from('equipment_long_loans').select('*')
    .eq('teacher_id', user.id)
    .order('status').order('due_date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (loans ?? []).map(l => l.id)
  const equipIds = Array.from(new Set((loans ?? []).map(l => l.equipment_id)))
  const [{ data: renewals }, { data: equipment }] = await Promise.all([
    ids.length > 0
      ? supabaseAdmin.from('equipment_renewals').select('*').in('long_loan_id', ids).order('agreed_at', { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    equipIds.length > 0
      ? supabaseAdmin.from('equipment').select('id, name, location, peripherals').in('id', equipIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const equipMap = new Map((equipment ?? []).map(e => [e.id, e]))
  const rows = (loans ?? []).map(l => {
    const equip = equipMap.get(l.equipment_id)
    const renewable = l.status === 'active' && today >= addDays(l.due_date, -config.renewalNoticeDays)
    return {
      ...l,
      equipment_name: equip?.name ?? '（已刪除設備）',
      equipment_location: equip?.location ?? '',
      peripherals: equip?.peripherals ?? [],
      renewals: (renewals ?? []).filter(r => r.long_loan_id === l.id),
      renewable,
      overdue: l.status === 'active' && l.due_date < today,
    }
  })

  return NextResponse.json({
    config: {
      renewalWeeks: config.renewalWeeks,
      renewalNoticeDays: config.renewalNoticeDays,
      maxPhotos: config.maxPhotos,
      agreements: { longterm: config.agreements.longterm, renewal: config.agreements.renewal },
    },
    today,
    loans: rows,
  })
}

/** 續借回傳：拍照＋同意 → 自動展期。body: { id, photos: string[], agree: true } */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, photos, agree } = await request.json()
  if (!id) return NextResponse.json({ error: '缺少紀錄 id' }, { status: 400 })
  if (!agree) return NextResponse.json({ error: '請先閱讀並勾選同意繼續借用' }, { status: 400 })

  const config = await loadEquipmentConfig()
  const photoList = Array.isArray(photos) ? photos.filter(p => typeof p === 'string') : []
  if (photoList.length === 0) return NextResponse.json({ error: '請至少上傳 1 張設備現況照片' }, { status: 400 })
  if (photoList.length > config.maxPhotos) {
    return NextResponse.json({ error: `照片最多 ${config.maxPhotos} 張` }, { status: 400 })
  }

  const { data: loan } = await supabaseAdmin
    .from('equipment_long_loans').select('*').eq('id', id).maybeSingle()
  if (!loan || loan.teacher_id !== user.id) return NextResponse.json({ error: '找不到長期借用紀錄' }, { status: 404 })
  if (loan.status !== 'active') return NextResponse.json({ error: '此長期借用已結束' }, { status: 400 })

  const today = todayStr()
  if (today < addDays(loan.due_date, -config.renewalNoticeDays)) {
    return NextResponse.json({ error: `尚未到續借回傳期間（到期前 ${config.renewalNoticeDays} 天開放）` }, { status: 400 })
  }

  // 展期基準：已逾期則從今天起算，未逾期則銜接原到期日
  const base = loan.due_date > today ? loan.due_date : today
  const newDue = addDays(base, config.renewalWeeks * 7)

  const { error } = await supabaseAdmin.from('equipment_renewals').insert({
    long_loan_id: id,
    photos: photoList as never,
    old_due_date: loan.due_date,
    new_due_date: newDue,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { error: updateError } = await supabaseAdmin.from('equipment_long_loans')
    .update({ due_date: newDue, updated_at: new Date().toISOString() }).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true, new_due_date: newDue })
}
