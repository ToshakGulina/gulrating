import { CONFIG } from '../config.js';

// Если задан прокси (optional/tmdb-proxy-worker.js) — ходим через него,
// иначе напрямую в TMDb с ключом в параметрах запроса.
const USE_PROXY = Boolean(CONFIG.TMDB_PROXY_URL);
const API_BASE = USE_PROXY
  ? CONFIG.TMDB_PROXY_URL.replace(/\/+$/, '')
  : 'https://api.themoviedb.org/3';

const API_PARAMS = new URLSearchParams({
  language: 'ru-RU',
  include_adult: 'false'
});
if (!USE_PROXY) API_PARAMS.set('api_key', CONFIG.TMDB_API_KEY);

// Запрос к TMDb с таймаутом и понятными сообщениями об ошибках
async function tmdbFetch(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(`${API_BASE}${path}${path.includes('?') ? '&' : '?'}${API_PARAMS}`, {
      signal: controller.signal
    });
  } catch (e) {
    throw new Error('Нет соединения с базой фильмов (TMDb). Проверьте интернет и попробуйте снова.');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error('Ключ TMDb не принят сервером (401). Проверьте TMDB_API_KEY в src/config.js');
    if (res.status === 429) throw new Error('TMDb: слишком много запросов, подождите немного и повторите.');
    if (res.status === 404) throw new Error('Фильм не найден в базе TMDb.');
    throw new Error(`Ошибка базы фильмов TMDb (код ${res.status}).`);
  }
  return res.json();
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

// Недельные тренды TMDb (фильмы + сериалы) — для ряда «Сейчас в тренде»
export async function getTrending(limit = 12) {
  const data = await tmdbFetch('/trending/all/week');

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
export async function getTitleDetails(id, mediaType) {
  const data = await tmdbFetch(`/${mediaType}/${id}`);

  return {
    id: data.id,
    media_type: mediaType,
    title: mediaType === 'movie' ? data.title : data.name,
    original_title: mediaType === 'movie' ? data.original_title : data.original_name,
    release_date: mediaType === 'movie' ? data.release_date : data.first_air_date,
    overview: data.overview,
    poster_path: data.poster_path,
    backdrop_path: data.backdrop_path,
    tmdb_rating: data.vote_average,
    genres: (data.genres || []).map(g => g.name)
  };
}
