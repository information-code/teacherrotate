-- ============================================================
-- 046: 群組「借 N 台」（部分群組借用）
--      equipment_loans.unit_ids：群組借用實際占用的成員設備 id（JSONB 陣列）。
--        新借用一律寫入實際配到的成員；舊資料維持 []＝當時整組全部成員。
--      reserve_equipment_group_loan 加 p_unit_ids：只寫入所選成員的占用格，
--        NULL/空陣列＝整組全部成員（向下相容）。
--      注意：本 migration 未執行前，新版程式的群組借用會因 RPC 參數不符而失敗
--        （單台借用不受影響），部署後請立即執行。
-- ============================================================

ALTER TABLE public.equipment_loans
  ADD COLUMN IF NOT EXISTS unit_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.reserve_equipment_group_loan(
  p_group_id     UUID,
  p_teacher_id   UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_start_period TEXT,
  p_end_period   TEXT,
  p_slots        JSONB,               -- [{"date":"2026-07-08","periods":["p3","p4"]}, ...]
  p_unit_ids     UUID[] DEFAULT NULL  -- 實際借用的成員設備；NULL/空 = 整組全部
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_first_periods TEXT[];
  v_units UUID[];
BEGIN
  IF p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    SELECT array_agg(id) INTO v_units FROM public.equipment WHERE group_id = p_group_id;
  ELSE
    v_units := p_unit_ids;
  END IF;

  SELECT array_agg(t.x) INTO v_first_periods
  FROM jsonb_array_elements_text(p_slots->0->'periods') AS t(x);

  INSERT INTO public.equipment_loans
    (group_id, teacher_id, loan_date, end_date, start_period, end_period, periods, unit_ids)
  VALUES
    (p_group_id, p_teacher_id, p_start_date, p_end_date, p_start_period, p_end_period,
     COALESCE(v_first_periods, ARRAY[]::TEXT[]), COALESCE(to_jsonb(v_units), '[]'::jsonb))
  RETURNING id INTO v_id;

  INSERT INTO public.equipment_loan_slots (loan_id, equipment_id, loan_date, period)
  SELECT v_id, m.id, (s.value->>'date')::date, p.value
  FROM jsonb_array_elements(p_slots) AS s
  CROSS JOIN LATERAL jsonb_array_elements_text(s.value->'periods') AS p
  CROSS JOIN unnest(v_units) AS m(id);

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'slot_taken';
END;
$$;
