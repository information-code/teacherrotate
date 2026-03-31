-- 新增工作學期欄位至 rotations 表
-- 三個值：上學期 / 下學期 / 全學年，預設全學年
-- 若是上學期或下學期，本年積分 ÷ 2（由 score-engine 處理）

ALTER TABLE public.rotations
  ADD COLUMN semester TEXT NOT NULL DEFAULT '全學年'
  CHECK (semester IN ('上學期', '下學期', '全學年'));
