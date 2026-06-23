-- ============================================================
-- 022: 配課階段（開放 / 截止）
--      open   = 開放填報，導師可選方案/自配、科任行政可填節數調整
--      closed = 已截止，教師端唯讀（API 拒絕修改）
--      年度沿用 preference_year（配課與志願同屬一年的流程）。
-- ============================================================

INSERT INTO public.settings (key, value)
  VALUES ('allocation_phase', 'open')
  ON CONFLICT (key) DO NOTHING;
