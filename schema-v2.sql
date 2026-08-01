-- ============================================================================
-- SupaJournal v2 schema — multi-journal, tags, bookmarks, prompts, stats
-- ============================================================================
-- Run this against a project that already has v1 schema applied. All v1
-- tables/policies are kept; new columns are added with safe defaults so
-- existing rows remain valid.
-- ============================================================================

-- 1. New tables ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT '#6b8a5a',
  icon text NOT NULL DEFAULT '📔',
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journals_user_idx ON public.journals(user_id, sort_order);

CREATE TABLE IF NOT EXISTS public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS tags_user_name_idx ON public.tags(user_id, lower(name));

CREATE TABLE IF NOT EXISTS public.entry_tags (
  entry_id uuid NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS entry_tags_tag_idx ON public.entry_tags(tag_id);

CREATE TABLE IF NOT EXISTS public.prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS prompts_active_idx ON public.prompts(is_active, sort_order);

-- 2. Add columns to entries (defaults keep v1 rows valid) --------------------

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS journal_id uuid REFERENCES public.journals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_bookmarked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS weather text,
  ADD COLUMN IF NOT EXISTS word_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS entries_journal_idx ON public.entries(journal_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS entries_bookmarked_idx ON public.entries(user_id, entry_date DESC)
  WHERE is_bookmarked = true;
CREATE INDEX IF NOT EXISTS entries_user_entrydate_idx ON public.entries(user_id, entry_date DESC);

-- 3. Auto-create a default journal + profile on signup -------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
  INSERT INTO public.journals (user_id, name, icon, color, is_default, sort_order)
    VALUES (NEW.id, 'Daily', '📔', '#6b8a5a', true, 0);
  RETURN NEW;
END;
$$;

-- (Trigger already exists from v1; the updated function body takes effect.)

-- 4. RLS for new tables ------------------------------------------------------

ALTER TABLE public.journals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journals   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entry_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entry_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prompts    ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies (re-runnable)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('journals','tags','entry_tags','prompts')
      AND policyname LIKE '%_own' OR policyname = 'prompts_select_all'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname,
      CASE r.policyname
        WHEN 'journals_select_own' THEN 'journals'
        WHEN 'journals_insert_own' THEN 'journals'
        WHEN 'journals_update_own' THEN 'journals'
        WHEN 'journals_delete_own' THEN 'journals'
        WHEN 'tags_select_own' THEN 'tags'
        WHEN 'tags_insert_own' THEN 'tags'
        WHEN 'tags_update_own' THEN 'tags'
        WHEN 'tags_delete_own' THEN 'tags'
        WHEN 'entry_tags_select_own' THEN 'entry_tags'
        WHEN 'entry_tags_insert_own' THEN 'entry_tags'
        WHEN 'entry_tags_delete_own' THEN 'entry_tags'
        WHEN 'prompts_select_all' THEN 'prompts'
        ELSE 'unknown'
      END);
  END LOOP;
END $$;

CREATE POLICY journals_select_own ON public.journals
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY journals_insert_own ON public.journals
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY journals_update_own ON public.journals
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY journals_delete_own ON public.journals
  FOR DELETE USING (user_id = auth.uid() AND is_default = false);

CREATE POLICY tags_select_own ON public.tags
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY tags_insert_own ON public.tags
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY tags_update_own ON public.tags
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY tags_delete_own ON public.tags
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY entry_tags_select_own ON public.entry_tags
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.entries e
            WHERE e.id = entry_id AND e.user_id = auth.uid())
  );
CREATE POLICY entry_tags_insert_own ON public.entry_tags
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.entries e
            WHERE e.id = entry_id AND e.user_id = auth.uid())
  );
CREATE POLICY entry_tags_delete_own ON public.entry_tags
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.entries e
            WHERE e.id = entry_id AND e.user_id = auth.uid())
  );

-- Prompts: read-only for authenticated users. Writes happen via the
-- service_role (admin) so we don't expose a public insert path.
CREATE POLICY prompts_select_all ON public.prompts
  FOR SELECT TO authenticated USING (is_active = true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journals   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entry_tags TO authenticated;
GRANT SELECT                          ON public.prompts    TO authenticated;

-- 5. Seed prompts -------------------------------------------------------------

INSERT INTO public.prompts (text, category, sort_order) VALUES
  ('What''s one small thing you''re grateful for today?', 'gratitude', 10),
  ('What did you change your mind about recently, and why?', 'reflection', 20),
  ('Describe today in three sentences, as if to a friend.', 'reflection', 30),
  ('What''s something you''re looking forward to?', 'forward', 40),
  ('Who do you wish you could thank today, and what would you say?', 'gratitude', 50),
  ('What made you laugh today?', 'joy', 60),
  ('What''s been on your mind lately that you haven''t said out loud?', 'reflection', 70),
  ('If today had a soundtrack, what would be playing?', 'creative', 80),
  ('What did you learn this week that you didn''t know before?', 'growth', 90),
  ('Write a postcard from today to your future self, ten years from now.', 'creative', 100),
  ('What''s one kind thing you did for someone today?', 'kindness', 110),
  ('What''s a question you''re sitting with right now?', 'reflection', 120)
ON CONFLICT DO NOTHING;
