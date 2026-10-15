// Офлайн-база фильмов: текстовый индекс популярных тайтлов, который
// скачивается на устройство в фоне (по страницам TMDb, resume-able) и
// позволяет искать и оценивать фильмы без интернета.
//
// Храним компактно: [id, название, год, постер, рейтинг TMDb] —
// 3000 тайтлов ≈ 300 КБ текста; размер настраивается ползунком в профиле.

import { getPopularPage } from './tmdb.js';

const CATALOG_KEY = 'gulrating:offline_catalog';
const SIZE_KEY = 'gulrating:offline_catalog_size';
const SIZE_DEFAULT = 3000;
const SIZE_MIN = 500;
const SIZE_MAX = 15000;
const PER_PAGE = 20;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // полная база обновляется раз в неделю

let syncing = false;

// Готовый файл базы лежит в репозитории (GitHub) и обновляется воркфлоу
// offline-catalog.yml раз в месяц. Источники по приоритету: свой домен
// (Pages отдаёт файл из репозитория), затем CDN/RAW GitHub.
const CATALOG_FILE_SOURCES = [
  '/data/offline-catalog.json',
  'https://cdn.jsdelivr.net/gh/ToshakGulina/gulrating@main/data/offline-catalog.json',
  'https://raw.githubusercontent.com/ToshakGulina/gulrating/main/data/offline-catalog.json'
];

async function loadCatalogFile() {
  for (const url of CATALOG_FILE_SOURCES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.v === 1 && Array.isArray(json.movies) && Array.isArray(json.tv) && json.movies.length) {
        return json;
      }
    } catch (e) { /* источник недоступен — пробуем следующий */ }
  }
  return null;
}

export function getCatalogSizeSetting() {
  const n = Number(localStorage.getItem(SIZE_KEY));
  if (!Number.isFinite(n) || n < SIZE_MIN) return SIZE_DEFAULT;
  return Math.min(Math.round(n / SIZE_MIN) * SIZE_MIN, SIZE_MAX);
}

export function setCatalogSizeSetting(n) {
  const v = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number(n) || SIZE_DEFAULT));
  localStorage.setItem(SIZE_KEY, String(v));
  return v;
}

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null');
    if (parsed && Array.isArray(parsed.m) && Array.isArray(parsed.t)) return parsed;
  } catch (e) { /* повреждено — начнём заново */ }
  return { m: [], t: [], moviePage: 0, tvPage: 0, updatedAt: 0 };
}

function writeState(state) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false; // квота исчерпана — база остаётся в предыдущем размере
  }
}

function targets(size) {
  const movies = Math.ceil(size * 2 / 3);
  return {
    moviePages: Math.ceil(movies / PER_PAGE),
    tvPages: Math.ceil((size - movies) / PER_PAGE)
  };
}

// [id, title, year, poster, vote] → объект карточки, совместимый с плитками
function toCard(entry, mediaType) {
  const [id, title, year, poster, vote] = entry;
  return {
    id,
    media_type: mediaType,
    title,
    release_date: year ? `${year}-01-01` : null,
    poster_path: poster || null,
    vote_average: vote != null ? Number(vote) : null
  };
}

export function getOfflineCatalogStats() {
  const state = readState();
  const size = getCatalogSizeSetting();
  const { moviePages, tvPages } = targets(size);
  const count = state.m.length + state.t.length;
  return {
    count,
    target: size,
    updatedAt: state.updatedAt,
    complete: state.moviePage >= moviePages && state.tvPage >= tvPages && count > 0,
    syncing
  };
}

// Фоновая закачка: продолжает с последней сохранённой страницы, при сетевой
// ошибке останавливается и дожидается следующего запуска (online / вход в приложение)
export async function syncOfflineCatalog() {
  if (syncing) return getOfflineCatalogStats();
  syncing = true;
  try {
    const size = getCatalogSizeSetting();
    const { moviePages, tvPages } = targets(size);
    let state = readState();

    // База полная, нужного размера и свежая — ничего не делаем
    if (state.moviePage >= moviePages && state.tvPage >= tvPages && state.size === size
      && state.updatedAt && Date.now() - state.updatedAt < FRESH_MS) {
      return getOfflineCatalogStats();
    }

    // Приоритетный путь: готовый файл из репозитория (одна загрузка вместо сотен запросов)
    const file = await loadCatalogFile();
    if (file) {
      state.m = file.movies;
      state.t = file.tv;
      state.moviePage = Math.ceil(file.movies.length / PER_PAGE);
      state.tvPage = Math.ceil(file.tv.length / PER_PAGE);
      state.updatedAt = Date.parse(file.updated) || Date.now();
      state.source = 'file';
    } else if (state.moviePage >= moviePages && state.tvPage >= tvPages) {
      // Файла нет, а страницами база уже полная — освежим страницами
      state = { m: [], t: [], moviePage: 0, tvPage: 0, updatedAt: 0 };
    }
    // Целевой размер уменьшили — обрезаем лишнее
    if (state.m.length > moviePages * PER_PAGE) state.m.length = moviePages * PER_PAGE;
    if (state.t.length > tvPages * PER_PAGE) state.t.length = tvPages * PER_PAGE;

    while (state.moviePage < moviePages || state.tvPage < tvPages) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      const isMovie = state.moviePage < moviePages
        && (state.tvPage >= tvPages || (state.moviePage + state.tvPage) % 2 === 0);
      try {
        if (isMovie) {
          const rows = await getPopularPage('movie', state.moviePage + 1);
          rows.forEach(r => state.m.push([r.id, r.title, r.year, r.poster_path, r.vote_average]));
          state.moviePage += 1;
        } else {
          const rows = await getPopularPage('tv', state.tvPage + 1);
          rows.forEach(r => state.t.push([r.id, r.title, r.year, r.poster_path, r.vote_average]));
          state.tvPage += 1;
        }
      } catch (e) {
        break; // сеть пропала или TMDb недоступен — продолжим в следующий раз
      }
      // Прогресс сохраняем каждые 10 страниц, чтобы не дёргать localStorage
      if ((state.moviePage + state.tvPage) % 10 === 0) {
        if (!writeState(state)) break;
      }
    }

    const complete = state.moviePage >= moviePages && state.tvPage >= tvPages;
    if (complete && state.source !== 'file') state.updatedAt = Date.now();
    state.size = size;
    writeState(state);
    return getOfflineCatalogStats();
  } finally {
    syncing = false;
  }
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

// Локальный поиск по скачанной базе: сначала совпадения с начала названия,
// затем содержащие запрос; внутри групп — по популярности (порядок скачивания)
export function searchOfflineCatalog(query, limit = 20) {
  const q = norm(query);
  if (q.length < 2) return [];
  const state = readState();
  const all = [
    ...state.m.map(e => toCard(e, 'movie')),
    ...state.t.map(e => toCard(e, 'tv'))
  ];
  const starts = [];
  const includes = [];
  for (const card of all) {
    const t = norm(card.title);
    if (t.startsWith(q)) starts.push(card);
    else if (t.includes(q)) includes.push(card);
  }
  return [...starts, ...includes].slice(0, limit);
}

// Популярные тайтлы из локальной базы (порядок = популярность TMDb на момент скачивания)
export function getPopularOffline(limit = 18, types = null) {
  const state = readState();
  const wantMovie = !types || [...types].includes('movie');
  const wantTv = !types || [...types].includes('tv');
  const movies = wantMovie ? state.m.map(e => toCard(e, 'movie')) : [];
  const tv = wantTv ? state.t.map(e => toCard(e, 'tv')) : [];
  // Перемежаем, как в выдаче TMDb: два фильма — один сериал
  const out = [];
  let mi = 0;
  let ti = 0;
  while (out.length < limit && (mi < movies.length || ti < tv.length)) {
    if (mi < movies.length) out.push(movies[mi++]);
    if (mi < movies.length && out.length < limit) out.push(movies[mi++]);
    if (ti < tv.length && out.length < limit) out.push(tv[ti++]);
  }
  return out;
}

export function randomOfflineTitle(types = null) {
  const state = readState();
  const pool = [];
  if (!types || [...types].includes('movie')) pool.push(...state.m.map(e => toCard(e, 'movie')));
  if (!types || [...types].includes('tv')) pool.push(...state.t.map(e => toCard(e, 'tv')));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
