-- ============================================================
-- 029: 長期借用支援系統外人員
--      借用人可以是沒有系統帳號的人（不需登入的同仁），
--      teacher_id 改為可空，external_name 記姓名；兩者必居其一。
--      系統外人員無法自行續借回傳，由管理者代管。
-- ============================================================

ALTER TABLE public.equipment_long_loans
  ALTER COLUMN teacher_id DROP NOT NULL;

ALTER TABLE public.equipment_long_loans
  ADD COLUMN IF NOT EXISTS external_name TEXT NOT NULL DEFAULT '';

ALTER TABLE public.equipment_long_loans
  DROP CONSTRAINT IF EXISTS equipment_long_loans_borrower_check;

ALTER TABLE public.equipment_long_loans
  ADD CONSTRAINT equipment_long_loans_borrower_check
  CHECK (teacher_id IS NOT NULL OR external_name <> '');
