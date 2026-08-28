-- ============================================================
-- 041: 報修案件留言板
--      單向的 admin_note「向報修者說明」不夠用（老師無法回覆），
--      改為每案一條留言串：報修老師與維護方（管理端/看板）都可留言，
--      未結案才能發言、結案後串保留唯讀。
--      既有 admin_note 內容搬進留言串當第一則（維護方）；欄位保留棄用。
--      僅由 service-role（API）讀寫。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.repair_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES public.repair_reports(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  author_name TEXT NOT NULL DEFAULT '',   -- 發言當下快照
  is_admin    BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE＝維護方（管理端/看板）
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_messages_report
  ON public.repair_messages(report_id, created_at);

ALTER TABLE public.repair_messages ENABLE ROW LEVEL SECURITY;

-- 既有說明搬進留言串（維護方、時間用案件 updated_at）
INSERT INTO public.repair_messages (report_id, author_name, is_admin, body, created_at)
SELECT id, '維護人員', TRUE, admin_note, updated_at
FROM public.repair_reports
WHERE admin_note <> '';
