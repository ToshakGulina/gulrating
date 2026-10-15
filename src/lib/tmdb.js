import { CONFIG } from '../config.js';

const API_BASE = 'https://api.themoviedb.org/3';
const API_PARAMS = new URLSearchParams({
  api_key: CONFIG.TMDB_API_KEY,
  language: 'ru-RU',
  include_adult: 'false'
});

// Поиск фильмов и сериалов по запросу с автодополнением
export async function searchTitles(query) {
  if (!query.trim() || query.length < 2) return [];
  
  const res = await fetch(`${API_BASE}/search/multi?${API_PARAMS}&query=${encodeURIComponent(query)}&page=1`);
  if (!res.ok) throw new Error('Ошибка поиска');
  const data = await res.json();
  
  return data.results
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

// Получаем полную информацию о тайтле по ID
export async function getTitleDetails(id, mediaType) {
  const res = await fetch(`${API_BASE}/${mediaType}/${id}?${API_PARAMS}`);
  if (!res.ok) throw new Error('Не удалось загрузить информацию о фильме');
  const data = await res.json();
  
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
    genres: data.genres.map(g => g.name)
  };
}

// Получаем рейтинг IMDb для фильма
export async function getImdbRating(tmdbId, mediaType) {
  try {
    const res = await fetch(`${API_BASE}/${mediaType}/${tmdbId}/external_ids?${API_PARAMS}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.imdb_id) return null;
    
    // Можно добавить получение рейтинга с OMDB если нужен точный IMDb рейтинг
    // Пока возвращаем null для скорости
    return null;
  } catch (e) {
    return null;
  }
}
