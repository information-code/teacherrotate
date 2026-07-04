-- ============================================================
-- 026: 帳號換綁（id 交換）資料完整性 ＋ 虛擬（待聘）帳號支援
--
-- 背景：管理者預建 profile（隨機 UUID），老師第一次登入時 trigger 把
-- profiles.id 改為真實 auth UUID。原本只有 preferences/rotations/scores
-- 有 ON UPDATE CASCADE；allocation 沒有（id 交換會直接違反 FK 導致登入失敗），
-- 而 schedule_config / schedule_plan / selection_panel 的教師引用存在 JSON 裡，
-- FK 管不到 → 換綁後配班、排課、撕榜引用全部斷鏈。
--
-- 此 migration：
--   1. allocation FK 補 ON UPDATE CASCADE
--   2. relink_profile_refs(old,new)：以 UUID 文字替換同步三張 JSON 表
--      （UUID 具唯一性，文字替換安全）
--   3. handle_new_user trigger 換綁後呼叫 relink
--
-- 虛擬帳號本身不需 schema：以占位 email（*@virtual.local）表示，
-- 轉正＝把 email 改成真實信箱，老師登入即自動換綁。
-- ============================================================

-- 1) allocation FK 補 ON UPDATE CASCADE
ALTER TABLE public.allocation
  DROP CONSTRAINT IF EXISTS allocation_teacher_id_fkey;
ALTER TABLE public.allocation
  ADD CONSTRAINT allocation_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.profiles(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) JSON 引用同步
CREATE OR REPLACE FUNCTION public.relink_profile_refs(old_id UUID, new_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.schedule_config
  SET config = replace(config::text, old_id::text, new_id::text)::jsonb
  WHERE config::text LIKE '%' || old_id::text || '%';

  UPDATE public.schedule_plan
  SET plan = replace(plan::text, old_id::text, new_id::text)::jsonb
  WHERE plan::text LIKE '%' || old_id::text || '%';

  UPDATE public.selection_panel
  SET data = replace(data::text, old_id::text, new_id::text)::jsonb
  WHERE data::text LIKE '%' || old_id::text || '%';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) 換綁 trigger：id 交換（FK cascade 處理關聯表）後同步 JSON 引用
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  old_profile_id UUID;
BEGIN
  SELECT id INTO old_profile_id
  FROM public.profiles
  WHERE email = NEW.email AND id != NEW.id;

  IF old_profile_id IS NOT NULL THEN
    UPDATE public.profiles SET id = NEW.id WHERE id = old_profile_id;
    PERFORM public.relink_profile_refs(old_profile_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
