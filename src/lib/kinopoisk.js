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

// Долгий кэш на устройстве: рейтинг фильма не меняется на глазах, поэтому
// повторные открытия карточек неделями не трогают API вовсе.
// Срок настраивается ползунком в профиле (1–90 дней, по умолчанию 14).
const KP_DISK_KEY = 'gulrating:kp_cache';
const KP_DISK_MAX = 300;

export function getKpCacheTtlDays() {
  const n = Number(localStorage.getItem('gulrating:kp_cache_days'));
  if (!Number.isFinite(n) || n < 1) return 14;
  return Math.min(Math.round(n), 90);
}

function kpDiskRead(key) {
  try {
    const all = JSON.parse(localStorage.getItem(KP_DISK_KEY) || '{}');
    const entry = all[key];
    if (entry && Date.now() - entry.at < getKpCacheTtlDays() * 86400000) return entry.v;
  } catch (e) { /* приватный режим */ }
  return undefined;
}

function kpDiskWrite(key, value) {
  try {
    const all = JSON.parse(localStorage.getItem(KP_DISK_KEY) || '{}');
    all[key] = { at: Date.now(), v: value };
    const keys = Object.keys(all);
    while (keys.length > KP_DISK_MAX) delete all[keys.shift()];
    localStorage.setItem(KP_DISK_KEY, JSON.stringify(all));
  } catch (e) { /* приватный режим */ }
}

// Ссылка на страницу тайтла на Кинопоиске; по требованию домен
// kinopoisk.ru в итоговой ссылке заменяется на kinokino.vip
export function kinopoiskPageUrl(kpId) {
  if (!kpId) return '';
  return `https://www.kinopoisk.ru/film/${kpId}/`.replace('kinopoisk.ru', 'kinokino.vip');
}

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

// Защитный разбор числа: поля могут приходить строкой или числом
function pickNumber(...candidates) {
  for (const value of candidates) {
    const n = Number(String(value).replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
  }
  return null;
}

// Кинопоиск, IMDb и остальные рейтинги одним объектом: ПоискКино присылает
// их в поле rating (v1.5), числа голосов — в votes; старые схемы — плоскими полями
function extractRatings(item) {
  if (!item) return null;
  const r = item.rating || {};
  const v = item.votes || {};
  const int = (x) => {
    const n = Number(String(x).replace(/\s/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  return {
    kp: pickNumber(r.kp, item.ratingKinopoisk, item.kinopoiskRating),
    imdb: pickNumber(r.imdb, item.ratingImdb, item.imdbRating),
    tmdb: pickNumber(r.tmdb, item.ratingTmdb),
    filmCritics: pickNumber(r.filmCritics, item.ratingFilmCritics),          // критики мира, %
    russianFilmCritics: pickNumber(r.russianFilmCritics, item.ratingRussianFilmCritics), // критики РФ, %
    await: pickNumber(r.await, item.ratingAwait),                            // рейтинг ожидания, %
    votesKp: int(v.kp !== undefined ? v.kp : item.votesKinopoisk),
    votesImdb: int(v.imdb !== undefined ? v.imdb : item.votesImdb),
  };
}

// Карточка тайтла на ПоискКино: бюджет и сборы (v1.5/movie/{id})
async function fetchMovieDetails(base, sendKey, kpId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${base}/v1.5/movie/${kpId}`, {
      headers: headersFor(sendKey),
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// budget/fees приходят объектами { value, currency } — вытаскиваем числа
function extractMoney(details) {
  if (!details) return null;
  const num = (x) => {
    const v = Number(x && typeof x === 'object' ? x.value : x);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  };
  const fees = details.fees || {};
  const money = {
    kpBudget: num(details.budget),
    kpFeesWorld: num(fees.world),
    kpFeesRussia: num(fees.russia),
    kpFeesUsa: num(fees.usa)
  };
  return Object.values(money).some(v => v !== null) ? money : null;
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

// Ищем рейтинги Кинопоиска и IMDb по названию и году.
// Возвращает { kp, imdb } (любое из полей может быть null) или null.
export async function getKinopoiskRatings(title, originalTitle, year) {
  if (!kinopoiskConfigured() || !title) return null;

  const cacheKey = `${title}|${year || ''}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const diskHit = kpDiskRead(cacheKey);
  if (diskHit !== undefined) {
    cache.set(cacheKey, diskHit);
    return diskHit;
  }

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

      const ratings = extractRatings(matched);
      if (ratings && Object.values(ratings).some((x) => x !== null)) {
        const rawId = matched && (matched.id !== undefined ? matched.id : matched.kinopoiskId);
        result = { ...ratings, kpId: rawId !== undefined && rawId !== null ? Number(rawId) : null };
        // Добираем бюджет и сборы из карточки тайтла (кэш сессии + кэш прокси)
        if (result.kpId) {
          const tries = [{ base, sendKey }, ...baseList().filter(b => b.base !== base)];
          for (const t of tries) {
            const money = extractMoney(await fetchMovieDetails(t.base, t.sendKey, result.kpId));
            if (money) {
              Object.assign(result, money);
              break;
            }
          }
        }
        break;
      }
    }
    // Сервис ответил (даже без рейтинга) — дальше базы не пробуем, бережём лимит
    if (reachable || result !== null) break;
  }

  cache.set(cacheKey, result);
  kpDiskWrite(cacheKey, result);
  return result;
}
