-- ============================================================
-- 017: profiles 加上「關埔代理年資」欄位
--   - 關埔正式年資由 rotations 紀錄自動計算
--   - 關埔代理年資由管理者手動輸入（rotations 不會記錄）
--   - 關埔年資 = 正式 + 代理
--   - 年資積分 = 關埔年資 × 0.8 + 他校年資 × 0.2
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kanpu_substitute_years NUMERIC(4,2) NOT NULL DEFAULT 0;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_kanpu_substitute_years_check,
  ADD CONSTRAINT profiles_kanpu_substitute_years_check
    CHECK (kanpu_substitute_years >= 0 AND kanpu_substitute_years <= 60);
