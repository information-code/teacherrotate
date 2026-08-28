-- ============================================================
-- 043: 超鐘簽到——每人每計畫的超鐘點區間
--      老師不一定整個計畫期程都超鐘點，可設多段日期區間；
--      產出簽到表／計節數時只算落在區間內的日子。
--      ranges JSONB：[{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, ...]
--      空陣列＝整個計畫期程。
-- ============================================================

ALTER TABLE public.overtime_teachers
  ADD COLUMN IF NOT EXISTS ranges JSONB NOT NULL DEFAULT '[]';
