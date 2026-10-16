-- Одноразовая миграция: кросс-устройственная синхронизация личных настроек и истории.
-- Выполнить в Supabase Dashboard → SQL Editor → New query → Run.
-- Повторный запуск безопасен.

CREATE TABLE IF NOT EXISTS public.user_sync (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Пользователь читает свою синхронизацию" ON public.user_sync;
CREATE POLICY "Пользователь читает свою синхронизацию" ON public.user_sync
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Пользователь создаёт свою синхронизацию" ON public.user_sync;
CREATE POLICY "Пользователь создаёт свою синхронизацию" ON public.user_sync
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Пользователь обновляет свою синхронизацию" ON public.user_sync;
CREATE POLICY "Пользователь обновляет свою синхронизацию" ON public.user_sync
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_sync TO authenticated;
