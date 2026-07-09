-- ============================================================
-- 035: 個人事項時間欄位
--      整天事項兩欄皆 NULL；指定時間則兩欄皆填（24 小時制 TIME）。
-- ============================================================

ALTER TABLE public.personal_events
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME;
