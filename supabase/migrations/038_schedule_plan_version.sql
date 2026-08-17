-- ============================================================
-- 038: 排課版本紀錄（schedule_plan_version）
--      schedule_plan 是「目前採用的那一份」（PK = year，存新的蓋掉舊的）；
--      這張表把每次排課的結果留成一份快照，讓課務組跑了三次之後還找得回第一次的結果。
--      僅由 service-role（API）讀寫，比照 schedule_plan。
--
--      weights：產生當下的權重設定。罰分數字離開權重無法解讀
--               （同樣「走動成本 233」在權重「中」與「高」下意義不同），故必須一起存。
--      base_hash：配課／課表格／鎖課／必排格的指紋。基礎資料變過的兩份不能做逐格比對
--                 （課本身就不一樣了），未來的比對頁靠這個欄位擋下來。
--      summary：摘要指標（未排／必須級／軟分／各規則計數）。版本清單只讀這欄，
--               不必把整份 plan（約 150～250KB）載回前端。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schedule_plan_version (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year       INTEGER NOT NULL,
  label      TEXT,                                    -- 課務組自取的名稱（未取＝顯示時間）
  starred    BOOLEAN NOT NULL DEFAULT FALSE,          -- 加星號＝不受保留上限自動刪除
  source     TEXT NOT NULL DEFAULT 'engine',          -- 'engine'＝精靈跑出來的；'manual'＝手動微調後儲存的
  base_hash  TEXT NOT NULL DEFAULT '',
  summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights    JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_spv_year_created
  ON public.schedule_plan_version (year, created_at DESC);

ALTER TABLE public.schedule_plan_version ENABLE ROW LEVEL SECURITY;
