-- ============================================================
-- 012: preferences 改為每年一筆
--      把現有志願（每位教師一筆）標記為 114 學年度，
--      之後每年填報新一輪 -> 新增 year 的 row
-- ============================================================

-- 加 year 欄位（先允許 NULL 以便 backfill）
ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS year INTEGER;

-- backfill 既有資料為 114
UPDATE public.preferences SET year = 114 WHERE year IS NULL;

-- 改為 NOT NULL
ALTER TABLE public.preferences
  ALTER COLUMN year SET NOT NULL;

-- 移除舊的 UNIQUE(teacher_id)，換成 UNIQUE(teacher_id, year)
ALTER TABLE public.preferences
  DROP CONSTRAINT IF EXISTS preferences_teacher_id_key;

ALTER TABLE public.preferences
  ADD CONSTRAINT preferences_teacher_id_year_key UNIQUE (teacher_id, year);

CREATE INDEX IF NOT EXISTS idx_preferences_year ON public.preferences(year);

-- 「目前開放填寫的年度」設定（預設 115）
INSERT INTO public.settings (key, value)
  VALUES ('preference_year', '115')
  ON CONFLICT (key) DO NOTHING;
