-- ============================================================
-- 002: Row Level Security 政策
-- ============================================================

ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoremap    ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- profiles
-- ============================================================
CREATE POLICY "profiles: 教師讀取自己"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles: admin 讀取所有"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "profiles: 自己更新自己"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "profiles: admin 更新所有"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "profiles: 允許 insert 自己"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ============================================================
-- preferences
-- ============================================================
CREATE POLICY "preferences: 讀取自己"
  ON public.preferences FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "preferences: admin 讀取所有"
  ON public.preferences FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "preferences: 自己 insert"
  ON public.preferences FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "preferences: 自己 update"
  ON public.preferences FOR UPDATE
  USING (teacher_id = auth.uid());

-- ============================================================
-- rotations
-- ============================================================
CREATE POLICY "rotations: 讀取自己"
  ON public.rotations FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "rotations: admin 讀取所有"
  ON public.rotations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "rotations: admin 寫入"
  ON public.rotations FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "rotations: admin 更新"
  ON public.rotations FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "rotations: admin 刪除"
  ON public.rotations FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- scores
-- ============================================================
CREATE POLICY "scores: 讀取自己"
  ON public.scores FOR SELECT
  USING (teacher_id = auth.uid());

CREATE POLICY "scores: admin 讀取所有"
  ON public.scores FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "scores: admin 寫入"
  ON public.scores FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "scores: admin 更新"
  ON public.scores FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- scoremap（所有人可讀，admin 可寫）
-- ============================================================
CREATE POLICY "scoremap: 所有人讀"
  ON public.scoremap FOR SELECT
  USING (true);

CREATE POLICY "scoremap: admin 寫入"
  ON public.scoremap FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "scoremap: admin 更新"
  ON public.scoremap FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "scoremap: admin 刪除"
  ON public.scoremap FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
