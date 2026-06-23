-- ============================================================
-- 025: 排課（scheduling）
--      schedule_config：排課設定（每年度一筆 JSON）
--        年段時段格、全校固定占用、學年共同不排課、班級封鎖、教師不排課。
--      schedule_plan：排課結果（每年度一筆 JSON），由演算法產生後存放。
--      皆僅由 service-role（API）讀寫，比照 allocation_config。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schedule_config (
  year       INTEGER PRIMARY KEY,
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.schedule_plan (
  year         INTEGER PRIMARY KEY,
  plan         JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.schedule_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_plan ENABLE ROW LEVEL SECURITY;
