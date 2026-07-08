-- ============================================================
-- 032: 設備群組（整組借用）
--      equipment_groups：自訂群組（名稱＋整組借用/歸還檢查清單），
--        成員以 equipment.group_id 指定（一台設備至多屬一組）。
--      短期/長期借用皆支援整組：equipment_id 改可空、新增 group_id，兩者擇一。
--      整組短期借用以「同一筆借用寫入全部成員的占用格」達成與單台互斥：
--        任何成員被單台借走→整組不可借；整組借走→所有單台不可借。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.equipment_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  borrow_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{label, requiresPhoto}]
  return_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'available',   -- available | disabled
  notes            TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.equipment_groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.equipment_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_group ON public.equipment(group_id);

-- 短期借用：整組借用記 group_id（equipment_id 為空）
ALTER TABLE public.equipment_loans
  ALTER COLUMN equipment_id DROP NOT NULL;
ALTER TABLE public.equipment_loans
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.equipment_groups(id) ON DELETE SET NULL;
ALTER TABLE public.equipment_loans
  DROP CONSTRAINT IF EXISTS equipment_loans_target_check;
ALTER TABLE public.equipment_loans
  ADD CONSTRAINT equipment_loans_target_check
  CHECK (equipment_id IS NOT NULL OR group_id IS NOT NULL);

-- 長期借用：整組指派記 group_id
ALTER TABLE public.equipment_long_loans
  ALTER COLUMN equipment_id DROP NOT NULL;
ALTER TABLE public.equipment_long_loans
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.equipment_groups(id) ON DELETE SET NULL;
ALTER TABLE public.equipment_long_loans
  DROP CONSTRAINT IF EXISTS equipment_long_loans_target_check;
ALTER TABLE public.equipment_long_loans
  ADD CONSTRAINT equipment_long_loans_target_check
  CHECK (equipment_id IS NOT NULL OR group_id IS NOT NULL);

-- 整組預約：一筆借用＋全部成員的占用格，同一交易完成；
-- 任一成員任一格已被占用（unique_violation）→ 整筆回滾 slot_taken。
CREATE OR REPLACE FUNCTION public.reserve_equipment_group_loan(
  p_group_id     UUID,
  p_teacher_id   UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_start_period TEXT,
  p_end_period   TEXT,
  p_slots        JSONB  -- [{"date":"2026-07-08","periods":["p3","p4"]}, ...]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_first_periods TEXT[];
BEGIN
  SELECT array_agg(t.x) INTO v_first_periods
  FROM jsonb_array_elements_text(p_slots->0->'periods') AS t(x);

  INSERT INTO public.equipment_loans
    (group_id, teacher_id, loan_date, end_date, start_period, end_period, periods)
  VALUES
    (p_group_id, p_teacher_id, p_start_date, p_end_date, p_start_period, p_end_period,
     COALESCE(v_first_periods, ARRAY[]::TEXT[]))
  RETURNING id INTO v_id;

  INSERT INTO public.equipment_loan_slots (loan_id, equipment_id, loan_date, period)
  SELECT v_id, m.id, (s.value->>'date')::date, p.value
  FROM jsonb_array_elements(p_slots) AS s
  CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'periods') AS p
  CROSS JOIN (SELECT id FROM public.equipment WHERE group_id = p_group_id) AS m;

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'slot_taken';
END;
$$;
