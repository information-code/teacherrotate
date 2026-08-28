-- ============================================================
-- 042: 超鐘簽到（減課鐘點費簽到表）
--      overtime_plans：經費來源（計畫名稱、期程、節薪、總經費）。
--      overtime_teachers：各計畫的教師清冊（系統帳號或手動姓名、
--        身分 formal 正式／substitute 代理／hourly 鐘點人員、代扣款）。
--      overtime_slots：減課時段（星期×節次×班級×領域；
--        同一列教師的同一星期節次不可重複；跨計畫同人同時段由 API 擋）。
--      overtime_skip_dates：特殊不上課日（該日跳過減課；
--        國定假日直接讀 holidays 表，不複製進來）。
--      正式／代理每人每週上限 6 節由 API 檢查（鐘點人員無上限）。
--      皆僅由 service-role（API）讀寫。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.overtime_plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  rate       INTEGER NOT NULL DEFAULT 0,   -- 節薪（元）
  budget     INTEGER NOT NULL DEFAULT 0,   -- 總經費（元；0＝未設定）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS public.overtime_teachers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    UUID NOT NULL REFERENCES public.overtime_plans(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  name       TEXT NOT NULL,                        -- 顯示姓名（快照／手動）
  category   TEXT NOT NULL DEFAULT 'formal',       -- formal | substitute | hourly
  labor_fee  INTEGER NOT NULL DEFAULT 0,           -- 勞保費
  health_fee INTEGER NOT NULL DEFAULT 0,           -- 健保費
  lunch_fee  INTEGER NOT NULL DEFAULT 0,           -- 午餐費代扣
  other_fee  INTEGER NOT NULL DEFAULT 0,           -- 其他扣款
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overtime_teachers_plan
  ON public.overtime_teachers(plan_id);

CREATE TABLE IF NOT EXISTS public.overtime_slots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_row_id UUID NOT NULL REFERENCES public.overtime_teachers(id) ON DELETE CASCADE,
  weekday        SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  period         SMALLINT NOT NULL CHECK (period BETWEEN 1 AND 7),
  class_name     TEXT NOT NULL DEFAULT '',
  domain         TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_row_id, weekday, period)
);

CREATE TABLE IF NOT EXISTS public.overtime_skip_dates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date       DATE NOT NULL UNIQUE,
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.overtime_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_teachers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_slots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_skip_dates ENABLE ROW LEVEL SECURITY;
