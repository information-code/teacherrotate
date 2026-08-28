-- ============================================================
-- 044: 超鐘簽到——減課時段各自帶時間區段
--      每個時間區段的減課時段可以不同（例：6/1~6/30 減週一 1,2 節、
--      9/1~12/31 改減週二 1,2 節），因此把區間從教師列（ranges JSONB）
--      移到 overtime_slots 上：start_date/end_date NULL＝整個計畫期程。
--      同星期節次在「不重疊」的區間可以各自成立 → 拿掉唯一約束，
--      重疊檢查與每週上限（改算同時生效的最大節數）由 API 把關。
--      既有資料：teacher 列有 ranges 者，把每個 slot 複製到每段區間
--      （原語意＝所有區間都上同樣的時段）；ranges 欄位棄用保留。
-- ============================================================

ALTER TABLE public.overtime_slots
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date   DATE;

ALTER TABLE public.overtime_slots
  DROP CONSTRAINT IF EXISTS overtime_slots_teacher_row_id_weekday_period_key;

-- 搬遷：每段區間各複製一份時段
INSERT INTO public.overtime_slots (teacher_row_id, weekday, period, class_name, domain, start_date, end_date)
SELECT s.teacher_row_id, s.weekday, s.period, s.class_name, s.domain,
       (r->>'start')::date, (r->>'end')::date
FROM public.overtime_slots s
JOIN public.overtime_teachers t ON t.id = s.teacher_row_id,
     jsonb_array_elements(t.ranges) r
WHERE jsonb_typeof(t.ranges) = 'array'
  AND jsonb_array_length(t.ranges) > 0
  AND s.start_date IS NULL;

-- 原本無區間標記的時段（已被上面複製走的）刪除
DELETE FROM public.overtime_slots s
USING public.overtime_teachers t
WHERE t.id = s.teacher_row_id
  AND jsonb_typeof(t.ranges) = 'array'
  AND jsonb_array_length(t.ranges) > 0
  AND s.start_date IS NULL;

-- 教師列的 ranges 清空（棄用；避免日後誤讀舊語意）
UPDATE public.overtime_teachers SET ranges = '[]'::jsonb
WHERE jsonb_typeof(ranges) = 'array' AND jsonb_array_length(ranges) > 0;
