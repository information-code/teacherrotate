-- ============================================================
-- 015: profiles 加上「他校年資」欄位
--   - 由管理者手動補上的他校累積年資（單位：年）
--   - 配合 rotations 計算的「關埔年資」用作輪動積分相同時的 tie-breaker：
--     年資積分 = 關埔年資 × 0.8 + 他校年資 × 0.2
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS other_school_years SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_other_school_years_check,
  ADD CONSTRAINT profiles_other_school_years_check
    CHECK (other_school_years >= 0 AND other_school_years <= 60);
