// Конфигурация приложения.
//
// ВАЖНО ПРО БЕЗОПАСНОСТЬ КЛЮЧЕЙ:
// - SUPABASE_ANON_KEY — это публичный ("anon") ключ Supabase, его и предполагается
//   держать в клиентском коде. Реальный доступ к данным ограничивают политики RLS
//   в базе (см. supabase-schema.sql), а не секретность ключа.
// - TMDB_API_KEY — обычный ключ чтения базы фильмов, как в любом клиентском приложении.
//
// Если ключ не заполнен, приложение покажет экран-подсказку (components/Setup.js),
// а не упадёт с пустым белым экраном. На этом экране ключ можно вставить прямо
// из браузера — он сохранится в localStorage ТОЛЬКО этого браузера (удобно для
// быстрого теста и предпросмотра). Для продакшена ключ нужно вписать сюда,
// в файл, чтобы он работал у всех друзей без дополнительных действий.

const LS_ANON_KEY = 'gulrating:supabase_anon_key';

function readStoredAnonKey() {
  try {
    return localStorage.getItem(LS_ANON_KEY) || '';
  } catch (e) {
    return '';
  }
}

const FILE_ANON_KEY = "ВСТАВЬТЕ_ANON_KEY_ИЗ_SUPABASE";
const storedAnonKey = readStoredAnonKey();

// Ключ из localStorage имеет приоритет над файлом (если он похож на настоящий)
export const ANON_KEY_SOURCE = (storedAnonKey && !/ВАШ_|ВСТАВЬТЕ/.test(storedAnonKey))
  ? 'localStorage'
  : 'config.js';

export const CONFIG = {
  // Supabase
  SUPABASE_URL: "https://ahpgxyfkbvuabgtrgacu.supabase.co",
  SUPABASE_ANON_KEY: ANON_KEY_SOURCE === 'localStorage' ? storedAnonKey : FILE_ANON_KEY,

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

export function saveLocalAnonKey(key) {
  try {
    localStorage.setItem(LS_ANON_KEY, key.trim());
  } catch (e) {
    // приватный режим и т.п. — просто не сохраняем
  }
}

export function clearLocalAnonKey() {
  try {
    localStorage.removeItem(LS_ANON_KEY);
  } catch (e) {
    // игнорируем
  }
}

function looksLikeKey(value) {
  return !!value && !/ВАШ_|ВСТАВЬТЕ/.test(value) && value.length >= 20;
}

// Проверяем, что все ключи заполнены (без плейсхолдеров)
export function configIsComplete() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, TMDB_API_KEY } = CONFIG;
  if (!SUPABASE_URL || !/^https?:\/\//.test(SUPABASE_URL)) return false;
  if (!looksLikeKey(SUPABASE_ANON_KEY)) return false;
  if (!TMDB_API_KEY || /ВАШ_|ВСТАВЬТЕ/.test(TMDB_API_KEY) || TMDB_API_KEY.length < 10) return false;
  return true;
}

// Список незаполненных полей — для экрана-подсказки
export function missingConfigFields() {
  const missing = [];
  if (!CONFIG.SUPABASE_URL || !/^https?:\/\//.test(CONFIG.SUPABASE_URL)) missing.push('SUPABASE_URL');
  if (!looksLikeKey(CONFIG.SUPABASE_ANON_KEY)) missing.push('SUPABASE_ANON_KEY');
  if (!CONFIG.TMDB_API_KEY || /ВАШ_|ВСТАВЬТЕ/.test(CONFIG.TMDB_API_KEY) || CONFIG.TMDB_API_KEY.length < 10) missing.push('TMDB_API_KEY');
  return missing;
}
