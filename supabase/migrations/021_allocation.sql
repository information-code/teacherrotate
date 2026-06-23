-- ============================================================
-- 021: 教師配課結果（每年每位老師一筆 JSON）
--      導師：各情境的科目配課；科任/行政：只記專案減課/超鐘點（節數計算）。
--      僅由 service-role（API）讀寫，API 內以 teacher_id = auth.uid() 控管。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.allocation (
  year       INTEGER NOT NULL,
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year, teacher_id)
);

ALTER TABLE public.allocation ENABLE ROW LEVEL SECURITY;
