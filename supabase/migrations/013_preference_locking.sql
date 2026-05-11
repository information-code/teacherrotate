-- ============================================================
-- 013: preferences 加上「鎖定」與「放棄選填」欄位
--   - locked  : 老師儲存後鎖定，需要管理者協助才能再次修改
--   - give_up : 老師勾選「放棄選填志願（中途返校由校內安排）」
-- ============================================================

ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS locked  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS give_up BOOLEAN NOT NULL DEFAULT FALSE;
