import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('preferences')
    .select('preference1, preference2, preference3')
    .eq('teacher_id', user.id)
    .single()

  return NextResponse.json(data ?? { preference1: null, preference2: null, preference3: null })
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { preference1, preference2, preference3 } = await request.json()

  const { data, error } = await supabase
    .from('preferences')
    .upsert({
      teacher_id: user.id,
      preference1,
      preference2,
      preference3,
    }, { onConflict: 'teacher_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
