-- ============================================================
-- 019: 撕榜面板持久化
--      原本撕榜結果（名額 quotas + 配置 placements）只存在瀏覽器
--      localStorage，換電腦/瀏覽器不同步、也無法寫回工作紀錄。
--      改存後端：每個年度一筆 JSON。僅由 service-role（API）讀寫，
--      比照 settings 表只啟用 RLS、不開放一般角色。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.selection_panel (
  year       INTEGER PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { quotas, placements }
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.selection_panel ENABLE ROW LEVEL SECURITY;
