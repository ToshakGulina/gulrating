// Синхронизация локальных настроек и истории между устройствами одного аккаунта.
// Серверная строка — лишь резервная копия пользовательских данных; доступ
// к рейтингам и профилю по-прежнему проверяется отдельными RLS-политиками.
import { supabase } from './supabase.js';

const SETTING_KEYS = [
  'gulrating:accent', 'gulrating:feed_sort', 'gulrating:feed_order',
  'gulrating:friends_threshold', 'gulrating:want_min', 'gulrating:my_min',
  'gulrating:merge_title_ratings',
  'gulrating:kp_cache_days', 'gulrating:show_recs', 'gulrating:feed_visible', 'gulrating:last_dub',
  'gulrating:offline_catalog_size'
];
const HISTORY_KEY = 'gulrating:watch_history';
const HISTORY_DELETES_KEY = 'gulrating:watch_history_tombstones';
const SETTING_TIMES_KEY = 'gulrating:sync_setting_times';
const SYNC_EVENT = 'gulrating:local-change';
const SYNC_TRIGGER_KEYS = new Set([
  ...SETTING_KEYS, HISTORY_KEY, HISTORY_DELETES_KEY,
  'gulrating:bad_dubs', 'gulrating:recent_titles', 'gulrating:search_queries'
]);
const DEBOUNCE_MS = 900;
let activeUser = null;
let timer = null;
let busy = false;
let rerun = false;
let storageHookInstalled = false;
let applyingRemote = false;
let missingTableNotified = false;

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value == null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/private */ }
}

function installStorageHook() {
  if (storageHookInstalled || typeof Storage === 'undefined') return;
  storageHookInstalled = true;
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (key, value) {
    const result = originalSet.call(this, key, value);
    if (this === localStorage && !applyingRemote && SYNC_TRIGGER_KEYS.has(String(key))) {
      if (SETTING_KEYS.includes(String(key))) {
        const times = readJson(SETTING_TIMES_KEY, {});
        times[key] = Date.now();
        originalSet.call(this, SETTING_TIMES_KEY, JSON.stringify(times));
      }
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
    }
    return result;
  };
  Storage.prototype.removeItem = function (key) {
    const result = originalRemove.call(this, key);
    if (this === localStorage && !applyingRemote && SYNC_TRIGGER_KEYS.has(String(key))) {
      if (SETTING_KEYS.includes(String(key))) {
        const times = readJson(SETTING_TIMES_KEY, {});
        times[key] = Date.now();
        originalSet.call(this, SETTING_TIMES_KEY, JSON.stringify(times));
      }
      window.dispatchEvent(new CustomEvent(SYNC_EVENT));
    }
    return result;
  };
  window.addEventListener(SYNC_EVENT, () => scheduleUserSync());
  // Изменение из другой вкладки тоже ставит синхронизацию в очередь.
  window.addEventListener('storage', (event) => {
    if (event.key && SYNC_TRIGGER_KEYS.has(event.key)) scheduleUserSync();
  });
}

function localSettings() {
  const times = readJson(SETTING_TIMES_KEY, {});
  const settings = {};
  for (const key of SETTING_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = { value, at: Number(times[key]) || 0 };
  }
  return settings;
}

function asMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\\d{10,13}$/.test(value)) return Number(value);
  const n = Date.parse(value || '');
  return Number.isFinite(n) ? n : 0;
}

function mergeHistory(localRows, remoteRows, localDeletes, remoteDeletes) {
  const rows = new Map();
  for (const row of [...(Array.isArray(remoteRows) ? remoteRows : []), ...(Array.isArray(localRows) ? localRows : [])]) {
    if (!row || !row.key) continue;
    const old = rows.get(row.key);
    if (!old) {
      rows.set(row.key, { ...row });
      continue;
    }
    const newer = asMillis(row.last_at) >= asMillis(old.last_at) ? row : old;
    const older = newer === row ? old : row;
    const done = asMillis(row.done && (row.done.updatedAt || row.done.at)) >= asMillis(old.done && (old.done.updatedAt || old.done.at)) ? row.done : old.done;
    rows.set(row.key, { ...older, ...newer,
      opens: Math.max(Number(old.opens) || 0, Number(row.opens) || 0),
      ...(done ? { done } : {}) });
  }

  const deletes = { ...(remoteDeletes || {}), ...(localDeletes || {}) };
  for (const [key, at] of Object.entries(remoteDeletes || {})) {
    deletes[key] = Math.max(Number(deletes[key]) || 0, Number(at) || 0);
  }
  for (const [key, at] of Object.entries(localDeletes || {})) {
    deletes[key] = Math.max(Number(deletes[key]) || 0, Number(at) || 0);
  }
  const kept = [...rows.values()].filter(row => (Number(deletes[row.key]) || 0) <= asMillis(row.last_at));
  kept.sort((a, b) => asMillis(b.last_at) - asMillis(a.last_at));
  return { rows: kept.slice(0, 60), deletes };
}

function mergePositions(local, remote) {
  const result = { ...(remote || {}) };
  for (const [key, value] of Object.entries(local || {})) {
    const old = result[key];
    if (!old || (Number(value && value.at) || 0) >= (Number(old.at) || 0)) result[key] = value;
  }
  return result;
}

function mergeData(local, remote) {
  const localTimes = readJson(SETTING_TIMES_KEY, {});
  const settings = { ...(remote && remote.settings || {}) };
  for (const [key, item] of Object.entries(local.settings || {})) {
    const old = settings[key];
    if (!old || (Number(item.at) || 0) >= (Number(old.at) || 0)) settings[key] = item;
  }

  const history = mergeHistory(
    readJson(HISTORY_KEY, []), remote && remote.watchHistory,
    readJson(HISTORY_DELETES_KEY, {}), remote && remote.watchHistoryDeletes
  );
  const localBadDubs = readJson('gulrating:bad_dubs', []);
  const localRecentTitles = readJson('gulrating:recent_titles', []);
  const localSearchQueries = readJson('gulrating:search_queries', []);
  const badDubs = [...new Set([
    ...(Array.isArray(remote && remote.badDubs) ? remote.badDubs : []),
    ...(Array.isArray(localBadDubs) ? localBadDubs : [])
  ])].slice(-80);
  const recentTitles = [...(Array.isArray(remote && remote.recentTitles) ? remote.recentTitles : []),
    ...(Array.isArray(localRecentTitles) ? localRecentTitles : [])].filter((item, index, all) => item && item.id
      && all.findIndex(other => String(other.id) === String(item.id) && other.media_type === item.media_type) === index).slice(0, 8);
  const searchQueries = [...(Array.isArray(remote && remote.searchQueries) ? remote.searchQueries : []),
    ...(Array.isArray(localSearchQueries) ? localSearchQueries : [])].filter((item, index, all) => typeof item === 'string'
      && all.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index).slice(0, 3);

  const localPositions = (() => {
    try { return JSON.parse(window.GulRatingBridge?.getPositions?.() || '{}'); } catch (e) { return {}; }
  })();
  const positions = mergePositions(localPositions, remote && remote.positions);

  // Победившие значения сохраняем без перезаписи их серверных меток времени.
  applyingRemote = true;
  try {
    const nextTimes = { ...localTimes };
    for (const [key, item] of Object.entries(settings)) {
      if (!item || typeof item.value !== 'string') continue;
      const localAt = Number(localTimes[key]) || 0;
      const remoteAt = Number(item.at) || 0;
      if (remoteAt > localAt || localStorage.getItem(key) === null) {
        localStorage.setItem(key, item.value);
        nextTimes[key] = remoteAt;
      }
    }
    writeJson(SETTING_TIMES_KEY, nextTimes);
    writeJson(HISTORY_KEY, history.rows);
    writeJson(HISTORY_DELETES_KEY, history.deletes);
    writeJson('gulrating:bad_dubs', badDubs);
    writeJson('gulrating:recent_titles', recentTitles);
    writeJson('gulrating:search_queries', searchQueries);
    try { window.GulRatingBridge?.mergePositions?.(JSON.stringify(positions)); } catch (e) { /* bridge optional */ }
  } finally {
    applyingRemote = false;
  }

  return {
    schema: 1,
    settings,
    watchHistory: history.rows,
    watchHistoryDeletes: history.deletes,
    badDubs,
    recentTitles,
    searchQueries,
    positions
  };
}

async function requestWithTimeout(promise, ms = 3500) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('sync timeout')), ms); })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function syncUserData(user = activeUser, timeoutMs = 3500) {
  if (!user || !user.id || !supabase || (typeof navigator !== 'undefined' && navigator.onLine === false) || busy) {
    if (busy && user) rerun = true;
    return false;
  }
  busy = true;
  try {
    const { data: row, error } = await requestWithTimeout(supabase
      .from('user_sync').select('data').eq('user_id', user.id).maybeSingle(), timeoutMs);
    if (error) {
      if (!missingTableNotified && /user_sync/i.test(error.message || '')
          && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|not found/i.test(error.message || ''))) {
        missingTableNotified = true;
        window.dispatchEvent(new Event('gulrating:sync-not-configured'));
      }
      return false; // offline/table not migrated: keep local data, retry later
    }
    if (!activeUser || activeUser.id !== user.id) return false; // аккаунт сменился во время запроса
    const merged = mergeData({ settings: localSettings() }, row && row.data || {});
    const { error: saveError } = await requestWithTimeout(supabase
      .from('user_sync')
      .upsert({ user_id: user.id, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }), timeoutMs);
    return !saveError;
  } catch (e) {
    return false;
  } finally {
    busy = false;
    if (rerun) {
      rerun = false;
      scheduleUserSync();
    }
  }
}

export function scheduleUserSync() {
  if (!activeUser) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncUserData(activeUser), DEBOUNCE_MS);
}

export function setSyncUser(user) {
  installStorageHook();
  activeUser = user && user.id ? user : null;
  clearTimeout(timer);
}

export function markWatchHistoryChanged() {
  scheduleUserSync();
}
