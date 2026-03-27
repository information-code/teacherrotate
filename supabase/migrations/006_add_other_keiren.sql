-- ============================================================
-- 006: 新增「其他領域科任」職務（分數比照科任，不開放志願填寫）
-- ============================================================

INSERT INTO public.scoremap (work, year1, year2, year3, year4, year5, year6, year7, year8, group_name, sort_order)
VALUES ('其他領域科任', 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, NULL, 47)
ON CONFLICT (work) DO NOTHING;
