-- ============================================================
-- 034: 教師工作首頁（行事曆／公告／代辦）
--      school_events：學校活動（管理者維護，支援跨日、全天制）。
--      holidays：國定假日與補班日（政府行政機關辦公日曆表同步＋手動增修）。
--      personal_events：教師個人事項（僅本人可見）。
--      announcements：各處室重要公告（處室為標籤欄位，發布者為管理者）；
--        publish_at／expire_at 控制上下架，link_url 放填報表單連結。
--      announcement_reads：已讀紀錄（教師端未讀標示＋管理端已讀統計）。
--      todos：代辦事項；source 區分 self（自建）／announcement（從公告加入）
--        ／assigned（交辦任務，Phase 2 使用）。
--      皆僅由 service-role（API）讀寫，比照 allocation／equipment 系列。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.school_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_school_events_range
  ON public.school_events(start_date, end_date);

CREATE TABLE IF NOT EXISTS public.holidays (
  date       DATE PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  is_holiday BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE 放假日；FALSE 補行上班日
  source     TEXT NOT NULL DEFAULT 'sync',    -- sync | manual
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.personal_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  title      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_events_user_date
  ON public.personal_events(user_id, date);

CREATE TABLE IF NOT EXISTS public.announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  office          TEXT NOT NULL DEFAULT '',    -- 處室標籤：教務處／學務處／總務處／輔導室…
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  requires_action BOOLEAN NOT NULL DEFAULT FALSE,  -- 需填報／需老師採取行動
  link_url        TEXT NOT NULL DEFAULT '',        -- 填報表單等外部連結
  publish_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expire_at       TIMESTAMPTZ,                     -- NULL＝不下架
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_publish
  ON public.announcements(publish_at DESC);

CREATE TABLE IF NOT EXISTS public.announcement_reads (
  announcement_id UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.todos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  due_date        DATE,                              -- NULL＝無期限
  status          TEXT NOT NULL DEFAULT 'todo',      -- todo | done
  source          TEXT NOT NULL DEFAULT 'self',      -- self | announcement | assigned
  announcement_id UUID REFERENCES public.announcements(id) ON DELETE SET NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todos_user
  ON public.todos(user_id, status, due_date);

ALTER TABLE public.school_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos              ENABLE ROW LEVEL SECURITY;
