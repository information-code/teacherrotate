-- ============================================================
-- 030: 短期借用支援跨日期間（訂房式：開始日＋開始時段 ～ 結束日＋結束時段）
--      equipment_loans 加 end_date / start_period / end_period；
--      既有單日資料回填（end_date=loan_date）。
--      新 RPC reserve_equipment_loan_range：一次寫入跨日占用格，
--      任一格已被借（unique_violation）整筆回滾。
-- ============================================================

ALTER TABLE public.equipment_loans
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS start_period TEXT,
  ADD COLUMN IF NOT EXISTS end_period TEXT;

UPDATE public.equipment_loans
SET end_date     = COALESCE(end_date, loan_date),
    start_period = COALESCE(start_period, periods[1]),
    end_period   = COALESCE(end_period, periods[array_upper(periods, 1)]);

CREATE OR REPLACE FUNCTION public.reserve_equipment_loan_range(
  p_equipment_id UUID,
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
    (equipment_id, teacher_id, loan_date, end_date, start_period, end_period, periods)
  VALUES
    (p_equipment_id, p_teacher_id, p_start_date, p_end_date, p_start_period, p_end_period,
     COALESCE(v_first_periods, ARRAY[]::TEXT[]))
  RETURNING id INTO v_id;

  INSERT INTO public.equipment_loan_slots (loan_id, equipment_id, loan_date, period)
  SELECT v_id, p_equipment_id, (s.value->>'date')::date, p.value
  FROM jsonb_array_elements(p_slots) AS s
  CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'periods') AS p;

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'slot_taken';
END;
$$;
