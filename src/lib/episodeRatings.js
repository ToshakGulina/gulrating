import { supabase } from './supabase.js';
import { ensureTitleInDatabase, saveRating } from './ratings.js';
import { getTitleDetails } from './tmdb.js';

const PENDING_KEY = 'gulrating:pending_episode_ratings';
const CACHE_PREFIX = 'gulrating:episode_ratings_cache:';

function readPending() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function writePending(items) {
  try {
    if (items.length) localStorage.setItem(PENDING_KEY, JSON.stringify(items));
    else localStorage.removeItem(PENDING_KEY);
  } catch (error) { /* retain in memory when storage is unavailable */ }
}

function cacheKey(userId, titleId) {
  return `${CACHE_PREFIX}${String(userId || 'local')}:${String(titleId)}`;
}

function readCachedRatings(userId, titleId) {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(userId, titleId)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function writeCachedRatings(userId, titleId, rows) {
  try { localStorage.setItem(cacheKey(userId, titleId), JSON.stringify(rows)); }
  catch (error) { /* server remains the source of truth */ }
}

function mergeEpisodeRatings(rows, pending) {
  const merged = new Map();
  for (const row of rows || []) {
    merged.set(`${row.user_id}:${row.season_number}:${row.episode_number}`, row);
  }
  for (const row of pending || []) {
    merged.set(`${row.user_id}:${row.season_number}:${row.episode_number}`, row);
  }
  return [...merged.values()].sort((a, b) => Number(a.season_number) - Number(b.season_number)
    || Number(a.episode_number) - Number(b.episode_number));
}

function replacePending(item) {
  const key = `${item.user_id}:${item.title_id}:${item.season_number}:${item.episode_number}`;
  const items = readPending().filter(old =>
    `${old.user_id}:${old.title_id}:${old.season_number}:${old.episode_number}` !== key);
  items.push(item);
  writePending(items);
}

async function saveEpisodeRatingRemote(item) {
  await ensureTitleInDatabase(item.title_id, 'tv');
  const { error } = await supabase.from('episode_ratings').upsert({
    user_id: item.user_id,
    title_id: item.title_id,
    season_number: item.season_number,
    episode_number: item.episode_number,
    rating: item.rating,
    updated_at: new Date(item.updated_at || Date.now()).toISOString(),
  }, { onConflict: 'user_id,title_id,season_number,episode_number' });
  if (error) throw error;
}

export async function maybeUpdateSeriesRating(userId, titleId) {
  if (!userId || !titleId || !supabase) return null;
  const details = await getTitleDetails(titleId, 'tv');
  const expectedEpisodes = Number(details?.episodes);
  if (!Number.isInteger(expectedEpisodes) || expectedEpisodes < 1) return null;

  const { data, error } = await supabase.from('episode_ratings')
    .select('season_number,episode_number,rating')
    .eq('user_id', userId)
    .eq('title_id', titleId);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const unique = new Map(rows.map(row => [`${row.season_number}:${row.episode_number}`, row]));
  if (unique.size < expectedEpisodes) return null;

  const ratings = [...unique.values()].map(row => Number(row.rating)).filter(value => Number.isFinite(value));
  if (!ratings.length) return null;
  const average = Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10;
  const { data: existingRating } = await supabase.from('ratings')
    .select('comment')
    .eq('user_id', userId)
    .eq('title_id', titleId)
    .maybeSingle();
  // The automatic average replaces the series score but never erases the user's own comment.
  await saveRating(userId, titleId, 'tv', average, existingRating?.comment || '');
  return { rating: average, episodes: ratings.length };
}

export async function submitEpisodeRating(userId, titleId, season, episode, rating) {
  if (!userId || !titleId) throw new Error('Не удалось определить пользователя или сериал.');
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  const score = Math.round(Number(rating) * 10) / 10;
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0
      || !Number.isInteger(episodeNumber) || episodeNumber < 1
      || !Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error('Проверьте номер сезона, серии и оценку.');
  }
  const item = {
    user_id: userId,
    title_id: Number(titleId),
    season_number: seasonNumber,
    episode_number: episodeNumber,
    rating: score,
    updated_at: Date.now(),
  };
  replacePending(item);
  let synced = false;
  let syncError = null;
  try {
    await saveEpisodeRatingRemote(item);
    writePending(readPending().filter(row => row.user_id !== item.user_id
      || row.title_id !== item.title_id
      || row.season_number !== item.season_number
      || row.episode_number !== item.episode_number));
    synced = true;
  } catch (error) {
    // Keep the user's rating queued; an offline player must not lose it.
    syncError = error;
  }

  let seriesRating = null;
  if (synced) {
    try { seriesRating = await maybeUpdateSeriesRating(userId, titleId); }
    catch (error) { /* the episode score is safely saved even if aggregate refresh fails */ }
  }
  return { synced, queued: !synced, seriesRating, error: syncError };
}

export async function getEpisodeRatings(titleId, userId = '', localOnly = false) {
  if (!titleId) return [];
  const cached = readCachedRatings(userId, titleId);
  const pending = readPending().filter(item => String(item.title_id) === String(titleId)
    && (!userId || String(item.user_id) === String(userId)));
  if (!supabase || localOnly || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return mergeEpisodeRatings(cached, pending);
  }
  try {
    const { data, error } = await supabase.from('episode_ratings')
      .select('user_id,season_number,episode_number,rating,updated_at,profiles(username)')
      .eq('title_id', titleId)
      .order('season_number', { ascending: true })
      .order('episode_number', { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    writeCachedRatings(userId, titleId, rows);
    return mergeEpisodeRatings(rows, pending);
  } catch (error) {
    return mergeEpisodeRatings(cached, pending);
  }
}

export async function syncPendingEpisodeRatings(userId) {
  if (!userId || !supabase) return 0;
  let synced = 0;
  const pending = readPending();
  for (const item of pending) {
    if (item.user_id !== userId) continue;
    try {
      await saveEpisodeRatingRemote(item);
      writePending(readPending().filter(row => row.user_id !== item.user_id
        || row.title_id !== item.title_id
        || row.season_number !== item.season_number
        || row.episode_number !== item.episode_number));
      synced += 1;
      await maybeUpdateSeriesRating(userId, item.title_id).catch(() => null);
    } catch (error) { /* keep pending ratings for the next sync */ }
  }
  return synced;
}

export function getPendingNativePlaybackRatings() {
  if (typeof window === 'undefined' || !window.GulRatingBridge?.getPendingPlaybackRatings) return [];
  try {
    const parsed = JSON.parse(window.GulRatingBridge.getPendingPlaybackRatings() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export async function syncNativePlaybackRatings(userId) {
  if (!userId || !window.GulRatingBridge?.clearPendingPlaybackRating) return 0;
  const pending = getPendingNativePlaybackRatings();
  let synced = 0;
  for (const item of pending) {
    // Native queues are pinned to the account that started playback; never
    // apply a saved score to a different account on the same device.
    if (String(item.user_id || '') !== String(userId)) continue;
    try {
      let remotelySaved = true;
      if (item.kind === 'episode') {
        const result = await submitEpisodeRating(userId, item.title_id, item.season_number, item.episode_number, item.rating);
        remotelySaved = result.synced;
      } else if (item.kind === 'movie') {
        await saveRating(userId, item.title_id, 'movie', Number(item.rating), '');
      } else {
        continue;
      }
      // If episode submission had to fall back to the browser's offline queue,
      // that durable queue now owns the record; do not report it as cloud-synced.
      window.GulRatingBridge.clearPendingPlaybackRating(String(item.queue_id));
      if (remotelySaved) synced += 1;
    } catch (error) { /* leave it in the native queue for retry */ }
  }
  return synced;
}
