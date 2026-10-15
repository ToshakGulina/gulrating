// История просмотров и уведомления о новых сезонах.
// Всё живёт локально на устройстве (localStorage): факт просмотра, кнопка
// «Продолжить», отметка «досмотрено» и снимок числа сезонов/серий для слежения.
// Позиция воспроизведения приходит из APK: нативный мост GulRatingBridge
// опрашивает <video> плеера и отдаёт позиции через getPositions().

import { getTitleDetails } from './tmdb.js';

const HIST_KEY = 'gulrating:watch_history';
const NOTIF_KEY = 'gulrating:notifications';
const CHECK_KEY = 'gulrating:season_check_at';
const CHECK_EVERY = 6 * 60 * 60 * 1000;     // общая проверка не чаще раза в 6 часов
const ENTRY_RECHECK = 12 * 60 * 60 * 1000; // по каждому досмотренному — раз в 12 часов

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
  write(HIST_KEY, next.slice(0, 60));
}

export function getWatchHistory() {
  return read(HIST_KEY, []);
}

export function removeWatchEntry(key) {
  write(HIST_KEY, read(HIST_KEY, []).filter(i => i.key !== key));
}

// Позиции из APK: { "tv:123": { t, d, at } } — для прогресс-бара «как в YT»
export function getPositions() {
  if (!isApk()) return {};
  try {
    return JSON.parse(window.GulRatingBridge.getPositions() || '{}');
  } catch (e) {
    return {};
  }
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

// «Досмотрено»: снимаем число сезонов/серий с TMDb — от него будем следить за новинками
export async function markWatchDone(key) {
  const list = read(HIST_KEY, []);
  const entry = list.find(i => i.key === key);
  if (!entry) return null;
  const d = await getTitleDetails(entry.id, entry.media_type);
  entry.done = {
    seasons: d.seasons || 0,
    episodes: d.episodes || 0,
    at: Date.now()
  };
  write(HIST_KEY, list.map(i => (i.key === key ? entry : i)));
  return entry;
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
  list.unshift({ ...n, at: new Date().toISOString(), read: false });
  write(NOTIF_KEY, list.slice(0, 50));
}

// У досмотренных сериалов сравниваем сезоны/серии с TMDb:
// вышло новое — уведомление в раздел уведомлений + нативное/системное
export async function checkNewSeasons() {
  const last = Number(localStorage.getItem(CHECK_KEY) || 0);
  if (Date.now() - last < CHECK_EVERY) return [];
  localStorage.setItem(CHECK_KEY, String(Date.now()));

  const fresh = [];
  const list = read(HIST_KEY, []);
  for (const entry of list) {
    if (!entry.done || entry.media_type !== 'tv') continue;
    if (Date.now() - (entry.done.at || 0) < ENTRY_RECHECK) continue;
    let d = null;
    try {
      d = await getTitleDetails(entry.id, 'tv');
    } catch (e) {
      continue; // офлайн — проверим в следующий раз
    }
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
      entry.done = { seasons, episodes, at: Date.now() };
    } else {
      entry.done.at = Date.now();
    }
  }
  write(HIST_KEY, list);

  if (fresh.length) {
    const text = fresh[0] + (fresh.length > 1 ? ` и ещё ${fresh.length - 1}` : '');
    const sent = notifyNative(text);
    if (!sent && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('ГульРейтинг', { body: text });
      } catch (e) { /* браузер запретил */ }
    }
  }
  return fresh;
}
