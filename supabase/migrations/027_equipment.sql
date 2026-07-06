-- ============================================================
-- 027: 資訊設備借用與管理
--      equipment：設備庫（週邊、借用/歸還檢查清單直接掛在設備上）。
--      equipment_config：全域設定（單筆 JSON）：開放節次、四份同意書、
--        逾期通知模板、續借週期、預借天數。
--      equipment_loans：短期借用（已預約→借用中→已歸還；預約期可自行取消）。
--      equipment_loan_slots：借用占用的「設備×日期×節次」格，
--        UNIQUE 保證同一格同時只有一筆有效借用；取消/歸還時刪列釋出。
--      equipment_long_loans / equipment_renewals：長期借用與續借回傳紀錄。
--      皆僅由 service-role（API）讀寫，比照 allocation 系列。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.equipment (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  location         TEXT NOT NULL DEFAULT '',
  asset_number     TEXT NOT NULL DEFAULT '',
  peripherals      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]
  borrow_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{label, requiresPhoto}]
  return_checklist JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{label, requiresPhoto}]
  status           TEXT NOT NULL DEFAULT 'available',   -- available | maintenance | retired
  notes            TEXT NOT NULL DEFAULT '',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.equipment_config (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.equipment_loans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id     UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  teacher_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  loan_date        DATE NOT NULL,
  periods          TEXT[] NOT NULL,                      -- 節次 key 陣列
  status           TEXT NOT NULL DEFAULT 'reserved',     -- reserved | borrowed | returned | cancelled | closed
  borrow_agreed_at TIMESTAMPTZ,
  borrow_checklist JSONB,                                -- [{label, requiresPhoto, checked, photos: string[]}]
  borrowed_at      TIMESTAMPTZ,
  return_agreed_at TIMESTAMPTZ,
  return_checklist JSONB,
  returned_at      TIMESTAMPTZ,
  closed_by        UUID REFERENCES public.profiles(id),  -- 管理者代為結案者
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_loans_equipment_date
  ON public.equipment_loans(equipment_id, loan_date);
CREATE INDEX IF NOT EXISTS idx_equipment_loans_teacher
  ON public.equipment_loans(teacher_id);

-- 有效借用的占用格：同設備同日同節次僅能有一筆（資料庫層防撞）
CREATE TABLE IF NOT EXISTS public.equipment_loan_slots (
  loan_id      UUID NOT NULL REFERENCES public.equipment_loans(id) ON DELETE CASCADE,
  equipment_id UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  loan_date    DATE NOT NULL,
  period       TEXT NOT NULL,
  UNIQUE (equipment_id, loan_date, period)
);

CREATE INDEX IF NOT EXISTS idx_equipment_loan_slots_loan
  ON public.equipment_loan_slots(loan_id);

CREATE TABLE IF NOT EXISTS public.equipment_long_loans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  teacher_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date   DATE NOT NULL,
  due_date     DATE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',  -- active | ended
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_long_loans_teacher
  ON public.equipment_long_loans(teacher_id);

CREATE TABLE IF NOT EXISTS public.equipment_renewals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  long_loan_id UUID NOT NULL REFERENCES public.equipment_long_loans(id) ON DELETE CASCADE,
  photos       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- storage path string[]
  old_due_date DATE NOT NULL,
  new_due_date DATE NOT NULL,
  agreed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_renewals_long_loan
  ON public.equipment_renewals(long_loan_id);

ALTER TABLE public.equipment            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_loans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_loan_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_long_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_renewals   ENABLE ROW LEVEL SECURITY;

-- 預約：寫入借用主檔＋占用格，同一交易內完成；
-- 任一節次已被占用（unique_violation）→ 整筆回滾並回報 slot_taken。
CREATE OR REPLACE FUNCTION public.reserve_equipment_loan(
  p_equipment_id UUID,
  p_teacher_id   UUID,
  p_loan_date    DATE,
  p_periods      TEXT[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.equipment_loans (equipment_id, teacher_id, loan_date, periods)
  VALUES (p_equipment_id, p_teacher_id, p_loan_date, p_periods)
  RETURNING id INTO v_id;

  INSERT INTO public.equipment_loan_slots (loan_id, equipment_id, loan_date, period)
  SELECT v_id, p_equipment_id, p_loan_date, unnest(p_periods);

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'slot_taken';
END;
$$;

-- 照片私有 bucket：一律由 service-role 上傳、以簽名網址讀取
INSERT INTO storage.buckets (id, name, public)
VALUES ('equipment-photos', 'equipment-photos', false)
ON CONFLICT (id) DO NOTHING;
