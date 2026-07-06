-- ============================================================
-- 031: 短期借用操作日誌
--      每個操作一條紀錄（預約/開始借用/歸還/取消/管理者釋出/管理者結案），
--      設備與人名以快照存文字，設備刪除或改名後日誌仍完整可讀。
--      管理端「短期借用」分頁改為唯讀日誌；管理動作移到「設備總覽」。
--      既有借用紀錄回填為對應事件。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.equipment_loan_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id        UUID REFERENCES public.equipment_loans(id) ON DELETE SET NULL,
  equipment_id   UUID,
  equipment_name TEXT NOT NULL DEFAULT '',
  asset_number   TEXT NOT NULL DEFAULT '',
  teacher_id     UUID,
  teacher_name   TEXT NOT NULL DEFAULT '',
  action         TEXT NOT NULL,  -- reserved | borrowed | returned | cancelled | released | closed
  detail         TEXT NOT NULL DEFAULT '',  -- 借用期間文字
  actor_name     TEXT NOT NULL DEFAULT '',  -- 操作者（老師本人或管理者）
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_loan_events_created
  ON public.equipment_loan_events(created_at DESC);

ALTER TABLE public.equipment_loan_events ENABLE ROW LEVEL SECURITY;

-- ---------- 回填既有借用紀錄 ----------
-- 預約（所有紀錄的建立時間）
INSERT INTO public.equipment_loan_events
  (loan_id, equipment_id, equipment_name, asset_number, teacher_id, teacher_name, action, detail, actor_name, created_at)
SELECT l.id, l.equipment_id, COALESCE(e.name, '（已刪除設備）'), COALESCE(e.asset_number, ''),
       l.teacher_id, COALESCE(p.name, p.email, ''), 'reserved',
       CASE WHEN l.end_date IS NOT NULL AND l.end_date <> l.loan_date
            THEN l.loan_date::text || '～' || l.end_date::text ELSE l.loan_date::text END,
       COALESCE(p.name, p.email, ''), l.created_at
FROM public.equipment_loans l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.profiles p ON p.id = l.teacher_id;

-- 開始借用
INSERT INTO public.equipment_loan_events
  (loan_id, equipment_id, equipment_name, asset_number, teacher_id, teacher_name, action, detail, actor_name, created_at)
SELECT l.id, l.equipment_id, COALESCE(e.name, '（已刪除設備）'), COALESCE(e.asset_number, ''),
       l.teacher_id, COALESCE(p.name, p.email, ''), 'borrowed',
       CASE WHEN l.end_date IS NOT NULL AND l.end_date <> l.loan_date
            THEN l.loan_date::text || '～' || l.end_date::text ELSE l.loan_date::text END,
       COALESCE(p.name, p.email, ''), l.borrowed_at
FROM public.equipment_loans l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.profiles p ON p.id = l.teacher_id
WHERE l.borrowed_at IS NOT NULL;

-- 歸還
INSERT INTO public.equipment_loan_events
  (loan_id, equipment_id, equipment_name, asset_number, teacher_id, teacher_name, action, detail, actor_name, created_at)
SELECT l.id, l.equipment_id, COALESCE(e.name, '（已刪除設備）'), COALESCE(e.asset_number, ''),
       l.teacher_id, COALESCE(p.name, p.email, ''), 'returned',
       CASE WHEN l.end_date IS NOT NULL AND l.end_date <> l.loan_date
            THEN l.loan_date::text || '～' || l.end_date::text ELSE l.loan_date::text END,
       COALESCE(p.name, p.email, ''), l.returned_at
FROM public.equipment_loans l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.profiles p ON p.id = l.teacher_id
WHERE l.status = 'returned' AND l.returned_at IS NOT NULL;

-- 管理者結案
INSERT INTO public.equipment_loan_events
  (loan_id, equipment_id, equipment_name, asset_number, teacher_id, teacher_name, action, detail, actor_name, created_at)
SELECT l.id, l.equipment_id, COALESCE(e.name, '（已刪除設備）'), COALESCE(e.asset_number, ''),
       l.teacher_id, COALESCE(p.name, p.email, ''), 'closed',
       CASE WHEN l.end_date IS NOT NULL AND l.end_date <> l.loan_date
            THEN l.loan_date::text || '～' || l.end_date::text ELSE l.loan_date::text END,
       COALESCE(a.name, a.email, ''), COALESCE(l.returned_at, l.updated_at)
FROM public.equipment_loans l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.profiles p ON p.id = l.teacher_id
LEFT JOIN public.profiles a ON a.id = l.closed_by
WHERE l.status = 'closed';

-- 取消預約
INSERT INTO public.equipment_loan_events
  (loan_id, equipment_id, equipment_name, asset_number, teacher_id, teacher_name, action, detail, actor_name, created_at)
SELECT l.id, l.equipment_id, COALESCE(e.name, '（已刪除設備）'), COALESCE(e.asset_number, ''),
       l.teacher_id, COALESCE(p.name, p.email, ''), 'cancelled',
       CASE WHEN l.end_date IS NOT NULL AND l.end_date <> l.loan_date
            THEN l.loan_date::text || '～' || l.end_date::text ELSE l.loan_date::text END,
       COALESCE(p.name, p.email, ''), l.updated_at
FROM public.equipment_loans l
LEFT JOIN public.equipment e ON e.id = l.equipment_id
LEFT JOIN public.profiles p ON p.id = l.teacher_id
WHERE l.status = 'cancelled';
