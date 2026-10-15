// Локальная история поиска и недавно открытых тайтлов (localStorage браузера).
// Храним только на устройстве пользователя, в базу ничего не пишем.

const QUERIES_KEY = 'gulrating:search_queries';
const TITLES_KEY = 'gulrating:recent_titles';
const MAX_ITEMS = 8;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value.slice(0, MAX_ITEMS)));
  } catch (e) {
    // приватный режим — просто не сохраняем
  }
}

// --- Недавние поисковые запросы ---

export function getSearchQueries() {
  return read(QUERIES_KEY);
}

export function addSearchQuery(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return;
  const list = read(QUERIES_KEY).filter(item => item.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  write(QUERIES_KEY, list);
}

// --- Недавно открытые тайтлы ---

export function getRecentTitles() {
  return read(TITLES_KEY);
}

// item: { id, media_type, title, poster_path, year }
export function addRecentTitle(item) {
  if (!item || !item.id) return;
  const list = read(TITLES_KEY).filter(t => !(String(t.id) === String(item.id) && t.media_type === item.media_type));
  list.unshift({
    id: item.id,
    media_type: item.media_type,
    title: item.title,
    poster_path: item.poster_path || null,
    year: item.year || ''
  });
  write(TITLES_KEY, list);
}

export function clearHistory() {
  try {
    localStorage.removeItem(QUERIES_KEY);
    localStorage.removeItem(TITLES_KEY);
  } catch (e) {
    // игнорируем
  }
}
