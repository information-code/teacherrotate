'use client'

import { useState } from 'react'
import type { Profile, ExperienceItem } from '@/types/database'

type SpecialtyKey = keyof Pick<Profile,
  'local_language' | 'four_language' | 'sea_language' | 'sign_language' |
  'local_language_qualifications' | 'english_specialty' | 'english_specialty_20' |
  'english_specialty_cef' | 'guidance_specialty_qua' | 'guidance_specialty_graduate' |
  'guidance_specialty' | 'bilingual_specialty' | 'nature_specialty' |
  'tech_specialty' | 'life_specialty'
>

const SPECIALTY_GROUPS: { group: string; tags: { key: SpecialtyKey; label: string }[] }[] = [
  {
    group: '本土語',
    tags: [
      { key: 'local_language',                label: '閩南語' },
      { key: 'four_language',                 label: '客語四線' },
      { key: 'sea_language',                  label: '客語海線' },
      { key: 'sign_language',                 label: '手語' },
      { key: 'local_language_qualifications', label: '教支資格' },
    ],
  },
  {
    group: '英語',
    tags: [
      { key: 'english_specialty',    label: '英語專長' },
      { key: 'english_specialty_20', label: '20學分班' },
      { key: 'english_specialty_cef', label: 'CEF B2' },
    ],
  },
  {
    group: '輔導',
    tags: [
      { key: 'guidance_specialty_qua',      label: '專輔資格' },
      { key: 'guidance_specialty_graduate', label: '輔導相關系所' },
      { key: 'guidance_specialty',          label: '輔導專長' },
    ],
  },
  {
    group: '特殊專長',
    tags: [
      { key: 'bilingual_specialty', label: '雙語' },
      { key: 'nature_specialty',    label: '自然' },
      { key: 'tech_specialty',      label: '資訊' },
      { key: 'life_specialty',      label: '生活研習' },
    ],
  },
]

interface Props {
  profiles: Profile[]
}

export default function TeachersClient({ profiles }: Props) {
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<SpecialtyKey | null>(null)
  const [selected, setSelected] = useState<Profile | null>(null)
  const [localProfiles, setLocalProfiles] = useState<Profile[]>(profiles)

  const filtered = localProfiles
    .filter(p => {
      const q = query.trim().toLowerCase()
      const matchText = !q || (p.name ?? '').includes(q) || p.email.toLowerCase().includes(q)
      const matchTag = !activeTag || p[activeTag] === true
      return matchText && matchTag
    })
    .sort((a, b) => {
      if (a.status === b.status) return 0
      return a.status === 'inactive' ? 1 : -1
    })

  async function toggleStatus(profile: Profile) {
    const newStatus = profile.status === 'active' ? 'inactive' : 'active'
    const res = await fetch('/api/admin/teacher-status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher_id: profile.id, status: newStatus }),
    })
    if (!res.ok) return
    const updated = { ...profile, status: newStatus }
    setLocalProfiles(prev => prev.map(p => p.id === profile.id ? updated : p))
    setSelected(updated)
  }

  return (
    <div className="flex h-full -m-6 overflow-hidden">
      {/* 左側：搜尋 + 名單 */}
      <div className="w-72 flex-shrink-0 border-r border-zinc-200 flex flex-col bg-white print:hidden">
        {/* 搜尋 */}
        <div className="px-3 pt-3 pb-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋姓名或信箱..."
            className="input"
          />
        </div>
        {/* 專長篩選（分組） */}
        <div className="px-3 pb-3 border-b border-zinc-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">專長篩選</span>
            {activeTag && (
              <button onClick={() => setActiveTag(null)} className="text-xs text-zinc-400 hover:text-zinc-700">
                清除
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {SPECIALTY_GROUPS.map(({ group, tags }) => (
              <div key={group} className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-400 w-12 flex-shrink-0">{group}</span>
                <div className="flex flex-wrap gap-1">
                  {tags.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTag(activeTag === key ? null : key)}
                      className={`text-xs px-1.5 py-0.5 border transition-colors ${
                        activeTag === key
                          ? 'bg-zinc-800 text-white border-zinc-800'
                          : 'text-zinc-500 border-zinc-200 hover:border-zinc-400 hover:text-zinc-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-zinc-400 p-4">無符合結果</p>
          )}
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className={`w-full text-left px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                selected?.id === p.id ? 'bg-zinc-100' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-zinc-900 text-sm">{p.name ?? '（未填姓名）'}</span>
                {p.status === 'inactive' && (
                  <span className="text-xs px-1 border border-red-300 text-red-400">離校</span>
                )}
              </div>
              <div className="text-xs text-zinc-400 truncate">{p.email}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-zinc-100 text-xs text-zinc-400 text-center">
          共 {profiles.length} 位教師
        </div>
      </div>

      {/* 右側：履歷 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex items-center justify-center h-64 text-zinc-400 text-sm">
            請從左側選擇教師以查看履歷
          </div>
        ) : (
          <TeacherResume profile={selected} onToggleStatus={() => toggleStatus(selected)} />
        )}
      </div>
    </div>
  )
}

function TeacherResume({ profile, onToggleStatus }: { profile: Profile; onToggleStatus: () => void }) {
  const experiences = (
    Array.isArray(profile.experience) ? profile.experience : []
  ) as unknown as ExperienceItem[]

  const languages = [
    profile.local_language && `閩南語${profile.local_language_grade ? `（${profile.local_language_grade}）` : ''}`,
    profile.four_language && `客語（四線）${profile.four_language_grade ? `（${profile.four_language_grade}）` : ''}`,
    profile.sea_language && `客語（海線）${profile.sea_language_grade ? `（${profile.sea_language_grade}）` : ''}`,
    profile.sign_language && `手語${profile.sign_language_grade ? `（${profile.sign_language_grade}）` : ''}`,
  ].filter(Boolean) as string[]

  const specialties = [
    profile.local_language_qualifications && '本土語教支資格',
    profile.english_specialty && '教師證加註英語專長',
    profile.english_specialty_20 && '英語 20 學分班',
    profile.english_specialty_cef && 'CEF B2 級以上英語加註專長',
    profile.guidance_specialty_qua && '具專輔資格',
    profile.guidance_specialty_graduate && '輔導／諮商／心理相關系所畢業',
    profile.guidance_specialty && '教師證加註輔導專長',
    profile.bilingual_specialty && '教師證加註雙語專長',
    profile.nature_specialty && '教師證加註自然專長',
    profile.tech_specialty && '教師證加註資訊專長',
    profile.life_specialty && '生活課程 12 小時以上研習',
  ].filter(Boolean) as string[]

  const textFields = [
    { label: '進修研習', value: profile.study_experience },
    { label: '研究發表', value: profile.research_publication },
    { label: '有效教學', value: profile.effective_teaching },
    { label: '公開課', value: profile.public_lesson },
    { label: '班級管理', value: profile.class_management },
    { label: '專業社群', value: profile.professional_community },
    { label: '公開講座', value: profile.public_lecture },
    { label: '特殊班級經營', value: profile.special_class_management },
    { label: '競賽指導', value: profile.competition_guidance },
    { label: '其他', value: profile.other },
  ].filter(f => f.value)

  const hasEducation = profile.university || profile.graduate_school || profile.credit_class || profile.other_education
  const hasLanguage = languages.length > 0 || profile.other_language_text || profile.english_specialty_grade
  const hasSpecialty = specialties.length > 0 || profile.other_checkbox

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <h2 className="page-title mb-0">個人履歷</h2>
          {profile.status === 'inactive' && (
            <span className="text-xs px-2 py-0.5 border border-red-300 text-red-500">離校</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleStatus}
            className={profile.status === 'inactive' ? 'btn-secondary' : 'btn-danger'}
          >
            {profile.status === 'inactive' ? '設為在校' : '設為已離校'}
          </button>
          <button onClick={() => window.print()} className="btn-secondary">
            列印 / 匯出 PDF
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {/* 基本資訊 */}
        <div className="card">
          <h1 className="text-xl font-semibold text-zinc-900 mb-1">
            {profile.name ?? '（未填姓名）'}
          </h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-500 mt-2">
            <span>{profile.email}</span>
            {profile.phone && <span>電話：{profile.phone}</span>}
            {profile.line_id && <span>Line：{profile.line_id}</span>}
          </div>
        </div>

        {/* 學歷 */}
        {hasEducation && (
          <div className="card">
            <h3 className="resume-section-title">學歷</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {profile.university && (
                <div><span className="text-zinc-500">大學：</span>{profile.university}</div>
              )}
              {profile.graduate_school && (
                <div><span className="text-zinc-500">研究所：</span>{profile.graduate_school}</div>
              )}
              {profile.credit_class && (
                <div><span className="text-zinc-500">學分班：</span>{profile.credit_class}</div>
              )}
              {profile.other_education && (
                <div className="col-span-2"><span className="text-zinc-500">其他：</span>{profile.other_education}</div>
              )}
            </div>
          </div>
        )}

        {/* 語言專長 */}
        {hasLanguage && (
          <div className="card">
            <h3 className="resume-section-title">語言專長</h3>
            <div className="flex flex-wrap gap-2">
              {languages.map(l => (
                <span key={l} className="badge badge-default">{l}</span>
              ))}
              {profile.other_language_text && (
                <span className="badge badge-default">{profile.other_language_text}</span>
              )}
              {profile.english_specialty_grade && (
                <span className="badge badge-default">雙語增能學分班 {profile.english_specialty_grade}</span>
              )}
            </div>
          </div>
        )}

        {/* 教學專長與資格 */}
        {hasSpecialty && (
          <div className="card">
            <h3 className="resume-section-title">教學專長與資格</h3>
            <div className="flex flex-wrap gap-2">
              {specialties.map(s => (
                <span key={s} className="badge badge-success">{s}</span>
              ))}
              {profile.other_checkbox && (
                <span className="badge badge-default">{profile.other_checkbox}</span>
              )}
            </div>
          </div>
        )}

        {/* 自我描述 */}
        {textFields.length > 0 && (
          <div className="card">
            <h3 className="resume-section-title">自我描述</h3>
            <div className="space-y-4">
              {textFields.map(({ label, value }) => (
                <div key={label}>
                  <div className="text-xs font-medium text-zinc-500 mb-1">{label}</div>
                  <div className="text-sm text-zinc-800 whitespace-pre-wrap">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 服務經歷 */}
        {experiences.length > 0 && (
          <div className="card">
            <h3 className="resume-section-title">服務經歷</h3>
            <div className="space-y-2">
              {experiences.map((exp, i) => (
                <div key={i} className="flex gap-6 text-sm">
                  <span className="text-zinc-500 flex-shrink-0 w-16">{exp.year} 年度</span>
                  <span className="text-zinc-800">{exp.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
