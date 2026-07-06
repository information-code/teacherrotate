-- ============================================================
-- 028: 設備編號唯一
--      名稱可以重複（同型設備多台），編號一定不同。
--      僅對非空編號強制唯一（留空不受限）。
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_asset_number_unique
  ON public.equipment(asset_number)
  WHERE asset_number <> '';
