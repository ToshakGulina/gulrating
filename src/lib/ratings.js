import { supabase } from './supabase.js';
import { getTitleDetails } from './tmdb.js';

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
  const [{ data: rating }, { data: watchlistItem }] = await Promise.all([
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
      .maybeSingle()
  ]);

  return {
    hasRating: !!rating,
    rating: rating,
    isInWatchlist: !!watchlistItem
  };
}
