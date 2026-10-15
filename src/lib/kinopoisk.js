// Рейтинг Кинопоиска через API ПоискКино (poiskkino.dev, версия v1.5).
// Токен выдаёт телеграм-бот @poiskkinodev_bot, документация: poiskkino.dev/documentation.
//
// Почему неофициальный: официальный API Кинопоиска закрыт для физлиц,
// а прямые запросы из браузера к кинопoisk-сервисам часто упираются в CORS.
// Поэтому клиент пробует несколько баз по порядку, пока не получит ответ:
//   1. CONFIG.KINOPOISK_PROXY_URL — внешний Cloudflare Worker (optional/proxy-worker.js);
//   2. '/kp' на собственном домене — Pages Functions (functions/kp/[[path]].js),
//      работает автоматически после деплоя на Cloudflare Pages и кэширует
//      ответы на сутки на стороне Cloudflare (экономит лимит токена);
//   3. прямой запрос к сервису с заголовком X-API-KEY — сработает, если
//      сервис отдаёт CORS (например, в локальном предпросмотре).
//
// Токен лежит в src/config.js (KINOPOISK_API_KEY); на бесплатном тарифе действуют
// лимиты демо-доступа, поэтому ответы кэшируются и в браузере, и на прокси.
// Дополнительно результаты кэшируются в браузере на сессию.
// Любая ошибка КП не ломает карточку фильма: значок просто не показывается.

import { CONFIG } from '../config.js';

const DIRECT_BASE = 'https://api.poiskkino.dev';

// Кэш на сессию: повторное открытие карточки не тратит лимит запросов
const cache = new Map();

export function kinopoiskConfigured() {
  return Boolean(CONFIG.KINOPOISK_API_KEY) || Boolean(CONFIG.KINOPOISK_PROXY_URL);
}

function baseList() {
  const list = [];
  if (CONFIG.KINOPOISK_PROXY_URL) {
    list.push({ base: CONFIG.KINOPOISK_PROXY_URL.replace(/\/+$/, ''), sendKey: false });
  }
  list.push({ base: '/kp', sendKey: false });      // свой домен (Pages Functions)
  list.push({ base: DIRECT_BASE, sendKey: true }); // напрямую, если есть CORS
  return list;
}

function headersFor(sendKey) {
  return sendKey && CONFIG.KINOPOISK_API_KEY
    ? { 'X-API-KEY': CONFIG.KINOPOISK_API_KEY }
    : {};
}

// Год из поля ответа (бывает строкой вида "1999" или "1999 - 2001")
function itemYear(item) {
  const parsed = parseInt(String((item && item.year) || '').slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// Защитный разбор рейтинга: поля могут приходить строкой или числом
function extractRating(item) {
  if (!item) return null;
  const candidates = [item.rating && item.rating.kp, item.ratingKinopoisk, item.kinopoiskRating];
  for (const value of candidates) {
    const n = Number(String(value).replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
  }
  return null;
}

async function fetchItems(base, sendKey, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/v1.5/movie/search?query=${encodeURIComponent(query)}`, {
      headers: headersFor(sendKey),
      signal: controller.signal
    });
    if (res.status === 429) console.warn('Кинопоиск: исчерпан дневной лимит запросов токена');
    if (!res.ok) return { ok: false, items: [] };
    const data = await res.json();
    // v1.5 отдаёт массив docs; старые схемы — items/results
    const items = data.docs || data.items || data.results || [];
    return { ok: true, items: Array.isArray(items) ? items : [] };
  } finally {
    clearTimeout(timer);
  }
}

// Ищем рейтинг Кинопоиска по названию и году. Возвращает число или null.
export async function getKinopoiskRating(title, originalTitle, year) {
  if (!kinopoiskConfigured() || !title) return null;

  const cacheKey = `${title}|${year || ''}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const queries = [title];
  if (originalTitle && originalTitle !== title) queries.push(originalTitle);
  const yearNum = Number(year);

  let result = null;

  for (const { base, sendKey } of baseList()) {
    let reachable = false;
    for (const query of queries) {
      let answer;
      try {
        answer = await fetchItems(base, sendKey, query);
      } catch (e) {
        // сеть/CORS/таймаут — пробуем следующую базу
        continue;
      }
      if (!answer.ok) continue;

      reachable = true;
      const matched = (Number.isFinite(yearNum) && yearNum > 1000)
        ? (answer.items.find(i => {
            const iy = itemYear(i);
            return iy !== null && Math.abs(iy - yearNum) <= 1;
          }) || answer.items[0])
        : answer.items[0];

      result = extractRating(matched);
      if (result !== null) break;
    }
    // Сервис ответил (даже без рейтинга) — дальше базы не пробуем, бережём лимит
    if (reachable || result !== null) break;
  }

  cache.set(cacheKey, result);
  return result;
}
