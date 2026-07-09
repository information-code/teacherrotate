-- ============================================================
-- 037: 權限矩陣（職務 × 管理頁面）
--      staff_roster.perms：該職務可用的管理頁面 key 陣列
--        （announcements/calendar/holidays/whitelist/teachers/…）。
--      廢除「管理員」角色：權限只剩兩層——
--        superadmin（跟人走，全功能）＋職務權限矩陣（跟職務走）。
--        既有 admin 帳號一律降回 teacher，改由矩陣授權。
-- ============================================================

ALTER TABLE public.staff_roster
  ADD COLUMN IF NOT EXISTS perms JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 舊的單一開關併入 perms 後不再使用
ALTER TABLE public.staff_roster DROP COLUMN IF EXISTS enabled;

-- 廢除管理員角色（superadmin 不受影響）
UPDATE public.profiles SET role = 'teacher' WHERE role = 'admin';
