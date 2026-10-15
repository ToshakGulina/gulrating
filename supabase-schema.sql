-- Схема базы данных для приложения оценки фильмов
-- Запустите этот скрипт в SQL Editor вашего проекта Supabase

-- Включаем расширение для генерации UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Таблица профилей пользователей
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT false,
  is_approved BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Автоматическое создание профиля при регистрации пользователя
CREATE FUNCTION public.handle_new_user()
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
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Таблица с тайтлами (фильмы/сериалы)
CREATE TABLE titles (
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

-- 3. Таблица с оценками пользователей
CREATE TABLE ratings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title_id BIGINT REFERENCES titles(id) ON DELETE CASCADE NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 10),
  comment TEXT,
  tags TEXT[] DEFAULT '{}'::text[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(user_id, title_id) -- Один пользователь может поставить только одну оценку на фильм
);

-- 4. Таблица со списком "Хочу посмотреть"
CREATE TABLE watchlist (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title_id BIGINT REFERENCES titles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(user_id, title_id)
);

-- Включаем Row Level Security (пользователи видят только данные своего круга)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

-- Политики доступа (только одобренные пользователи могут пользоваться приложением)
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_approved = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Профили: одобренные пользователи видят все профили, редактировать можно только свой, не одобренные видят только свой профиль
CREATE POLICY "Пользователи видят профиль до одобрения" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Одобренные пользователи видят все профили" ON profiles FOR SELECT USING (public.is_approved());
CREATE POLICY "Пользователь может редактировать свой профиль" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Админы могут одобрять пользователей" ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
) WITH CHECK (true);

-- Тайтлы: все одобренные пользователи могут смотреть и добавлять тайтлы
CREATE POLICY "Тайтлы видны одобренным" ON titles FOR SELECT USING (public.is_approved());
CREATE POLICY "Одобренные могут добавлять тайтлы" ON titles FOR INSERT WITH CHECK (public.is_approved());

-- Оценки: одобренные видят все оценки, добавлять/редактировать/удалять можно только свои
CREATE POLICY "Оценки видны одобренным" ON ratings FOR SELECT USING (public.is_approved());
CREATE POLICY "Одобренные могут добавлять свои оценки" ON ratings FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_approved());
CREATE POLICY "Пользователи могут редактировать свои оценки" ON ratings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Пользователи могут удалять свои оценки" ON ratings FOR DELETE USING (auth.uid() = user_id);

-- Watchlist: одобренные видят все списки, редактирует только свой
CREATE POLICY "Списки желаемого видны одобренным" ON watchlist FOR SELECT USING (public.is_approved());
CREATE POLICY "Одобренные могут добавлять в свой список" ON watchlist FOR INSERT WITH CHECK (auth.uid() = user_id AND public.is_approved());
CREATE POLICY "Пользователи могут удалять из своего списка" ON watchlist FOR DELETE USING (auth.uid() = user_id);

-- Включаем реалтайм синхронизацию оценок
ALTER PUBLICATION supabase_realtime ADD TABLE ratings;
ALTER PUBLICATION supabase_realtime ADD TABLE watchlist;
