-- ============================================================
-- 033: 設備借用表 FK 補 ON UPDATE CASCADE
--      預建/虛擬帳號的老師第一次登入時，handle_new_user trigger 會把
--      profiles.id 換成真實 auth UUID（靠關聯表 ON UPDATE CASCADE 跟進）。
--      027/029 建的設備借用 FK 漏了 CASCADE：若該老師名下已有借用紀錄，
--      換綁會違反 FK → 登入直接失敗。此處補齊。
-- ============================================================

ALTER TABLE public.equipment_loans
  DROP CONSTRAINT IF EXISTS equipment_loans_teacher_id_fkey;
ALTER TABLE public.equipment_loans
  ADD CONSTRAINT equipment_loans_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.equipment_loans
  DROP CONSTRAINT IF EXISTS equipment_loans_closed_by_fkey;
ALTER TABLE public.equipment_loans
  ADD CONSTRAINT equipment_loans_closed_by_fkey
    FOREIGN KEY (closed_by) REFERENCES public.profiles(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.equipment_long_loans
  DROP CONSTRAINT IF EXISTS equipment_long_loans_teacher_id_fkey;
ALTER TABLE public.equipment_long_loans
  ADD CONSTRAINT equipment_long_loans_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
