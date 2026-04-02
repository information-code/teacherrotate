-- 新增教師積分確認欄位
ALTER TABLE public.profiles
  ADD COLUMN score_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN score_confirmed_at timestamptz NULL;
