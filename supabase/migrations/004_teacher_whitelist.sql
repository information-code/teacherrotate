-- ============================================================
-- 004: 教師登入白名單
-- ============================================================

-- 白名單：管理者預先建立，控制誰可以登入系統
CREATE TABLE public.teacher_whitelist (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS：只允許 admin/superadmin 透過 service role 操作
ALTER TABLE public.teacher_whitelist ENABLE ROW LEVEL SECURITY;

-- 修改 handle_new_user trigger：只有 email 在白名單才建立 profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  SELECT
    NEW.id,
    NEW.email,
    w.name,
    'teacher'
  FROM public.teacher_whitelist w
  WHERE w.email = NEW.email
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
