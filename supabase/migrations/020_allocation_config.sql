-- ============================================================
-- 020: 配課設定（每年度一筆 JSON）
--      Setting 1（基本/需求）+ Setting 2（情境/方案）。
--      設定為整頁讀寫、且每年科目與情境會變動，用 JSON 最有彈性。
--      僅由 service-role（API）讀寫，比照 settings/selection_panel。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.allocation_config (
  year       INTEGER PRIMARY KEY,
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.allocation_config ENABLE ROW LEVEL SECURITY;
