import { supabase } from './supabase.js';
import { getTitleDetails } from './tmdb.js';

const PENDING_TITLE_STATUS_PREFIX = 'gulrating:pending_title_statuses:';

function readPendingTitleStatuses(userId) {
  try {
    const pending = JSON.parse(localStorage.getItem(`${PENDING_TITLE_STATUS_PREFIX}${userId}`) || '[]');
    return Array.isArray(pending) ? pending : [];
  } catch (e) {
    return [];
  }
}

function writePendingTitleStatuses(userId, pending) {
  if (pending.length) localStorage.setItem(`${PENDING_TITLE_STATUS_PREFIX}${userId}`, JSON.stringify(pending));
  else localStorage.removeItem(`${PENDING_TITLE_STATUS_PREFIX}${userId}`);
}

function removePendingTitleStatus(userId, titleId) {
  const id = String(titleId);
  writePendingTitleStatuses(userId, readPendingTitleStatuses(userId).filter(item => String(item.title_id) !== id));
}

export function queueUserTitleStatus(userId, tmdbId, mediaType, status) {
  const allowed = new Set(['', 'watchlist', 'watched', 'in_progress', 'dropped']);
  if (!allowed.has(status)) throw new Error('Неизвестный статус тайтла');
  const id = String(tmdbId);
  const pending = readPendingTitleStatuses(userId).filter(item => String(item.title_id) !== id);
  pending.push({ title_id: tmdbId, media_type: mediaType, status, queued_at: Date.now() });
  writePendingTitleStatuses(userId, pending);
}

export async function syncPendingTitleStatuses(userId) {
  let synced = 0;
  for (const item of readPendingTitleStatuses(userId)) {
    try {
      await setUserTitleStatus(userId, item.title_id, item.media_type, item.status);
      const pending = readPendingTitleStatuses(userId).filter(candidate =>
        String(candidate.title_id) !== String(item.title_id) || candidate.queued_at !== item.queued_at
      );
      writePendingTitleStatuses(userId, pending);
      synced += 1;
    } catch (e) {
      // Keep failed writes queued for the next connection attempt.
    }
  }
  return synced;
}

// Гарантируем, что тайтл есть в таблице titles.
// Сначала дешёвая проверка существования, чтобы не дёргать TMDb лишний раз.
// Сохраняем через upsert: если два друга одновременно добавят один и тот же
// фильм, обычный insert упал бы с ошибкой уникального ключа.
async function ensureTitle(tmdbId, mediaType) {
  const { data: existing, error: selectError } = await supabase
    .from('titles')
    .select('id')
    .eq('id', tmdbId)
    .maybeSingle();

  if (selectError) throw new Error(`Не удалось проверить фильм в базе: ${selectError.message}`);
  if (existing) return null;

  const titleDetails = await getTitleDetails(tmdbId, mediaType);

  const { error } = await supabase
    .from('titles')
    .upsert({
      id: titleDetails.id,
      title: titleDetails.title,
      original_title: titleDetails.original_title,
      release_date: titleDetails.release_date || null,
      overview: titleDetails.overview,
      poster_path: titleDetails.poster_path,
      backdrop_path: titleDetails.backdrop_path,
      media_type: titleDetails.media_type,
      tmdb_rating: titleDetails.tmdb_rating,
      genres: titleDetails.genres
    }, { onConflict: 'id' });

  if (error) throw new Error(`Не удалось сохранить фильм в базу: ${error.message}`);
  return titleDetails;
}

// Добавить или обновить оценку пользователя
export async function saveRating(userId, tmdbId, mediaType, rating, comment = '') {
  await ensureTitle(tmdbId, mediaType);

  const { data, error } = await supabase
    .from('ratings')
    .upsert({
      user_id: userId,
      title_id: tmdbId,
      rating,
      comment,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,title_id' })
    .select()
    .single();

  if (error) throw error;

  // Оценка означает статус «Просмотрено»: не оставляем такой тайтл
  // одновременно в списке «Хочу посмотреть».
  const { error: watchlistError } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('title_id', tmdbId);

  if (watchlistError) {
    const partialError = new Error(`Оценка сохранена, но не удалось убрать тайтл из «Хочу посмотреть»: ${watchlistError.message}`);
    partialError.ratingSaved = true;
    throw partialError;
  }

  const { error: statusError } = await supabase
    .from('title_statuses')
    .upsert({
      user_id: userId,
      title_id: tmdbId,
      status: 'watched',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,title_id' });

  if (statusError) {
    const partialError = new Error(`Оценка сохранена, но статус не обновлён: ${statusError.message}`);
    partialError.ratingSaved = true;
    throw partialError;
  }

  try { removePendingTitleStatus(userId, tmdbId); } catch (e) { /* status was already saved remotely */ }
  return data;
}

// Удалить оценку
export async function deleteRating(userId, titleId) {
  const { error } = await supabase
    .from('ratings')
    .delete()
    .eq('user_id', userId)
    .eq('title_id', titleId);

  if (error) throw error;
}

// Добавить в список "хочу посмотреть"
export async function addToWatchlist(userId, tmdbId, mediaType) {
  await ensureTitle(tmdbId, mediaType);

  const { data, error } = await supabase
    .from('watchlist')
    .upsert({
      user_id: userId,
      title_id: tmdbId
    }, { onConflict: 'user_id,title_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Удалить из списка "хочу посмотреть"
export async function removeFromWatchlist(userId, titleId) {
  const { error } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('title_id', titleId);

  if (error) throw error;
}

// Установить личный статус тайтла. Оценки не удаляются при смене статуса.
export async function setUserTitleStatus(userId, tmdbId, mediaType, status) {
  const allowed = new Set(['', 'watchlist', 'watched', 'in_progress', 'dropped']);
  if (!allowed.has(status)) throw new Error('Неизвестный статус тайтла');

  if (status === 'watchlist') {
    const { data: rating, error: ratingError } = await supabase
      .from('ratings')
      .select('id')
      .eq('user_id', userId)
      .eq('title_id', tmdbId)
      .maybeSingle();
    if (ratingError) throw ratingError;
    if (rating) throw new Error('Оценённый тайтл остаётся «Просмотрено»; оценка не будет удалена.');

    await addToWatchlist(userId, tmdbId, mediaType);
    const { error: statusError } = await supabase
      .from('title_statuses')
      .delete()
      .eq('user_id', userId)
      .eq('title_id', tmdbId);
    if (statusError) {
      await removeFromWatchlist(userId, tmdbId).catch(() => {});
      throw statusError;
    }
    return 'watchlist';
  }

  if (!status) {
    const [statusResult, watchlistResult] = await Promise.all([
      supabase.from('title_statuses').delete().eq('user_id', userId).eq('title_id', tmdbId),
      supabase.from('watchlist').delete().eq('user_id', userId).eq('title_id', tmdbId)
    ]);
    if (statusResult.error) throw statusResult.error;
    if (watchlistResult.error) throw watchlistResult.error;
    return '';
  }

  await ensureTitle(tmdbId, mediaType);
  const { error: statusError } = await supabase
    .from('title_statuses')
    .upsert({
      user_id: userId,
      title_id: tmdbId,
      status,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,title_id' });
  if (statusError) throw statusError;

  const { error: watchlistError } = await supabase
    .from('watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('title_id', tmdbId);
  if (watchlistError) {
    const partialError = new Error(`Статус сохранён, но не удалось убрать запись из «Хочу посмотреть»: ${watchlistError.message}`);
    partialError.statusSaved = true;
    throw partialError;
  }
  return status;
}

// Получить watchlist пользователя
export async function getWatchlist(userId) {
  const { data, error } = await supabase
    .from('watchlist')
    .select(`
      *,
      titles:title_id (*)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// Проверить есть ли тайтл в watchlist или оценен пользователем
export async function getUserTitleStatus(userId, titleId) {
  const [ratingState, watchlistState, statusState] = await Promise.all([
    supabase
      .from('ratings')
      .select('*')
      .eq('user_id', userId)
      .eq('title_id', titleId)
      .maybeSingle(),
    supabase
      .from('watchlist')
      .select('id')
      .eq('user_id', userId)
      .eq('title_id', titleId)
      .maybeSingle(),
    supabase
      .from('title_statuses')
      .select('status')
      .eq('user_id', userId)
      .eq('title_id', titleId)
      .maybeSingle()
  ]);

  const error = ratingState.error || watchlistState.error || statusState.error;
  if (error) throw error;
  const rating = ratingState.data;
  const watchlistItem = watchlistState.data;
  const explicitStatus = statusState.data?.status || '';
  const currentStatus = explicitStatus || (rating ? 'watched' : watchlistItem ? 'watchlist' : '');

  return {
    hasRating: !!rating,
    rating,
    isInWatchlist: !!watchlistItem,
    currentStatus
  };
}
