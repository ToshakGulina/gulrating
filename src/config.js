// Конфигурация приложения.
//
// ВАЖНО ПРО БЕЗОПАСНОСТЬ КЛЮЧЕЙ:
// - SUPABASE_ANON_KEY — это публичный ("anon") ключ Supabase, его и предполагается
//   держать в клиентском коде. Реальный доступ к данным ограничивают политики RLS
//   в базе (см. supabase-schema.sql), а не секретность ключа.
// - TMDB_API_KEY — обычный ключ чтения базы фильмов, как в любом клиентском приложении.
//
// Если какой-то ключ не заполнен, приложение покажет экран-подсказку (components/Setup.js),
// а не упадёт с пустым белым экраном.

export const CONFIG = {
  // Supabase
  SUPABASE_URL: "https://ahpgxyfkbvuabgtrgacu.supabase.co",
  SUPABASE_ANON_KEY: "ВСТАВЬТЕ_ANON_KEY_ИЗ_SUPABASE",

  // TMDb
  TMDB_API_KEY: "d39e2fce46e85938f7a896c767301d28",
  TMDB_IMG_BASE: "https://image.tmdb.org/t/p/w500",
  TMDB_IMG_BACKDROP_BASE: "https://image.tmdb.org/t/p/w1280",

  // ОПЦИОНАЛЬНО: адрес прокси TMDb через Cloudflare Worker (см. optional/tmdb-proxy-worker.js).
  // Оставьте пустым, если api.themoviedb.org открывается напрямую.
  // Пример: "https://tmdb-proxy.ваш-логин.workers.dev"
  TMDB_PROXY_URL: "",

  // Настройки приложения
  APP_NAME: "Кино для друзей",
  RATING_SCALE_MAX: 10,
};

// Проверяем, что все ключи заполнены (без плейсхолдеров)
export function configIsComplete() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, TMDB_API_KEY } = CONFIG;
  if (!SUPABASE_URL || !/^https?:\/\//.test(SUPABASE_URL)) return false;
  if (!SUPABASE_ANON_KEY || /ВАШ_|ВСТАВЬТЕ/.test(SUPABASE_ANON_KEY) || SUPABASE_ANON_KEY.length < 20) return false;
  if (!TMDB_API_KEY || /ВАШ_|ВСТАВЬТЕ/.test(TMDB_API_KEY) || TMDB_API_KEY.length < 10) return false;
  return true;
}

// Список незаполненных полей — для экрана-подсказки
export function missingConfigFields() {
  const missing = [];
  if (!CONFIG.SUPABASE_URL || !/^https?:\/\//.test(CONFIG.SUPABASE_URL)) missing.push('SUPABASE_URL');
  if (!CONFIG.SUPABASE_ANON_KEY || /ВАШ_|ВСТАВЬТЕ/.test(CONFIG.SUPABASE_ANON_KEY) || CONFIG.SUPABASE_ANON_KEY.length < 20) missing.push('SUPABASE_ANON_KEY');
  if (!CONFIG.TMDB_API_KEY || /ВАШ_|ВСТАВЬТЕ/.test(CONFIG.TMDB_API_KEY) || CONFIG.TMDB_API_KEY.length < 10) missing.push('TMDB_API_KEY');
  return missing;
}
