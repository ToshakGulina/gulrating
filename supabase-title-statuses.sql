-- Add personal title statuses without deleting ratings.
-- Safe to run repeatedly. Status values are: watched, in_progress, dropped.
CREATE TABLE IF NOT EXISTS public.title_statuses (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title_id BIGINT REFERENCES public.titles(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('watched', 'in_progress', 'dropped')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, title_id)
);

ALTER TABLE public.title_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own title statuses" ON public.title_statuses;
CREATE POLICY "Users can read own title statuses" ON public.title_statuses
  FOR SELECT USING (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Users can insert own title statuses" ON public.title_statuses;
CREATE POLICY "Users can insert own title statuses" ON public.title_statuses
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Users can update own title statuses" ON public.title_statuses;
CREATE POLICY "Users can update own title statuses" ON public.title_statuses
  FOR UPDATE USING (auth.uid() = user_id AND public.is_approved())
  WITH CHECK (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Users can delete own title statuses" ON public.title_statuses;
CREATE POLICY "Users can delete own title statuses" ON public.title_statuses
  FOR DELETE USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.title_statuses TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'title_statuses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.title_statuses;
  END IF;
END $$;

-- Explicitly requested cleanup: delete only redundant watchlist entries for
-- the same user/title where an actual rating already exists. Ratings are kept.
DELETE FROM public.watchlist w
USING public.ratings r
WHERE w.user_id = r.user_id AND w.title_id = r.title_id;
