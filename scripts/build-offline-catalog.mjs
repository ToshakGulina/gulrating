// Генератор офлайн-базы фильмов: выкачивает топ популярных тайтлов TMDb
// и складывает компактный JSON в data/offline-catalog.json (commit в репозиторий).
// Запускается воркфлоу .github/workflows/offline-catalog.yml (cron + dispatch).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const cfg = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
const KEY = (cfg.match(/TMDB_API_KEY:\s*['"]([^'"]+)['"]/) || [])[1];
if (!KEY) throw new Error('TMDB_API_KEY не найден в src/config.js');

const MOVIE_PAGES = 500; // 10000 фильмов — предел пагинации discover TMDb
const TV_PAGES = 250;    // 5000 сериалов
const BASE = 'https://api.themoviedb.org/3';

async function page(mediaType, n) {
  const url = `${BASE}/discover/${mediaType}?sort_by=popularity.desc&include_adult=false&language=ru-RU&page=${n}&api_key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDb ${mediaType} page ${n}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(item => [
    item.id,
    (mediaType === 'movie' ? item.title : item.name) || '',
    String(mediaType === 'movie' ? (item.release_date || '') : (item.first_air_date || '')).slice(0, 4),
    item.poster_path || null,
    item.vote_average != null ? Number(item.vote_average) : null
  ]);
}

const movies = [];
const tv = [];
for (let n = 1; n <= MOVIE_PAGES; n++) {
  movies.push(...await page('movie', n));
  if (n % 25 === 0) console.log(`movie ${n}/${MOVIE_PAGES}`);
  await new Promise(r => setTimeout(r, 80));
}
for (let n = 1; n <= TV_PAGES; n++) {
  tv.push(...await page('tv', n));
  if (n % 25 === 0) console.log(`tv ${n}/${TV_PAGES}`);
  await new Promise(r => setTimeout(r, 80));
}

mkdirSync(new URL('../data', import.meta.url), { recursive: true });
const out = { v: 1, updated: new Date().toISOString(), movies, tv };
const text = JSON.stringify(out);
writeFileSync(new URL('../data/offline-catalog.json', import.meta.url), text);
console.log(`OK: ${movies.length} movies, ${tv.length} tv, ${(text.length / 1024).toFixed(0)} KB`);
