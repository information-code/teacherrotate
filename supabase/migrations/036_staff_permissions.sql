-- ============================================================
-- 036: 行政人員權限與學年度
--      staff_roster：行政職務名冊（誰有校務公告權限，以此表為準）。
--        「開始新學年度」時從該年 rotations 帶入各職務的人，之後可在
--        權限頁改人或開關；enabled 開關跨年保留、人員每年重新帶入。
--      school_events 補 office（處室標籤，供教師端篩選）。
--      announcements / school_events 補 publisher_title（發布當下的
--        職稱快照，如「註冊組長」「最高管理者」，職務輪動不影響歷史）。
--      current_school_year 存於 settings（key='current_school_year'），
--        由最高管理者按「開始新學年度」推進，與 preference_year（規劃
--        中年度）各自獨立。
--      皆僅由 service-role（API）讀寫。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_roster (
  duty       TEXT PRIMARY KEY,                 -- 職務名稱，同 scoremap.work（教務主任、註冊組長…）
  office     TEXT NOT NULL,                    -- 所屬處室：教務處/學務處/總務處/輔導室
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,   -- 是否開放校務公告權限
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.staff_roster ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.school_events
  ADD COLUMN IF NOT EXISTS office          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS publisher_title TEXT NOT NULL DEFAULT '';

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS publisher_title TEXT NOT NULL DEFAULT '';
