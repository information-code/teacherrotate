-- ============================================================
-- 024: 教師聘任別（正式 / 代理）
--      formal=正式（輪動分數、選填志願、撕榜、配課皆適用）
--      substitute=代理（不輪動、不選志願；僅配課選填）
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'formal';
