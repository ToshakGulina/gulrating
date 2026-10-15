// Рейтинг Кинопоиска через неофициальный API kinopoiskapiunofficial.tech.
//
// Почему неофициальный: официальный API Кинопоиска закрыт для физлиц,
// а прямой запрос из браузера к api.kinopoisk.ru блокируется отсутствием CORS.
// Сервис kinopoiskapiunofficial.tech выдаёт бесплатный токен (лимит ~200 запросов/сутки)
// и отвечает на запросы с заголовком X-API-KEY.
//
// Два режима работы:
// 1. Прямой: в config.js заполнен KINOPOISK_API_KEY — запросы идут из браузера.
// 2. Через прокси: заполнен KINOPOISK_PROXY_URL (Cloudflare Worker,
//    см. optional/proxy-worker.js, префикс /kp) — ключ лежит секретом в воркере,
//    а ответы дополнительно кэшируются на стороне Cloudflare (экономит лимит).
//
// Ошибки КП никогда не ломают карточку фильма: значок просто не показывается.

import { CONFIG } from '../config.js';

const USE_PROXY = Boolean(CONFIG.KINOPOISK_PROXY_URL);
const BASE = USE_PROXY
  ? CONFIG.KINOPOISK_PROXY_URL.replace(/\/+$/, '')
  : 'https://kinopoiskapiunofficial.tech';

// Кэш на сессию: повторное открытие карточки не тратит лимит запросов
const cache = new Map();

export function kinopoiskConfigured() {
  return USE_PROXY || Boolean(CONFIG.KINOPOISK_API_KEY);
}

function headers() {
  // Через прокси ключ подставляет воркер из секретов
  if (USE_PROXY) return {};
  return CONFIG.KINOPOISK_API_KEY ? { 'X-API-KEY': CONFIG.KINOPOISK_API_KEY } : {};
}

// Год из поля ответа (бывает строкой вида "1999" или "1999 - 2001")
function itemYear(item) {
  const parsed = parseInt(String(item && item.year || '').slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// Защитный разбор рейтинга: поля могут приходить строкой или числом
function extractRating(item) {
  if (!item) return null;
  const candidates = [item.ratingKinopoisk, item.rating, item.kinopoiskRating];
  for (const value of candidates) {
    const n = Number(String(value).replace(',', '.'));
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
      const res = await fetch(`${BASE}/api/v2.2/films?searchQuery=${encodeURIComponent(query)}`, {
        headers: headers(),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!res.ok) {
        // 401/403 — проблема с ключом, 429 — исчерпан дневной лимит
        if (res.status === 429) console.warn('Кинопоиск: исчерпан дневной лимит запросов токена');
        continue;
      }

      const data = await res.json();
      const items = data.items || data.results || [];
      if (!Array.isArray(items) || items.length === 0) continue;

      const yearNum = Number(year);
      const matched = (Number.isFinite(yearNum) && yearNum > 1000)
        ? (items.find(i => {
            const iy = itemYear(i);
            return iy !== null && Math.abs(iy - yearNum) <= 1;
          }) || items[0])
        : items[0];

      result = extractRating(matched);
      if (result !== null) break;
    } catch (e) {
      // CORS/сеть/формат ответа — молча пропускаем, КП опционален
      console.warn('Кинопоиск: запрос не удался', e && e.message);
      continue;
    }
  }

  cache.set(cacheKey, result);
  return result;
}
