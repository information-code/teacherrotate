-- ============================================================
-- 039: 排課版本流水號（schedule_plan_version.seq）
--      版本清單有保留上限、舊版本會被自動刪除，依排列順序數出來的「第 N 版」會飄移，
--      課務組講「18 版」時沒人確定是哪一份。加一個每年度遞增、永不重用的流水號，存新版時取 max+1。
--      回填：依建立時間編號；115 學年度最早的一份（8/17 09:56 回填版）已被保留上限刪掉，
--      為了跟課務組口中的 v17／v18 對得上，115 從 2 開始編。
-- ============================================================

ALTER TABLE public.schedule_plan_version ADD COLUMN IF NOT EXISTS seq INTEGER;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY year ORDER BY created_at) AS rn, year
  FROM public.schedule_plan_version
)
UPDATE public.schedule_plan_version v
SET seq = n.rn + CASE WHEN n.year = 115 THEN 1 ELSE 0 END
FROM numbered n
WHERE v.id = n.id AND v.seq IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spv_year_seq ON public.schedule_plan_version (year, seq);
