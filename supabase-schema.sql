-- ============================================================================
-- Схема базы данных для приложения «Кино для друзей» (GulRating)
-- Запустите этот скрипт ЦЕЛИКОМ в SQL Editor вашего проекта Supabase.
--
-- Скрипт идемпотентный: его можно запускать повторно, уже созданные объекты
-- не сломаются (используются IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS).
-- ============================================================================

-- Включаем расширение для генерации UUID (если ещё не включено)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Таблица профилей пользователей
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT false,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Автоматическое создание профиля при регистрации пользователя.
-- Первый зарегистрированный пользователь становится админом и сразу одобрен.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  INSERT INTO public.profiles (id, username, is_admin, is_approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    user_count = 0, -- Первый пользователь становится админом
    user_count = 0  -- Первый пользователь автоматически одобрен
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. Таблица с тайтлами (фильмы/сериалы)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.titles (
  id BIGINT PRIMARY KEY, -- ID из TMDB
  title TEXT NOT NULL,
  original_title TEXT,
  release_date DATE,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
  tmdb_rating NUMERIC(3,1),
  imdb_rating NUMERIC(3,1),
  genres JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- ----------------------------------------------------------------------------
-- 3. Таблица с оценками пользователей
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ratings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title_id BIGINT REFERENCES public.titles(id) ON DELETE CASCADE NOT NULL,
  -- NUMERIC(3,1): оценка с точностью до десятых (7.5, 8.3) — слайдер в интерфейсе
  rating NUMERIC(3,1) NOT NULL CHECK (rating BETWEEN 1 AND 10),
  comment TEXT,
  tags TEXT[] DEFAULT '{}'::text[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(user_id, title_id) -- Один пользователь — одна оценка на тайтл
);

-- ----------------------------------------------------------------------------
-- 4. Таблица со списком «Хочу посмотреть»
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.watchlist (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title_id BIGINT REFERENCES public.titles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(user_id, title_id)
);

-- Дополнительные личные статусы. «Хочу посмотреть» остаётся в watchlist,
-- а «Просмотрено» также может определяться сохранённой оценкой.
CREATE TABLE IF NOT EXISTS public.title_statuses (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title_id BIGINT REFERENCES public.titles(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('watched', 'in_progress', 'dropped')),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, title_id)
);

-- Удаляем только дубли: если конкретный пользователь уже оценил тот же тайтл,
-- его собственная запись не должна оставаться в «Хочу посмотреть».
DELETE FROM public.watchlist w
USING public.ratings r
WHERE w.user_id = r.user_id AND w.title_id = r.title_id;

-- Миграция для баз, созданных старыми версиями схемы: оценки были SMALLINT,
-- теперь допускаем десятые доли. Повторный запуск безопасен (тип уже такой).
ALTER TABLE public.ratings ALTER COLUMN rating TYPE NUMERIC(3,1);

-- Индексы для быстрых выборок ленты и карточки фильма
CREATE INDEX IF NOT EXISTS idx_ratings_created_at ON public.ratings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_title_id ON public.ratings (title_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON public.ratings (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON public.watchlist (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_title_id ON public.watchlist (title_id);

-- ----------------------------------------------------------------------------
-- Row Level Security: посторонние не видят данные вашего круга
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.title_statuses ENABLE ROW LEVEL SECURITY;

-- Проверка «пользователь одобрен админом». SECURITY DEFINER, чтобы функцию
-- можно было вызывать из политик без рекурсии по RLS.
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_approved = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Количество профилей в обход RLS (нужно политике INSERT, см. ниже).
-- SECURITY DEFINER обязателен: обычный подselect внутри политики видел бы
-- только строки, разрешённые самому пользователю, и всегда возвращал бы 0.
CREATE OR REPLACE FUNCTION public.profile_count()
RETURNS BIGINT AS $$
  SELECT COUNT(*) FROM public.profiles;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Профили
DROP POLICY IF EXISTS "Пользователи видят профиль до одобрения" ON public.profiles;
CREATE POLICY "Пользователи видят профиль до одобрения" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Одобренные пользователи видят все профили" ON public.profiles;
CREATE POLICY "Одобренные пользователи видят все профили" ON public.profiles
  FOR SELECT USING (public.is_approved());

DROP POLICY IF EXISTS "Пользователь может редактировать свой профиль" ON public.profiles;
CREATE POLICY "Пользователь может редактировать свой профиль" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Админы могут одобрять пользователей" ON public.profiles;
CREATE POLICY "Админы могут одобрять пользователей" ON public.profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  ) WITH CHECK (true);

-- Пользователь может сам создать СВОЙ профиль, если триггер не сработал
-- (аккаунт появился до запуска схемы). Права при этом ограничены:
-- обычный пользователь не может выдать себе админа или одобрение,
-- исключением является самый первый профиль в пустой базе — он, как и в
-- триггере, становится админом и сразу одобрен.
DROP POLICY IF EXISTS "Пользователь может создать свой профиль" ON public.profiles;
CREATE POLICY "Пользователь может создать свой профиль" ON public.profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND (
      public.profile_count() = 0
      OR (is_admin = false AND is_approved = false)
    )
  );

-- Защита привилегий: не-админ не может повысить себя через UPDATE своего
-- профиля (is_admin / is_approved всегда возвращаются к старым значениям).
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  -- Служебные изменения из SQL Editor / сервисных роли (без JWT) не трогаем
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RETURN NEW; -- администратор может менять всё
  END IF;
  NEW.is_admin := OLD.is_admin;
  NEW.is_approved := OLD.is_approved;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_profile_privileges ON public.profiles;
CREATE TRIGGER protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- Тайтлы: одобренные пользователи читают и добавляют тайтлы.
-- UPDATE нужен, потому что приложение сохраняет фильм через upsert
-- (ON CONFLICT DO UPDATE) — без этой политики повторное добавление
-- уже существующего фильма упало бы с ошибкой RLS.
DROP POLICY IF EXISTS "Тайтлы видны одобренным" ON public.titles;
CREATE POLICY "Тайтлы видны одобренным" ON public.titles
  FOR SELECT USING (public.is_approved());

DROP POLICY IF EXISTS "Одобренные могут добавлять тайтлы" ON public.titles;
CREATE POLICY "Одобренные могут добавлять тайтлы" ON public.titles
  FOR INSERT WITH CHECK (public.is_approved());

DROP POLICY IF EXISTS "Одобренные могут обновлять тайтлы" ON public.titles;
CREATE POLICY "Одобренные могут обновлять тайтлы" ON public.titles
  FOR UPDATE USING (public.is_approved()) WITH CHECK (public.is_approved());

-- Оценки: одобренные видят все оценки, изменяют только свои
DROP POLICY IF EXISTS "Оценки видны одобренным" ON public.ratings;
CREATE POLICY "Оценки видны одобренным" ON public.ratings
  FOR SELECT USING (public.is_approved());

DROP POLICY IF EXISTS "Одобренные могут добавлять свои оценки" ON public.ratings;
CREATE POLICY "Одобренные могут добавлять свои оценки" ON public.ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Пользователи могут редактировать свои оценки" ON public.ratings;
CREATE POLICY "Пользователи могут редактировать свои оценки" ON public.ratings
  FOR UPDATE USING (auth.uid() = user_id AND public.is_approved())
  WITH CHECK (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Пользователи могут удалять свои оценки" ON public.ratings;
CREATE POLICY "Пользователи могут удалять свои оценки" ON public.ratings
  FOR DELETE USING (auth.uid() = user_id);

-- Watchlist: одобренные видят все списки, изменяют только свой.
-- UPDATE политика обязательна: добавление в watchlist работает через upsert.
DROP POLICY IF EXISTS "Списки желаемого видны одобренным" ON public.watchlist;
CREATE POLICY "Списки желаемого видны одобренным" ON public.watchlist
  FOR SELECT USING (public.is_approved());

DROP POLICY IF EXISTS "Одобренные могут добавлять в свой список" ON public.watchlist;
CREATE POLICY "Одобренные могут добавлять в свой список" ON public.watchlist
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Пользователи могут обновлять свой watchlist" ON public.watchlist;
CREATE POLICY "Пользователи могут обновлять свой watchlist" ON public.watchlist
  FOR UPDATE USING (auth.uid() = user_id AND public.is_approved())
  WITH CHECK (auth.uid() = user_id AND public.is_approved());

DROP POLICY IF EXISTS "Пользователи могут удалять из своего списка" ON public.watchlist;
CREATE POLICY "Пользователи могут удалять из своего списка" ON public.watchlist
  FOR DELETE USING (auth.uid() = user_id);

-- Статусы видны и изменяются только владельцем.
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

-- ----------------------------------------------------------------------------
-- Права доступа ролей Supabase к таблицам.
--
-- ВАЖНО: в новых проектах Supabase таблицы, созданные через SQL Editor,
-- по умолчанию НЕ доступны ролям anon/authenticated на уровне привилегий
-- (ошибка "permission denied for table ..."), даже если RLS настроен верно.
-- RLS по-прежнему ограничивает строки, поэтому выдача табличных прав безопасна:
-- не одобренный пользователь не увидит ничего благодаря политикам выше.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- То же самое для таблиц, которые появятся в будущем
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Реалтайм синхронизация оценок и списков
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ratings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ratings;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'watchlist'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.watchlist;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'title_statuses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.title_statuses;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- СЛУЖЕБНАЯ ФУНКЦИЯ: чинит профили пользователей, которые зарегистрировались
-- ДО запуска этой схемы (триггер тогда ещё не существовал и профиль не создался).
-- Запускать только при необходимости:  SELECT public.repair_missing_profiles();
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repair_missing_profiles()
RETURNS INT AS $$
DECLARE
  inserted INT;
BEGIN
  INSERT INTO public.profiles (id, username, is_admin, is_approved)
  SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
    false,
    false
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p.id IS NULL
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;

  -- Если после починки в базе остался ровно один пользователь, делаем его админом
  UPDATE public.profiles
  SET is_admin = true, is_approved = true
  WHERE (SELECT COUNT(*) FROM public.profiles) = 1;

  RETURN inserted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
