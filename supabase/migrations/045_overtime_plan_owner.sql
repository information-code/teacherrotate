-- ============================================================
-- 045: 超鐘簽到——計畫經費歸屬建立者
--      計畫可能來自不同管理者（各處室經費），彼此不互相碰資料：
--      名單頁面只列自己建立的計畫、僅建立者可改（superadmin 全部可）。
--      但同一位老師的統計（同週上限、重疊檢查）仍跨所有計畫合併計算。
--      created_by NULL＝既有舊資料，視為共用（所有超鐘管理者可管理）。
-- ============================================================

ALTER TABLE public.overtime_plans
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT NOT NULL DEFAULT '';
