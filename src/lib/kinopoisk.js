// Опциональная интеграция с рейтингом Кинопоиска.
//
// Нюансы, почему это опция, а не «из коробки»:
// 1. У Кинопоиска нет открытого бесплатного API без ключа: нужен ключ
//    «API Кинопоиска» (api.kinopoisk.ru, выдаётся через Яндекс Cloud,
//    для некоммерческого использования бесплатный).
// 2. api.kinopoisk.ru не отдаёт CORS-заголовки для браузера, поэтому прямой
//    запрос из страницы обычно блокируется. Рабочий способ — проксировать
//    через Cloudflare Worker (см. optional/proxy-worker.js): ключ лежит
//    секретом в воркере, браузер ходит в свой воркер.
//
// Если ничего не настроено — приложение просто не показывает значок КП,
// всё остальное работает как раньше. Ошибки КП никогда не ломают карточку.

import { CONFIG } from '../config.js';

const USE_PROXY = Boolean(CONFIG.KINOPOISK_PROXY_URL);
const BASE = USE_PROXY
  ? CONFIG.KINOPOISK_PROXY_URL.replace(/\/+$/, '')
  : 'https://api.kinopoisk.ru';

const cache = new Map();

export function kinopoiskConfigured() {
  return USE_PROXY || Boolean(CONFIG.KINOPOISK_API_KEY);
}

function headers() {
  // Через прокси ключ подставляет воркер из секретов
  if (USE_PROXY) return {};
  return CONFIG.KINOPOISK_API_KEY ? { 'X-API-KEY': CONFIG.KINOPOISK_API_KEY } : {};
}

// Защитный разбор ответа: у разных версий API поле рейтинга лежит по-разному
function extractRating(movie) {
  if (!movie) return null;
  const candidates = [
    movie.ratingKinopoisk,
    movie.rating && movie.rating.kp,
    movie.rating && movie.rating.kinopoisk,
    movie.kinopoiskRating,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
  }
  return null;
}

// Ищем рейтинг Кинопоиска по названию и году. Возвращает число или null.
export async function getKinopoiskRating(title, originalTitle, year) {
  if (!kinopoiskConfigured() || !title) return null;

  const cacheKey = `${title}|${year || ''}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const queries = [title];
  if (originalTitle && originalTitle !== title) queries.push(originalTitle);

  let result = null;
  for (const query of queries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${BASE}/v1/search?query=${encodeURIComponent(query)}&page=1`, {
        headers: headers(),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = await res.json();
      const movies = (data.docs || []).map(doc => doc.movie).filter(Boolean);
      if (movies.length === 0) continue;

      const yearNum = Number(year);
      const matched = (Number.isFinite(yearNum) && yearNum > 1000)
        ? (movies.find(m => Math.abs(Number(m.year) - yearNum) <= 1) || movies[0])
        : movies[0];

      result = extractRating(matched);
      if (result !== null) break;
    } catch (e) {
      // CORS/сеть/формат ответа — молча пропускаем, КП опционален
      continue;
    }
  }

  cache.set(cacheKey, result);
  return result;
}
