-- ============================================================
-- 040: 設備報修
--      repair_items：報修設備項目字典（獨立於借用系統的 equipment，
--        報修對象多為固定裝置：電視、網路、冷氣…）。
--      repair_issues：標準問題字典（聚合核心），掛在設備項目下；
--        aliases 同義詞餵給教師端即時建議，guide 為自助排解內容。
--      repair_contacts：可呼叫的維護人員（老師/學生）聯絡清單。
--      repair_config：全域設定（單筆 JSON）：SLA 警告門檻等。
--      repair_reports：報修案件。issue_id 與 custom_issue 二擇一
--        （由 API 層把關；FK 為 SET NULL 故不下 CHECK），
--        item_name/issue_name 為送出當下快照，字典改名/刪除後統計仍可讀。
--      皆僅由 service-role（API）讀寫，比照 equipment 系列。
--      照片沿用私有 bucket equipment-photos，路徑前綴 repair/。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.repair_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  fallback_guide JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {videoUrl, stepsMd, photos: string[]}
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.repair_issues (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID NOT NULL REFERENCES public.repair_items(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  aliases    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- string[]，同義詞（即時建議比對用）
  guide      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {videoUrl, stepsMd, photos: string[]}
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_issues_item
  ON public.repair_issues(item_id);

CREATE TABLE IF NOT EXISTS public.repair_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'teacher',  -- teacher | student
  contact    TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.repair_config (
  id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.repair_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES public.profiles(id)
                  ON DELETE CASCADE ON UPDATE CASCADE,  -- 預建帳號換綁要跟進
  item_id       UUID REFERENCES public.repair_items(id) ON DELETE SET NULL,
  item_name     TEXT NOT NULL,                          -- 送出當下快照
  issue_id      UUID REFERENCES public.repair_issues(id) ON DELETE SET NULL,
  issue_name    TEXT NOT NULL DEFAULT '',               -- 標準問題快照；自由繕打時為 ''
  custom_issue  TEXT NOT NULL DEFAULT '',               -- 自由繕打原文（歸類後仍保留）
  location      TEXT NOT NULL DEFAULT '',
  photos        JSONB NOT NULL DEFAULT '[]'::jsonb,     -- storage path string[]
  status        TEXT NOT NULL DEFAULT 'pending',        -- pending | accepted | dispatched | vendor | closed
  resolved_kind TEXT,                                   -- NULL | self | vanished | fixed
  admin_note    TEXT NOT NULL DEFAULT '',
  closed_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  vendor_at     TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_reports_teacher
  ON public.repair_reports(teacher_id);
CREATE INDEX IF NOT EXISTS idx_repair_reports_status
  ON public.repair_reports(status);
CREATE INDEX IF NOT EXISTS idx_repair_reports_created
  ON public.repair_reports(created_at);

ALTER TABLE public.repair_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_issues   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_reports  ENABLE ROW LEVEL SECURITY;
