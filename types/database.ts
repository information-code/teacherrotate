export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface ExperienceItem {
  year: string
  detail: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; name: string | null; email: string; phone: string | null
          line_id: string | null; university: string | null; graduate_school: string | null
          credit_class: string | null; other_education: string | null
          local_language: boolean | null; local_language_grade: string | null
          four_language: boolean | null; four_language_grade: string | null
          sea_language: boolean | null; sea_language_grade: string | null
          sign_language: boolean | null; sign_language_grade: string | null
          local_language_qualifications: boolean | null
          english_specialty: boolean | null; english_specialty_20: boolean | null
          english_specialty_cef: boolean | null; guidance_specialty_qua: boolean | null
          guidance_specialty_graduate: boolean | null; guidance_specialty: boolean | null
          english_specialty_grade: string | null; bilingual_specialty: boolean | null
          nature_specialty: boolean | null; tech_specialty: boolean | null
          life_specialty: boolean | null; other_checkbox: string | null
          other_language_text: string | null; study_experience: string | null
          research_publication: string | null; effective_teaching: string | null
          public_lesson: string | null; class_management: string | null
          professional_community: string | null; public_lecture: string | null
          other: string | null; special_class_management: string | null
          competition_guidance: string | null; experience: Json; role: string
          status: string; created_at: string; updated_at: string
        }
        Insert: {
          id: string; email: string; name?: string | null; phone?: string | null
          line_id?: string | null; university?: string | null; graduate_school?: string | null
          credit_class?: string | null; other_education?: string | null
          local_language?: boolean | null; local_language_grade?: string | null
          four_language?: boolean | null; four_language_grade?: string | null
          sea_language?: boolean | null; sea_language_grade?: string | null
          sign_language?: boolean | null; sign_language_grade?: string | null
          local_language_qualifications?: boolean | null
          english_specialty?: boolean | null; english_specialty_20?: boolean | null
          english_specialty_cef?: boolean | null; guidance_specialty_qua?: boolean | null
          guidance_specialty_graduate?: boolean | null; guidance_specialty?: boolean | null
          english_specialty_grade?: string | null; bilingual_specialty?: boolean | null
          nature_specialty?: boolean | null; tech_specialty?: boolean | null
          life_specialty?: boolean | null; other_checkbox?: string | null
          other_language_text?: string | null; study_experience?: string | null
          research_publication?: string | null; effective_teaching?: string | null
          public_lesson?: string | null; class_management?: string | null
          professional_community?: string | null; public_lecture?: string | null
          other?: string | null; special_class_management?: string | null
          competition_guidance?: string | null; experience?: Json; role?: string
          status?: string; created_at?: string; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      preferences: {
        Row: {
          id: string; teacher_id: string
          preference1: string | null; preference2: string | null; preference3: string | null
          updated_at: string
        }
        Insert: {
          id?: string; teacher_id: string
          preference1?: string | null; preference2?: string | null; preference3?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['preferences']['Insert']>
        Relationships: []
      }
      rotations: {
        Row: {
          id: string; teacher_id: string; year: number; work: string
          semester: string; created_at: string; updated_at: string
        }
        Insert: {
          id?: string; teacher_id: string; year: number; work: string
          semester?: string; created_at?: string; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['rotations']['Insert']>
        Relationships: []
      }
      scores: {
        Row: {
          id: string; teacher_id: string; year: number; score: number
          recent_four_year_total: number | null; created_at: string; updated_at: string
        }
        Insert: {
          id?: string; teacher_id: string; year: number; score: number
          recent_four_year_total?: number | null; created_at?: string; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['scores']['Insert']>
        Relationships: []
      }
      scoremap: {
        Row: {
          id: string; work: string
          year1: number; year2: number; year3: number; year4: number
          year5: number; year6: number; year7: number; year8: number
          group_name: string | null; sort_order: number; updated_at: string
        }
        Insert: {
          id?: string; work: string
          year1: number; year2: number; year3: number; year4: number
          year5: number; year6: number; year7: number; year8: number
          group_name?: string | null; sort_order?: number; updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['scoremap']['Insert']>
        Relationships: []
      }
      settings: {
        Row: { key: string; value: string; updated_at: string }
        Insert: { key: string; value: string; updated_at?: string }
        Update: Partial<Database['public']['Tables']['settings']['Insert']>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

// 型別別名
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Preference = Database['public']['Tables']['preferences']['Row']
export type Rotation = Database['public']['Tables']['rotations']['Row']
export type Score = Database['public']['Tables']['scores']['Row']
export type Scoremap = Database['public']['Tables']['scoremap']['Row']
export type Setting = Database['public']['Tables']['settings']['Row']
