-- ============================================================
-- 048: 活動保留（管理者為校內活動保留設備）
--      資訊組協助借用的活動（如校慶、研習）沒有借用老師，也不走
--      預約→借用→歸還與拍照手續：建立即整天占用，取消時釋出時段。
--      equipment_loans.teacher_id 改可空；activity_name 記活動名稱或事項；
--      status 'held' ＝活動保留。「有借用老師」或「有活動名稱」二擇一，
--      由 API 層把關（建立時先寫入占用格再補活動名稱，不下 CHECK）。
-- ============================================================

ALTER TABLE public.equipment_loans
  ALTER COLUMN teacher_id DROP NOT NULL;

ALTER TABLE public.equipment_loans
  ADD COLUMN IF NOT EXISTS activity_name TEXT NOT NULL DEFAULT '';
