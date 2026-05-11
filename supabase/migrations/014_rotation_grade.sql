-- ============================================================
-- 014: rotations 加上 grade 欄位
--   - 1~6 表示該老師在那一年帶到哪一個年級（1=一年級 ... 6=六年級）
--   - NULL 表示未指定（科任/主任/組長 等非導師職務通常留空）
--   - 用於精確判定老師是否處於「該輪換的學年」（2/4/6 年級結束時）
--   - 若有 grade 值，覆寫原本依 streak 奇偶推算的邏輯
-- ============================================================

ALTER TABLE public.rotations
  ADD COLUMN IF NOT EXISTS grade SMALLINT;

ALTER TABLE public.rotations
  DROP CONSTRAINT IF EXISTS rotations_grade_check,
  ADD CONSTRAINT rotations_grade_check
    CHECK (grade IS NULL OR grade BETWEEN 1 AND 6);
