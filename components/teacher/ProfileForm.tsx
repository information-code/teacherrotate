'use client'

import { useEffect, useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import type { Profile, ExperienceItem } from '@/types/database'

type FormValues = Omit<Profile, 'id' | 'email' | 'role' | 'created_at' | 'updated_at'>

interface ProfileFormProps {
  profile: Profile
}

// 語言欄位群組
const languageFields = [
  { key: 'local_language' as const,  gradeKey: 'local_language_grade' as const,  label: '閩南語' },
  { key: 'four_language' as const,   gradeKey: 'four_language_grade' as const,   label: '客語（四線）' },
  { key: 'sea_language' as const,    gradeKey: 'sea_language_grade' as const,    label: '客語（海線）' },
  { key: 'sign_language' as const,   gradeKey: 'sign_language_grade' as const,   label: '手語' },
]

// 布林欄位（單一勾選）
const booleanFields: { key: keyof FormValues; label: string }[] = [
  { key: 'local_language_qualifications', label: '本土語教支資格' },
  { key: 'english_specialty',             label: '教師證加註英語專長' },
  { key: 'english_specialty_20',          label: '英語20學分班' },
  { key: 'english_specialty_cef',         label: 'CEF 架構 B2（高階）級以上國小英語加註專長' },
  { key: 'guidance_specialty_qua',        label: '具專輔資格' },
  { key: 'guidance_specialty_graduate',   label: '輔導、諮商、心理相關系所畢業' },
  { key: 'guidance_specialty',            label: '教師證加註輔導專長' },
  { key: 'bilingual_specialty',           label: '教師證加註雙語專長' },
  { key: 'nature_specialty',              label: '教師證加註自然專長' },
  { key: 'tech_specialty',               label: '教師證加註資訊專長' },
  { key: 'life_specialty',               label: '生活課程 12 小時以上研習' },
]

// 文字欄位（長文）
const textareaFields: { key: keyof FormValues; label: string }[] = [
  { key: 'study_experience',        label: '進修研習' },
  { key: 'research_publication',    label: '研究發表' },
  { key: 'effective_teaching',      label: '有效教學' },
  { key: 'public_lesson',           label: '公開課' },
  { key: 'class_management',        label: '班級管理' },
  { key: 'professional_community',  label: '專業社群' },
  { key: 'public_lecture',          label: '公開講座' },
  { key: 'special_class_management', label: '特殊班級經營' },
  { key: 'competition_guidance',    label: '競賽指導' },
  { key: 'other',                   label: '其他' },
]

export function ProfileForm({ profile }: ProfileFormProps) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialExperience: ExperienceItem[] = Array.isArray(profile.experience)
    ? (profile.experience as unknown[]).map((e) => {
        const item = e as Record<string, string>
        return { year: item.year ?? '', detail: item.detail ?? '' }
      })
    : []

  // useForm without explicit generic to avoid TS deep instantiation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, handleSubmit, control, reset, watch, setValue, formState: { isDirty, errors } } = useForm<any>({
    defaultValues: {
      name: profile.name ?? '',
      phone: profile.phone ?? '',
      line_id: profile.line_id ?? '',
      university: profile.university ?? '',
      graduate_school: profile.graduate_school ?? '',
      credit_class: profile.credit_class ?? '',
      other_education: profile.other_education ?? '',
      // 若 grade 欄位已有資料，則自動勾選對應 checkbox
      local_language: profile.local_language || !!profile.local_language_grade,
      local_language_grade: profile.local_language_grade ?? '',
      four_language: profile.four_language || !!profile.four_language_grade,
      four_language_grade: profile.four_language_grade ?? '',
      sea_language: profile.sea_language || !!profile.sea_language_grade,
      sea_language_grade: profile.sea_language_grade ?? '',
      sign_language: profile.sign_language || !!profile.sign_language_grade,
      sign_language_grade: profile.sign_language_grade ?? '',
      local_language_qualifications: profile.local_language_qualifications ?? false,
      english_specialty: profile.english_specialty ?? false,
      english_specialty_20: profile.english_specialty_20 ?? false,
      english_specialty_cef: profile.english_specialty_cef ?? false,
      guidance_specialty_qua: profile.guidance_specialty_qua ?? false,
      guidance_specialty_graduate: profile.guidance_specialty_graduate ?? false,
      guidance_specialty: profile.guidance_specialty ?? false,
      english_specialty_grade: profile.english_specialty_grade ?? '',
      bilingual_specialty: profile.bilingual_specialty ?? false,
      nature_specialty: profile.nature_specialty ?? false,
      tech_specialty: profile.tech_specialty ?? false,
      life_specialty: profile.life_specialty ?? false,
      other_checkbox: profile.other_checkbox ?? '',
      other_language_text: profile.other_language_text ?? '',
      study_experience: profile.study_experience ?? '',
      research_publication: profile.research_publication ?? '',
      effective_teaching: profile.effective_teaching ?? '',
      public_lesson: profile.public_lesson ?? '',
      class_management: profile.class_management ?? '',
      professional_community: profile.professional_community ?? '',
      public_lecture: profile.public_lecture ?? '',
      other: profile.other ?? '',
      special_class_management: profile.special_class_management ?? '',
      competition_guidance: profile.competition_guidance ?? '',
      experience: initialExperience,
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'experience' as never,
  })

  // 監聽語言 checkbox（觸發 re-render 讓 validate 拿到最新值）
  watch(['local_language', 'four_language', 'sea_language', 'sign_language'])
  const gradeValues = watch([
    'local_language_grade',
    'four_language_grade',
    'sea_language_grade',
    'sign_language_grade',
  ])
  useEffect(() => {
    const pairs: [string, string][] = [
      ['local_language_grade', 'local_language'],
      ['four_language_grade',  'four_language'],
      ['sea_language_grade',   'sea_language'],
      ['sign_language_grade',  'sign_language'],
    ]
    pairs.forEach(([gradeKey, boolKey]) => {
      const grade = watch(gradeKey)
      if (grade && grade.trim()) {
        setValue(boolKey, true, { shouldDirty: true })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeValues])

  // 離開頁面前提醒（關閉視窗 / 重新整理 / 頁內導航）
  useEffect(() => {
    if (!isDirty) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }

    // 在捕捉階段攔截 <a> 點擊，早於 Next.js Router 處理
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || href === window.location.pathname) return
      if (!window.confirm('您有未儲存的變更，確定要離開此頁面嗎？')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('click', handleClick, true)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleClick, true)
    }
  }, [isDirty])

  async function onSubmit(values: FormValues) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/teacher/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (!res.ok) throw new Error('儲存失敗')
      reset(values)  // 清除 dirty 狀態
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between mb-2">
        <h2 className="page-title mb-0">基本資料</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">已儲存</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>

      {/* 不可修改資訊 */}
      <div className="card">
        <p className="text-xs text-zinc-400 mb-3">以下資訊由 Google 帳號同步，無法修改</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">電子信箱</label>
            <input value={profile.email} disabled className="input bg-zinc-50 text-zinc-500" readOnly />
          </div>
          <div>
            <label className="label">身份</label>
            <input value={profile.role === 'superadmin' ? '超級管理員' : profile.role === 'admin' ? '管理員' : '教師'} disabled className="input bg-zinc-50 text-zinc-500" readOnly />
          </div>
        </div>
      </div>

      {/* 基本聯絡資訊 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">聯絡資訊</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">姓名</label>
            <input {...register('name')} className="input" placeholder="請輸入姓名" />
          </div>
          <div>
            <label className="label">電話</label>
            <input {...register('phone')} className="input" placeholder="09xx-xxx-xxx" />
          </div>
          <div>
            <label className="label">Line ID</label>
            <input {...register('line_id')} className="input" />
          </div>
        </div>
      </div>

      {/* 學歷 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">學歷</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">大學</label>
            <input {...register('university')} className="input" />
          </div>
          <div>
            <label className="label">研究所</label>
            <input {...register('graduate_school')} className="input" />
          </div>
          <div>
            <label className="label">學分班</label>
            <input {...register('credit_class')} className="input" />
          </div>
          <div>
            <label className="label">其他教育背景</label>
            <input {...register('other_education')} className="input" />
          </div>
        </div>
      </div>

      {/* 語言專長 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">語言專長</h3>
        <div className="space-y-3">
          {languageFields.map(({ key, gradeKey, label }) => {
            const isChecked = watch(key)
            const gradeError = errors[gradeKey]
            return (
              <div key={key} className="flex items-start gap-4">
                <label className="flex items-center gap-2 w-40 cursor-pointer mt-2">
                  <input type="checkbox" {...register(key as keyof FormValues)} className="w-4 h-4" />
                  <span className="text-sm text-zinc-700">{label}</span>
                </label>
                <div className="flex-1">
                  <input
                    {...register(gradeKey as keyof FormValues, {
                      validate: (v: string) => !isChecked || !!v?.trim() || '已勾選時必須填寫級數',
                    })}
                    className={`input ${gradeError ? 'border-red-400 focus:border-red-500' : ''}`}
                    placeholder="級數（如：中高級）"
                  />
                  {gradeError && (
                    <p className="text-xs text-red-500 mt-1">{gradeError.message as string}</p>
                  )}
                </div>
              </div>
            )
          })}
          <div>
            <label className="label">其他本土語</label>
            <input {...register('other_language_text')} className="input" placeholder="如有請填寫" />
          </div>
          <div>
            <label className="label">中小學雙語教學在職教師增能學分班（CEF 等級）</label>
            <input {...register('english_specialty_grade')} className="input" placeholder="如：B2" />
          </div>
        </div>
      </div>

      {/* 教學專長（布林欄位） */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">教學專長與資格</h3>
        <div className="grid grid-cols-1 gap-2">
          {booleanFields.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...register(key as keyof FormValues)} className="w-4 h-4" />
              <span className="text-sm text-zinc-700">{label}</span>
            </label>
          ))}
          <div className="mt-2">
            <label className="label">其他（請說明）</label>
            <input {...register('other_checkbox')} className="input" />
          </div>
        </div>
      </div>

      {/* 經歷敘述 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-zinc-700 mb-4">自我描述</h3>
        <div className="space-y-4">
          {textareaFields.map(({ key, label }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <textarea
                {...register(key as keyof FormValues)}
                className="input min-h-[72px] resize-y"
                placeholder="（選填）"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 服務經歷 */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-700">服務經歷</h3>
          <button
            type="button"
            className="btn-secondary text-xs py-1 px-3"
            onClick={() => append({ year: '', detail: '' } as ExperienceItem)}
          >
            + 新增
          </button>
        </div>
        {fields.length === 0 && (
          <p className="text-sm text-zinc-400">尚無服務經歷，點擊右上角「新增」以添加</p>
        )}
        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-3">
              <input
                {...register(`experience.${index}.year` as never)}
                className="input w-28 flex-shrink-0"
                placeholder="民國年（如 111）"
              />
              <input
                {...register(`experience.${index}.detail` as never)}
                className="input flex-1"
                placeholder="經歷說明"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                className="btn-danger text-xs py-1 px-3 flex-shrink-0"
              >
                刪除
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pb-6">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? '儲存中...' : '儲存所有變更'}
        </button>
      </div>
    </form>
  )
}
