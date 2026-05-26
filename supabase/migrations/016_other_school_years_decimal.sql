-- ============================================================
-- 016: 他校年資允許小數（以月折算，如 17 年 7 個月 = 17.58）
--   - 原本是 SMALLINT，改成 NUMERIC(4,2)
--   - CHECK 範圍維持 0 ~ 60
-- ============================================================

ALTER TABLE public.profiles
  ALTER COLUMN other_school_years TYPE NUMERIC(4,2) USING other_school_years::numeric(4,2);

ALTER TABLE public.profiles
  ALTER COLUMN other_school_years SET DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_other_school_years_check,
  ADD CONSTRAINT profiles_other_school_years_check
    CHECK (other_school_years >= 0 AND other_school_years <= 60);
