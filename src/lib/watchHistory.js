// История просмотров и уведомления о новых сезонах.
// Всё живёт локально на устройстве (localStorage): факт просмотра, кнопка
// «Продолжить», отметка «досмотрено» и снимок числа сезонов/серий для слежения.
// APK хранит прогресс в нативном мосте; браузер — в localStorage, если плеер
// доступен странице (same-origin HTML5 video).

import { getTitleDetails, getMovieCollection } from './tmdb.js';

const HIST_KEY = 'gulrating:watch_history';
const NOTIF_KEY = 'gulrating:notifications';
const CHECK_KEY = 'gulrating:season_check_at';
const POSITIONS_KEY = 'gulrating:watch_positions';
// Проверка только при входе в приложение и не чаще раза в неделю:
// фоном ничего не крутится совсем
const CHECK_EVERY = 7 * 24 * 60 * 60 * 1000;

export function isApk() {
  return typeof window !== 'undefined' && Boolean(window.GulRatingBridge);
}

function read(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed == null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* приватный режим */ }
}

// --- История просмотров ---

export function addWatchEntry(entry) {
  const list = read(HIST_KEY, []);
  const key = `${entry.media_type}:${entry.id}`;
  const prev = list.find(i => i.key === key) || {};
  const next = list.filter(i => i.key !== key);
  next.unshift({
    ...prev,
    ...entry,
    key,
    last_at: new Date().toISOString(),
    opens: (prev.opens || 0) + 1
  });
  try {
    const deleted = read('gulrating:watch_history_tombstones', {});
    delete deleted[key];
    write('gulrating:watch_history_tombstones', deleted);
  } catch (e) { /* optional sync metadata */ }
  write(HIST_KEY, next.slice(0, 60));
}

export function getWatchHistory() {
  return read(HIST_KEY, []);
}

export function removeWatchEntry(key) {
  const deleted = read('gulrating:watch_history_tombstones', {});
  deleted[key] = Date.now();
  write('gulrating:watch_history_tombstones', deleted);
  write(HIST_KEY, read(HIST_KEY, []).filter(i => i.key !== key));
}

// Позиции для прогресс-бара: { "tv:123": { t, d, at } }.
export function getPositions() {
  if (!isApk()) return read(POSITIONS_KEY, {});
  try {
    return JSON.parse(window.GulRatingBridge.getPositions() || '{}');
  } catch (e) {
    return {};
  }
}

// В браузере записываем только доступное HTML5-видео; на Android позицию
// снимает нативный слой, чтобы не дублировать её в localStorage.
export function saveWatchPosition(key, currentTime, duration, force = false) {
  if (isApk() || !key) return false;
  const t = Math.floor(Number(currentTime));
  const d = Math.floor(Number(duration));
  if (!Number.isFinite(t) || !Number.isFinite(d) || t <= 0 || d <= 0) return false;
  const all = read(POSITIONS_KEY, {});
  const previous = all[key];
  const now = Date.now();
  if (!force && previous && now - (Number(previous.at) || 0) < 10_000) return false;
  all[key] = { t, d, at: now };
  write(POSITIONS_KEY, all);
  return true;
}

export function reportWatchNative(id, mediaType) {
  if (!isApk()) return;
  try {
    window.GulRatingBridge.reportWatch(JSON.stringify({ id: String(id), type: mediaType }));
  } catch (e) { /* мост недоступен */ }
}

export function notifyNative(text) {
  if (!isApk()) return false;
  try {
    window.GulRatingBridge.notify(text);
    return true;
  } catch (e) {
    return false;
  }
}

// Отметка «Просмотрено»: для сериалов фиксируем сезоны/серии,
// для фильмов — франшизу TMDb и дату, после которой ищем новые части.
export async function markWatchDone(key) {
  const list = read(HIST_KEY, []);
  const entry = list.find(i => i.key === key);
  if (!entry) return null;
  const d = await getTitleDetails(entry.id, entry.media_type);
  const at = Date.now();
  if (entry.media_type === 'movie') {
    let collection = null;
    if (d.collection_id) {
      try { collection = await getMovieCollection(d.collection_id); } catch (e) { /* пометку просмотра не блокируем */ }
    }
    entry.done = {
      kind: 'movie',
      collectionId: d.collection_id || null,
      collectionName: (collection && collection.name) || d.collection_name || '',
      notifiedPartIds: [],
      at,
      updatedAt: at
    };
  } else {
    entry.done = {
      kind: 'tv',
      seasons: d.seasons || 0,
      episodes: d.episodes || 0,
      at,
      updatedAt: at
    };
  }
  write(HIST_KEY, list.map(i => (i.key === key ? entry : i)));
  return entry;
}

export function unmarkWatchDone(key) {
  const list = read(HIST_KEY, []).map(entry => {
    if (entry.key !== key) return entry;
    const { done, ...rest } = entry;
    return rest;
  });
  write(HIST_KEY, list);
}

// --- Уведомления ---

export function getNotifications() {
  return read(NOTIF_KEY, []);
}

export function unreadNotifications() {
  return getNotifications().filter(n => !n.read).length;
}

export function markNotificationsRead() {
  write(NOTIF_KEY, getNotifications().map(n => ({ ...n, read: true })));
}

function pushNotification(n) {
  const list = read(NOTIF_KEY, []);
  if (n.partId != null && list.some(old => old.kind === n.kind && String(old.partId) === String(n.partId))) return;
  list.unshift({ ...n, at: new Date().toISOString(), read: false });
  write(NOTIF_KEY, list.slice(0, 50));
}

// У досмотренных сериалов проверяем новые сезоны/серии, у просмотренных
// фильмов — новые релизы в коллекции TMDb после отметки «Просмотрено».
// Уведомления появляются в колокольчике и, если можно, в системе.
export async function checkNewSeasons() {
  const last = Number(localStorage.getItem(CHECK_KEY) || 0);
  if (Date.now() - last < CHECK_EVERY) return [];
  localStorage.setItem(CHECK_KEY, String(Date.now()));

  const fresh = [];
  const list = read(HIST_KEY, []);
  for (const entry of list) {
    if (!entry.done) continue;
    if (entry.media_type === 'tv') {
      let d;
      try { d = await getTitleDetails(entry.id, 'tv'); }
      catch (e) { continue; } // офлайн — проверим в следующий раз
      const seasons = d.seasons || 0;
      const episodes = d.episodes || 0;
      const moreSeasons = seasons > entry.done.seasons;
      const moreEpisodes = seasons === entry.done.seasons && episodes > entry.done.episodes;
      if (moreSeasons || moreEpisodes) {
        const text = moreSeasons
          ? `«${entry.title}»: вышел новый сезон (теперь ${seasons})`
          : `«${entry.title}»: новые серии (теперь ${episodes})`;
        pushNotification({ kind: 'new_season', titleId: entry.id, media_type: 'tv', title: entry.title, text });
        fresh.push(text);
        entry.done = { ...entry.done, seasons, episodes, at: Date.now(), updatedAt: Date.now() };
      }
      continue;
    }

    if (entry.media_type !== 'movie') continue;
    let details;
    try { details = await getTitleDetails(entry.id, 'movie'); }
    catch (e) { continue; }
    const collectionId = entry.done.collectionId || details.collection_id;
    if (!collectionId) continue;
    let collection;
    try { collection = await getMovieCollection(collectionId); }
    catch (e) { continue; }
    if (!collection) continue;

    const markedAt = Number(entry.done.at) || Date.now();
    const markedDate = new Date(markedAt).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const notified = new Set((entry.done.notifiedPartIds || []).map(String));
    entry.done.collectionId = collection.id;
    entry.done.collectionName = collection.name || entry.done.collectionName || details.collection_name || '';

    for (const part of collection.parts || []) {
      const partId = String(part.id);
      const releaseDate = part.release_date;
      if (partId === String(entry.id) || notified.has(partId) || !releaseDate || releaseDate < markedDate || releaseDate > today) continue;
      const text = `«${entry.title}»: вышла новая часть — «${part.title || entry.done.collectionName || 'фильм'}»`;
      pushNotification({
        kind: 'new_movie_part',
        titleId: entry.id,
        partId: part.id,
        media_type: 'movie',
        title: entry.title,
        text
      });
      fresh.push(text);
      notified.add(partId);
    }
    entry.done.notifiedPartIds = [...notified].slice(-100);
    entry.done.updatedAt = Date.now();
  }
  write(HIST_KEY, list);

  if (fresh.length) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('gulrating:notifications-changed'));
    const text = fresh[0] + (fresh.length > 1 ? ` и ещё ${fresh.length - 1}` : '');
    const sent = notifyNative(text);
    if (!sent && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('ГульРейтинг', { body: text }); }
      catch (e) { /* браузер запретил */ }
    }
  }
  return fresh;
}
