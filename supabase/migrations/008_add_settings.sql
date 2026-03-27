-- ============================================================
-- 008: 系統設定表
-- ============================================================

CREATE TABLE public.settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- 預設值：中低年級導師連續5年後轉換得分
INSERT INTO public.settings (key, value) VALUES ('midlow_switch_score', '2');
