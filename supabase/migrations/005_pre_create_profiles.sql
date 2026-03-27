-- ============================================================
-- 005: 允許管理者預先建立教師 profile（不需先登入）
-- ============================================================

-- 移除 profiles.id 對 auth.users 的 FK 約束
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- profiles.email 需要唯一（用來在登入時比對）
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);

-- 子資料表加上 ON UPDATE CASCADE
-- 這樣當 profile.id 從管理者建立的 UUID 更新為真實 auth UUID 時，子表自動跟著更新

ALTER TABLE public.preferences
  DROP CONSTRAINT IF EXISTS preferences_teacher_id_fkey,
  ADD CONSTRAINT preferences_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.rotations
  DROP CONSTRAINT IF EXISTS rotations_teacher_id_fkey,
  ADD CONSTRAINT rotations_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.scores
  DROP CONSTRAINT IF EXISTS scores_teacher_id_fkey,
  ADD CONSTRAINT scores_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 移除 whitelist 表（不再需要）
DROP TABLE IF EXISTS public.teacher_whitelist;

-- 修改 trigger：只在 email 已有對應 profile 時，更新其 id 為真實 auth UUID
-- （管理者已預先建立 profile，登入時只需接上）
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET id = NEW.id
  WHERE email = NEW.email
    AND id != NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
