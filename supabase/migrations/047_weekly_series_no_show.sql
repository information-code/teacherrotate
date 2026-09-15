-- ============================================================
-- 047: 每週重複借用＋「預約未借」次數限制
--      equipment_loans.series_id：每週重複建立的多筆借用用同一 series 串起（單次為 NULL）。
--      equipment_loans.no_show_counted：此筆「預約未借」是否已計次（避免重複計）。
--      equipment_teacher_stats：老師別累計次數（達上限暫停預約；管理端可歸零，
--        歸零後已計次的借用不會被重算）。僅 service-role 讀寫，比照 equipment 系列。
--      既有的過期預約全部標記為已計次（不溯及既往，從本次上線後才開始算）。
-- ============================================================

ALTER TABLE public.equipment_loans
  ADD COLUMN IF NOT EXISTS series_id UUID,
  ADD COLUMN IF NOT EXISTS no_show_counted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_equipment_loans_series
  ON public.equipment_loans(series_id);

CREATE TABLE IF NOT EXISTS public.equipment_teacher_stats (
  teacher_id    UUID PRIMARY KEY REFERENCES public.profiles(id)
                  ON DELETE CASCADE ON UPDATE CASCADE,  -- 預建帳號換綁要跟進
  no_show_count INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.equipment_teacher_stats ENABLE ROW LEVEL SECURITY;

-- 不溯及既往：上線前已過期的預約不計次
UPDATE public.equipment_loans SET no_show_counted = TRUE
WHERE status = 'reserved' AND COALESCE(end_date, loan_date) < CURRENT_DATE;
