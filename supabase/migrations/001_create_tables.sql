-- ============================================================
-- 001: 建立資料表
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- profiles: 教師基本資料
-- ============================================================
CREATE TABLE public.profiles (
  id                            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                          TEXT,
  email                         TEXT NOT NULL,
  phone                         TEXT,
  line_id                       TEXT,
  university                    TEXT,
  graduate_school               TEXT,
  credit_class                  TEXT,
  other_education               TEXT,
  -- 語言專長
  local_language                BOOLEAN DEFAULT FALSE,
  local_language_grade          TEXT,
  four_language                 BOOLEAN DEFAULT FALSE,
  four_language_grade           TEXT,
  sea_language                  BOOLEAN DEFAULT FALSE,
  sea_language_grade            TEXT,
  sign_language                 BOOLEAN DEFAULT FALSE,
  sign_language_grade           TEXT,
  local_language_qualifications BOOLEAN DEFAULT FALSE,
  -- 英語相關
  english_specialty             BOOLEAN DEFAULT FALSE,
  english_specialty_20          BOOLEAN DEFAULT FALSE,
  english_specialty_cef         BOOLEAN DEFAULT FALSE,
  -- 輔導相關
  guidance_specialty_qua        BOOLEAN DEFAULT FALSE,
  guidance_specialty_graduate   BOOLEAN DEFAULT FALSE,
  guidance_specialty            BOOLEAN DEFAULT FALSE,
  -- 雙語相關
  english_specialty_grade       TEXT,
  bilingual_specialty           BOOLEAN DEFAULT FALSE,
  -- 其他領域
  nature_specialty              BOOLEAN DEFAULT FALSE,
  tech_specialty                BOOLEAN DEFAULT FALSE,
  life_specialty                BOOLEAN DEFAULT FALSE,
  -- 其他
  other_checkbox                TEXT,
  other_language_text           TEXT,
  -- 經歷文字
  study_experience              TEXT,
  research_publication          TEXT,
  effective_teaching            TEXT,
  public_lesson                 TEXT,
  class_management              TEXT,
  professional_community        TEXT,
  public_lecture                TEXT,
  other                         TEXT,
  special_class_management      TEXT,
  competition_guidance          TEXT,
  -- 服務經歷（動態陣列 [{year, detail}]）
  experience                    JSONB DEFAULT '[]'::jsonb,
  -- 角色
  role                          TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- preferences: 工作志願（每位教師一筆）
-- ============================================================
CREATE TABLE public.preferences (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  preference1  TEXT,
  preference2  TEXT,
  preference3  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id)
);

-- ============================================================
-- rotations: 歷年輪動紀錄（動態年度）
-- ============================================================
CREATE TABLE public.rotations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,   -- 民國年 106~114...
  work        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, year)
);

CREATE INDEX idx_rotations_teacher_id ON public.rotations(teacher_id);
CREATE INDEX idx_rotations_year ON public.rotations(year);

-- ============================================================
-- scores: 歷年分數（由系統計算後寫入）
-- ============================================================
CREATE TABLE public.scores (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year                    INTEGER NOT NULL,
  score                   NUMERIC(5,2) NOT NULL DEFAULT 0,
  recent_four_year_total  NUMERIC(8,2),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, year)
);

CREATE INDEX idx_scores_teacher_id ON public.scores(teacher_id);
CREATE INDEX idx_scores_year ON public.scores(year);

-- ============================================================
-- scoremap: 分數對照表
-- ============================================================
CREATE TABLE public.scoremap (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work       TEXT NOT NULL UNIQUE,
  year1      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year2      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year3      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year4      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year5      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year6      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year7      NUMERIC(5,2) NOT NULL DEFAULT 0,
  year8      NUMERIC(5,2) NOT NULL DEFAULT 0,
  group_name TEXT,   -- 相同 group_name 視為連續年資同一組
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Triggers: 自動更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER preferences_updated_at
  BEFORE UPDATE ON public.preferences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER rotations_updated_at
  BEFORE UPDATE ON public.rotations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER scores_updated_at
  BEFORE UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER scoremap_updated_at
  BEFORE UPDATE ON public.scoremap
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- Trigger: 新用戶登入後自動建立 profile
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
