-- ============================================================================
-- SupaJournal — schema and storage setup
-- ============================================================================
-- Apply against a fresh Supabase project. Designed for Postgres 15+.
-- See README.md for the full setup walkthrough.
-- ============================================================================

-- 1. Schema --------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  body text NOT NULL,
  mood smallint CHECK (mood BETWEEN 1 AND 5),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  image_paths text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entries_user_id_idx ON public.entries(user_id);
CREATE INDEX entries_user_date_idx ON public.entries(user_id, entry_date DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER entries_set_updated_at
  BEFORE UPDATE ON public.entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Row Level Security --------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries  FORCE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "entries_select_own" ON public.entries
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "entries_insert_own" ON public.entries
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "entries_update_own" ON public.entries
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "entries_delete_own" ON public.entries
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entries  TO authenticated;

-- 3. Storage bucket + RLS ------------------------------------------------------
-- The bucket itself: insert a row into storage.buckets. The host's
-- Supabase Management API usually doesn't expose a /buckets endpoint, so
-- this is the most portable way to create one.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'journal-images',
  'journal-images',
  false,
  10485760,                  -- 10 MB per file
  ARRAY['image/jpeg','image/png','image/gif','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- storage.objects already has RLS enabled by the platform. Add the
-- per-user policies so each user can only read/write/delete files
-- inside their own folder (`<user_id>/...`).

CREATE POLICY "journal_images_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'journal-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "journal_images_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'journal-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "journal_images_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'journal-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'journal-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "journal_images_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'journal-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Auth settings -------------------------------------------------------------
-- For self-contained dev/test projects, set mailer_autoconfirm = true so
-- signups succeed without an email round-trip. In production, leave it
-- on (default) so users confirm via email.
--
-- PATCH /v1/projects/{ref}/config/auth
--   { "mailer_autoconfirm": true }
-- ============================================================================
