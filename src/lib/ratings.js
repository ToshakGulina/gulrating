import { supabase } from './supabase.js';
import { getTitleDetails } from './tmdb.js';

// Добавить или обновить оценку пользователя
export async function saveRating(userId, tmdbId, mediaType, rating, comment = '') {
  // Сначала добавляем тайтл в базу если его там нет
  const { data: existingTitle } = await supabase
    .from('titles')
    .select('id')
    .eq('id', tmdbId)
    .single();
  
  if (!existingTitle) {
    const titleDetails = await getTitleDetails(tmdbId, mediaType);
    const { error: titleError } = await supabase
      .from('titles')
      .insert({
        id: titleDetails.id,
        title: titleDetails.title,
        original_title: titleDetails.original_title,
        release_date: titleDetails.release_date,
        overview: titleDetails.overview,
        poster_path: titleDetails.poster_path,
        backdrop_path: titleDetails.backdrop_path,
        media_type: titleDetails.media_type,
        tmdb_rating: titleDetails.tmdb_rating,
        genres: titleDetails.genres
      });
    
    if (titleError) throw titleError;
  }

  // Сохраняем оценку (обновляем если уже существует)
  const { data, error } = await supabase
    .from('ratings')
    .upsert({
      user_id: userId,
      title_id: tmdbId,
      rating,
      comment,
      updated_at: new Date()
    }, { onConflict: 'user_id,title_id' })
    .select()
    .single();
  
  if (error) throw error;
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
  // Сначала добавляем тайтл в базу если его нет
  const { data: existingTitle } = await supabase
    .from('titles')
    .select('id')
    .eq('id', tmdbId)
    .single();
  
  if (!existingTitle) {
    const titleDetails = await getTitleDetails(tmdbId, mediaType);
    await supabase
      .from('titles')
      .insert({
        id: titleDetails.id,
        title: titleDetails.title,
        original_title: titleDetails.original_title,
        release_date: titleDetails.release_date,
        overview: titleDetails.overview,
        poster_path: titleDetails.poster_path,
        backdrop_path: titleDetails.backdrop_path,
        media_type: titleDetails.media_type,
        tmdb_rating: titleDetails.tmdb_rating,
        genres: titleDetails.genres
      });
  }

  const { data, error } = await supabase
    .from('watchlist')
    .upsert({
      user_id: userId,
      title_id: tmdbId
    }, { onConflict: 'user_id,title_id' })
    .select()
    .single();
  
  if (error && error.code !== '23505') throw error; // Игнорируем ошибку если уже добавлено
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
  return data;
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
