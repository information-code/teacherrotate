-- ============================================================
-- 027: 導師排課選填
--      排課精靈發布後，導師在教師端把自己的配課填入班級課表留白格。
--      每班一列（避免多位導師同時填報互相覆蓋 schedule_plan 單一 JSON）。
--      cells: { "day-period": "科目" }；confirmed_at 非空＝導師已確認。
--      僅由 service-role（API）讀寫。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schedule_homeroom (
  year        INTEGER NOT NULL,
  class_key   TEXT NOT NULL,               -- `${grade}-${index}`
  teacher_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  cells       JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year, class_key)
);

ALTER TABLE public.schedule_homeroom ENABLE ROW LEVEL SECURITY;
