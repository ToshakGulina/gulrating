import { CONFIG } from '../config.js';

// На Cloudflare Pages используем собственную Pages Function как основной
// источник: она обходит геоблок TMDb для российских IP. Для локальной сборки
// без Pages Functions оставляем прямой запрос; внешний прокси из config имеет
// высший приоритет.
const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const IS_PAGES_HOST = hostname === 'gulrating.pages.dev' || hostname.endsWith('.gulrating.pages.dev');
const PAGES_PROXY_URL = IS_PAGES_HOST ? '/tmdb' : '';
const PROXY_URL = CONFIG.TMDB_PROXY_URL
  ? CONFIG.TMDB_PROXY_URL.replace(/\/+$/, '')
  : PAGES_PROXY_URL;
const USE_PROXY = Boolean(PROXY_URL);
const API_BASE = USE_PROXY ? PROXY_URL : 'https://api.themoviedb.org/3';

const API_PARAMS = new URLSearchParams({
  language: 'ru-RU',
  include_adult: 'false'
});
if (!USE_PROXY) API_PARAMS.set('api_key', CONFIG.TMDB_API_KEY);

// Запрос к TMDb с таймаутом и понятными сообщениями об ошибках.
// На Cloudflare Pages основной путь — серверный /tmdb proxy, поскольку
// прямой TMDb может вернуть геоблок 530 для российских IP. В локальной
// сборке сперва пробуем прямой API и переключаемся на /tmdb при сетевой
// ошибке или HTTP 403/5xx.
async function tmdbFetch(path) {
  const query = `${path}${path.includes('?') ? '&' : '?'}${API_PARAMS}`;
  let res;
  try {
    res = await tmdbRaw(`${API_BASE}${query}`);
  } catch (e) {
    if (USE_PROXY) throw new Error('Нет соединения с базой фильмов (TMDb). Проверьте интернет и попробуйте снова.');
    try {
      res = await tmdbRaw(`/tmdb${query}`);
    } catch (e2) {
      throw new Error('Нет соединения с базой фильмов (TMDb). Проверьте интернет и попробуйте снова.');
    }
  }

  // При блокировке по географии / ошибке CDN запрос может завершиться HTTP
  // 530, 52x или другим 5xx, а не reject-нуться. Повторяем его через Pages
  // Function, если изначально не задан отдельный прокси.
  if (!USE_PROXY && (!res.ok && (res.status === 403 || res.status >= 500))) {
    try {
      res = await tmdbRaw(`/tmdb${query}`);
    } catch (e) { /* ниже покажем исходную ошибку прямого запроса */ }
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error('Ключ TMDb не принят сервером (401). Проверьте TMDB_API_KEY в src/config.js');
    if (res.status === 429) throw new Error('TMDb: слишком много запросов, подождите немного и повторите.');
    if (res.status === 404) throw new Error('Фильм не найден в базе TMDb.');
    // Показываем причину от самого TMDb (status_message), чтобы не гадать
    let detail = '';
    try {
      const body = await res.json();
      detail = body && body.status_message ? `: ${body.status_message}` : '';
    } catch (e) { /* тело не читается — остаёмся без детали */ }
    throw new Error(`Ошибка базы фильмов TMDb (код ${res.status})${detail}`);
  }
  return res.json();
}

async function tmdbRaw(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Поиск фильмов и сериалов по запросу с автодополнением
export async function searchTitles(query) {
  if (!query.trim() || query.length < 2) return [];

  const data = await tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}&page=1`);

  return (data.results || [])
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
    .map(item => ({
      id: item.id,
      media_type: item.media_type,
      title: item.media_type === 'movie' ? item.title : item.name,
      original_title: item.media_type === 'movie' ? item.original_title : item.original_name,
      release_date: item.media_type === 'movie' ? item.release_date : item.first_air_date,
      overview: item.overview,
      poster_path: item.poster_path,
      vote_average: item.vote_average,
      genre_ids: item.genre_ids
    }));
}

// Тренды TMDb: окно (day/week) и тип (all/movie/tv) выбираются вызывающим
export async function getTrending({ mediaType = 'all', window = 'week', limit = 12 } = {}) {
  const data = await tmdbFetch(`/trending/${mediaType}/${window}`);

  return (data.results || [])
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
    .slice(0, limit)
    .map(item => ({
      id: item.id,
      media_type: item.media_type,
      title: item.media_type === 'movie' ? item.title : item.name,
      release_date: item.media_type === 'movie' ? item.release_date : item.first_air_date,
      poster_path: item.poster_path,
      vote_average: item.vote_average
    }));
}

// Получаем полную информацию о тайтле по ID
// Кэш деталей тайтлов: без сети карточки открываются из него,
// и оценку можно поставить в очередь. Заполняется не только при
// открытии модалки, но и при показе любой карточки (лента, каталог,
// рекомендации, поиск, история) — см. primeTitleCache.
const TITLE_CACHE_KEY = 'gulrating:title_cache';
const TITLE_CACHE_MAX = 100;

function readTitleCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TITLE_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeTitleCache(cache, key, details) {
  try {
    cache[key] = details;
    const keys = Object.keys(cache);
    while (keys.length > TITLE_CACHE_MAX) delete cache[keys.shift()];
    localStorage.setItem(TITLE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) { /* приватный режим */ }
}

// Записывает в кэш данные карточки, которая просто показалась на экране
// (строка ленты из Supabase или результат TMDb). Уже существующую полную
// запись не затирает.
export function primeTitleCache(mediaType, id, partial) {
  if (!mediaType || !id || !partial) return;
  const cache = readTitleCache();
  const key = `${mediaType}:${id}`;
  if (cache[key]) return;
  cache[key] = {
    id,
    media_type: mediaType,
    title: partial.title || partial.name || '',
    original_title: partial.original_title || partial.original_name || null,
    release_date: partial.release_date || partial.first_air_date || null,
    overview: partial.overview || null,
    poster_path: partial.poster_path || null,
    backdrop_path: partial.backdrop_path || null,
    tmdb_rating: partial.tmdb_rating != null
      ? partial.tmdb_rating
      : (partial.vote_average != null ? partial.vote_average : null),
    collection_id: partial.collection_id || (partial.belongs_to_collection && partial.belongs_to_collection.id) || null,
    collection_name: partial.collection_name || (partial.belongs_to_collection && partial.belongs_to_collection.name) || null,
    genres: Array.isArray(partial.genres)
      ? partial.genres.map(g => (typeof g === 'string' ? g : g && g.name)).filter(Boolean)
      : []
  };
  writeTitleCache(cache, key, cache[key]);
}

// Страница популярных тайтлов (для фоновой закачки офлайн-базы)
export async function getPopularPage(mediaType, page) {
  const data = await tmdbFetch(`/discover/${mediaType}?sort_by=popularity.desc&page=${page}`);
  return (data.results || []).map(item => ({
    id: item.id,
    title: (mediaType === 'movie' ? item.title : item.name) || '',
    year: String(mediaType === 'movie' ? (item.release_date || '') : (item.first_air_date || '')).slice(0, 4),
    poster_path: item.poster_path || null,
    vote_average: item.vote_average != null ? item.vote_average : null
  }));
}

export async function getTitleDetails(id, mediaType) {
  let data;
  try {
    data = await tmdbFetch(`/${mediaType}/${id}`);
  } catch (e) {
    const cached = readTitleCache()[`${mediaType}:${id}`];
    if (cached) return cached;
    throw e;
  }

  const details = {
    id: data.id,
    media_type: mediaType,
    title: mediaType === 'movie' ? data.title : data.name,
    original_title: mediaType === 'movie' ? data.original_title : data.original_name,
    release_date: mediaType === 'movie' ? data.release_date : data.first_air_date,
    overview: data.overview,
    poster_path: data.poster_path,
    backdrop_path: data.backdrop_path,
    tmdb_rating: data.vote_average,
    genres: (data.genres || []).map(g => g.name),
    budget: data.budget || null,
    revenue: data.revenue || null,
    seasons: data.number_of_seasons != null ? data.number_of_seasons : null,
    episodes: data.number_of_episodes != null ? data.number_of_episodes : null,
    collection_id: data.belongs_to_collection ? data.belongs_to_collection.id : null,
    collection_name: data.belongs_to_collection ? data.belongs_to_collection.name : null
  };
  writeTitleCache(readTitleCache(), `${mediaType}:${id}`, details);
  return details;
}

// Список фильмов франшизы/коллекции TMDb для слежения за новыми частями.
export async function getMovieCollection(collectionId) {
  if (!collectionId) return null;
  const data = await tmdbFetch(`/collection/${encodeURIComponent(collectionId)}`);
  return {
    id: data.id,
    name: data.name || '',
    parts: (data.parts || []).map(part => ({
      id: part.id,
      title: part.title || '',
      release_date: part.release_date || null
    }))
  };
}

// Похожие названия из TMDb помогают показать рядом фильмы и сериалы франшизы.
// Для фильмов сначала берём официальную коллекцию TMDb, затем дополняем её
// результатами поиска по корню франшизы (так в ряду могут появиться и сериалы).
function franchiseRoot(title, collectionName = '') {
  const source = collectionName || String(title || '').split(/[:(]/, 1)[0];
  return String(source)
    .replace(/\b(collection|franchise|коллекция|франшиза)\b/gi, '')
    .replace(/\b(part|chapter|volume|часть|том)\s*\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function franchiseTokens(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 2 && !/^\d+$/.test(word));
}

export async function getFranchiseTitles(id, mediaType) {
  const current = await getTitleDetails(id, mediaType);
  const titleRoot = franchiseRoot(current.title);
  const [collection, initialMatches] = await Promise.all([
    mediaType === 'movie' && current.collection_id
      ? getMovieCollection(current.collection_id).catch(() => null)
      : Promise.resolve(null),
    searchTitles(titleRoot).catch(() => [])
  ]);
  const root = franchiseRoot(current.title, collection?.name);
  const rootWords = [...new Set(franchiseTokens(root))];
  if (!rootWords.length) return [{ ...current, media_type: mediaType }];

  const matches = root === titleRoot
    ? initialMatches
    : [...initialMatches, ...await searchTitles(root).catch(() => [])];
  const byKey = new Map();
  for (const part of collection?.parts || []) {
    byKey.set(`movie:${part.id}`, {
      ...part,
      media_type: 'movie',
      poster_path: null
    });
  }

  const minOverlap = rootWords.length === 1 ? 1 : 2;
  for (const match of matches) {
    if (!match || (Number(match.id) === Number(id) && match.media_type === mediaType)) continue;
    const words = new Set(franchiseTokens(match.title));
    const overlap = rootWords.reduce((count, word) => count + (words.has(word) ? 1 : 0), 0);
    if (overlap < minOverlap) continue;
    const key = `${match.media_type}:${match.id}`;
    byKey.set(key, { ...byKey.get(key), ...match });
  }

  const currentKey = `${mediaType}:${id}`;
  byKey.set(currentKey, { ...current, media_type: mediaType });
  return [...byKey.values()]
    .sort((a, b) => {
      if (`${a.media_type}:${a.id}` === currentKey) return -1;
      if (`${b.media_type}:${b.id}` === currentKey) return 1;
      const dateA = a.release_date || '';
      const dateB = b.release_date || '';
      return dateA.localeCompare(dateB) || a.title.localeCompare(b.title, 'ru');
    })
    .slice(0, 12);
}

// Приводим ответ TMDb к общему виду карточки рекомендации
function mapResults(results, limit) {
  return (results || [])
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv' || item.title || item.name)
    .slice(0, limit)
    .map(item => ({
      id: item.id,
      media_type: item.media_type || (item.title ? 'movie' : 'tv'),
      title: item.title || item.name,
      release_date: item.release_date || item.first_air_date,
      poster_path: item.poster_path,
      vote_average: item.vote_average,
      vote_count: item.vote_count || 0,
      popularity: item.popularity || 0
    }));
}

// Рекомендации TMDb «похоже на» для тайтла (блок персонального подбора)
export async function getRecommendations(id, mediaType, limit = 12) {
  const data = await tmdbFetch(`/${mediaType}/${id}/recommendations`);
  return mapResults(data.results, limit);
}

// Карта «название жанра → id» для фильмов или сериалов отдельно
// (id жанров у TMDb различаются по типам). Имена приходят на русском
// из-за language=ru-RU. Кэш на сессию: список жанров меняется крайне редко.
let genreMapCache = null;
export async function getGenreMap(mediaType) {
  if (!genreMapCache) {
    const [movies, tv] = await Promise.all([
      tmdbFetch('/genre/movie/list'),
      tmdbFetch('/genre/tv/list')
    ]);
    genreMapCache = { movie: {}, tv: {} };
    for (const g of movies.genres || []) genreMapCache.movie[String(g.name).toLowerCase()] = g.id;
    for (const g of tv.genres || []) genreMapCache.tv[String(g.name).toLowerCase()] = g.id;
  }
  return genreMapCache[mediaType === 'tv' ? 'tv' : 'movie'] || {};
}

// Каталог: discover с жанрами, сортировкой, порогом рейтинга и годами.
// Возвращает страницу результатов и признак «есть ещё».
export async function discoverTitles({ mediaType = 'movie', genreIds = [], sortBy = 'popularity.desc', voteGte = 0, voteLte = 0, yearGte = '', yearLte = '', page = 1, limit = 18 } = {}) {
  // include_adult уже добавляет tmdbFetch через API_PARAMS.
  // Минимальный набор параметров: TMDb отвечает 400 на некоторые
  // комбинации фильтров, поэтому всё необязательное добавляем только
  // когда пользователь реально выставил значение.
  const params = new URLSearchParams({
    sort_by: sortBy,
    page: String(page)
  });
  if (genreIds.length) params.set('with_genres', genreIds.join(','));
  if (voteGte) params.set('vote_average.gte', String(voteGte));
  if (voteLte) params.set('vote_average.lte', String(voteLte));
  const dateKey = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date';
  if (yearGte) params.set(`${dateKey}.gte`, `${yearGte}-01-01`);
  if (yearLte) params.set(`${dateKey}.lte`, `${yearLte}-12-31`);
  const path = mediaType === 'tv' ? '/discover/tv' : '/discover/movie';
  let data;
  try {
    data = await tmdbFetch(`${path}?${params.toString()}`);
  } catch (e) {
    // Фолбэк: если TMDb отверг комбинацию фильтров (400), пробуем только
    // сортировку и страницу — каталог обязан открыться
    if (!/400/.test(e.message || '')) throw e;
    // Мультисорт (через запятую) TMDb может отвергнуть — оставляем первичный ключ
    const fallback = new URLSearchParams(params);
    fallback.set('sort_by', sortBy.split(',')[0]);
    data = await tmdbFetch(`${path}?${fallback.toString()}`);
  }
  return {
    items: mapResults(data.results, limit),
    hasMore: (data.page || 1) < (data.total_pages || 1),
    total: data.total_results || 0,
    totalPages: data.total_pages || 1
  };
}
