// 超鐘簽到：從已發布課表組出「每位老師的週課務」，供管理端點選減課時段
// （不用手填星期／節次／班級／領域）。來源比照教師課表頁：
//  科任課（placed，含單雙週與外師協同）＋導師課（導師填的科目＋導師自上鎖課格）
//  ＋閩南語配班原班＋本土語語別場次。
import { classLabel, subjectClassKey, HOMEROOM_SELF, type ScheduleConfig, type DerivedNativeSession } from './scheduling'
import { GRADE_LABEL } from './allocation'
import type { PlacedResult } from './schedule-engine'

export interface TeacherCourse {
  weekday: number      // 1-5
  period: number       // 1-7
  class_name: string
  domain: string
}

export function buildTeacherCourses(args: {
  placed: PlacedResult[]
  config: ScheduleConfig
  homeroomCells: Record<string, Record<string, string>>   // classKey → slot → 導師填的科目
  homeroomLocks: Record<string, string[]>                 // classKey → 導師自上的鎖課格
  nativeSessions: DerivedNativeSession[]
}): Record<string, TeacherCourse[]> {
  const { placed, config, homeroomCells, homeroomLocks, nativeSessions } = args
  const out: Record<string, TeacherCourse[]> = {}
  const put = (tid: string, c: TeacherCourse) => {
    if (!tid) return
    const list = (out[tid] ??= [])
    if (list.some(x => x.weekday === c.weekday && x.period === c.period)) return
    list.push(c)
  }
  const parseSlot = (slot: string): [number, number] => {
    const [d, q] = slot.split('-').map(Number)
    return [d, q]
  }
  const lockTypeMap = Object.fromEntries(config.lockTypes.map(t => [t.id, t]))

  // 科任課（含外師協同）；單雙週佔配對格的自己那一格
  for (const p of placed) {
    const wk = p.parity === 'weekly' ? '' : p.parity === 'odd' ? '（單週）' : '（雙週）'
    const periods = p.parity !== 'weekly'
      ? [p.parity === 'odd' ? p.period : p.period + 1]
      : p.size === 2 ? [p.period, p.period + 1] : [p.period]
    for (const q of periods) {
      put(p.teacherId, { weekday: p.day, period: q, class_name: p.classLabel, domain: `${p.subject}${wk}` })
      if (p.coTeacherId) {
        put(p.coTeacherId, { weekday: p.day, period: q, class_name: p.classLabel, domain: `${p.subject}${wk}（協同）` })
      }
    }
  }

  // 導師課：導師填的科目＋導師自上的鎖課格
  for (const [ck, tid] of Object.entries(config.classTeacher)) {
    if (!tid) continue
    const [g, i] = ck.split('-').map(Number)
    const label = classLabel(g, i)
    for (const [slot, subj] of Object.entries(homeroomCells[ck] ?? {})) {
      const [d, q] = parseSlot(slot)
      put(tid, { weekday: d, period: q, class_name: label, domain: subj })
    }
    for (const slot of homeroomLocks[ck] ?? []) {
      const [d, q] = parseSlot(slot)
      const t = lockTypeMap[config.lockCells[ck]?.[slot] ?? '']
      put(tid, { weekday: d, period: q, class_name: label, domain: t?.subject || t?.label || '鎖課' })
    }
  }

  // 閩南語配班：原班本土語鎖課格
  const nativeTypeIds = new Set(config.lockTypes.filter(t => t.isNative).map(t => t.id))
  for (const [ck, cells] of Object.entries(config.lockCells)) {
    const [g, i] = ck.split('-').map(Number)
    const tid = config.subjectClassTeacher[subjectClassKey(g, i, '本土語')] ?? ''
    if (!tid || tid === HOMEROOM_SELF) continue
    for (const [slot, ltid] of Object.entries(cells)) {
      if (!nativeTypeIds.has(ltid)) continue
      const [d, q] = parseSlot(slot)
      put(tid, { weekday: d, period: q, class_name: classLabel(g, i), domain: '本土語' })
    }
  }

  // 本土語語別場次（實體／線上）
  for (const sn of nativeSessions) {
    if (sn.state === 'cancelled' || !sn.teacherId) continue
    const [d, q] = parseSlot(sn.slot)
    put(sn.teacherId, {
      weekday: d, period: q,
      class_name: GRADE_LABEL[sn.grade] ?? `${sn.grade}年級`,
      domain: `本土語（${sn.lang}）`,
    })
  }

  for (const list of Object.values(out)) list.sort((a, b) => a.weekday - b.weekday || a.period - b.period)
  return out
}
