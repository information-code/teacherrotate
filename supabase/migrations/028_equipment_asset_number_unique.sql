-- ============================================================
-- 028: 同名設備編號唯一
--      名稱可以重複（同型設備多台），但同一名稱底下編號一定不同；
--      不同名稱的設備可以有相同編號。
--      僅對非空編號強制（留空不受限）。
-- ============================================================

DROP INDEX IF EXISTS public.idx_equipment_asset_number_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_name_asset_number_unique
  ON public.equipment(name, asset_number)
  WHERE asset_number <> '';
