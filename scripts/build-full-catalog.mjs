// Генератор ПОЛНОЙ офлайн-базы: выкачивает весь каталог TMDb (фильмы и
// сериалы, все годы), сортирует по названию и раскладывает на чанки.
// Результат публикуется в отдельную orphan-ветку data-full (история main
// не раздувается), приложение качает чанки оттуда и хранит в IndexedDB.
//
// discover TMDb отдаёт не больше 10 000 результатов на окно, поэтому окно
// «год + диапазон рейтинга» рекурсивно дробится, пока не влезет в лимит.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const cfg = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
const KEY = (cfg.match(/TMDB_API_KEY:\s*['"]([^'"]+)['"]/) || [])[1];
if (!KEY) throw new Error('TMDB_API_KEY не найден в src/config.js');

const BASE = 'https://api.themoviedb.org/3';
const CONCURRENCY = 8;
const CHUNK_SIZE = 25000;
const THIS_YEAR = new Date().getUTCFullYear();

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

async function discover(type, params) {
  const qs = new URLSearchParams({
    api_key: KEY,
    language: 'ru-RU',
    include_adult: 'false',
    sort_by: 'popularity.desc',
    ...params
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/discover/${type}?${qs}`);
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

function toRecord(type, item) {
  return [
    item.id,
    type === 'movie' ? 'm' : 't',
    (type === 'movie' ? item.title : item.name) || '',
    String(type === 'movie' ? (item.release_date || '') : (item.first_air_date || '')).slice(0, 4),
    item.poster_path || null,
    item.vote_average != null ? Number(item.vote_average) : null
  ];
}

// Все страницы окна (не больше 500 — жёсткий лимит TMDb)
async function collectWindow(type, params) {
  const first = await discover(type, { ...params, page: 1 });
  const total = Math.min(first.total_results || 0, 10000);
  const items = (first.results || []).map(i => toRecord(type, i));
  const pages = Math.ceil(total / 20);
  for (let page = 2; page <= pages; page++) {
    const data = await discover(type, { ...params, page });
    items.push(...(data.results || []).map(i => toRecord(type, i)));
  }
  return { total: first.total_results || 0, items };
}

// Окно «год [+ диапазон рейтинга]»; при переполнении делим рейтинг пополам
async function collectYear(type, year, voteGte, voteLte, depth) {
  const yearKey = type === 'movie' ? 'primary_release_date.year' : 'first_air_date.year';
  const params = { [yearKey]: String(year) };
  if (voteGte != null) params['vote_average.gte'] = String(voteGte);
  if (voteLte != null) params['vote_average.lte'] = String(voteLte);
  const { total, items } = await collectWindow(type, params);
  if (total <= 10000 || depth >= 5) return items;
  const mid = Math.round(((voteGte ?? 0) + (voteLte ?? 10)) / 2 * 10) / 10;
  if (mid <= (voteGte ?? 0) || mid >= (voteLte ?? 10)) return items;
  const [a, b] = await Promise.all([
    collectYear(type, year, voteGte, mid, depth + 1),
    collectYear(type, year, mid, voteLte, depth + 1)
  ]);
  return [...a, ...b];
}

async function pool(jobs) {
  const out = [];
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < jobs.length) {
      const my = idx++;
      out[my] = await jobs[my]();
    }
  });
  await Promise.all(workers);
  return out;
}

console.log('Скачиваю полный каталог TMDb…');
const seen = new Set();
const records = [];
const push = (items) => {
  for (const r of items) {
    const k = `${r[1]}:${r[0]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    records.push(r);
  }
};

for (const type of ['movie', 'tv']) {
  const years = [];
  for (let y = 1890; y <= THIS_YEAR + 1; y++) years.push(y);
  const results = await pool(years.map(y => async () => {
    const items = await collectYear(type, y, null, null, 0);
    return items;
  }));
  let count = 0;
  for (const items of results) { push(items); count += items.length; }
  console.log(`${type}: ${count} тайтлов`);
}

records.sort((a, b) => {
  const ka = norm(a[2]);
  const kb = norm(b[2]);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});

rmSync(new URL('../out', import.meta.url), { recursive: true, force: true });
mkdirSync(new URL('../out/data/full', import.meta.url), { recursive: true });
const chunks = [];
for (let i = 0; i < records.length; i += CHUNK_SIZE) {
  const slice = records.slice(i, i + CHUNK_SIZE);
  const file = `chunk-${String(chunks.length).padStart(3, '0')}.json`;
  const text = JSON.stringify(slice);
  writeFileSync(new URL(`../out/data/full/${file}`, import.meta.url), text);
  chunks.push({ file, first: norm(slice[0][2]), count: slice.length, bytes: text.length });
  if (chunks.length % 10 === 0) console.log(`чанков: ${chunks.length}`);
}
const manifest = {
  v: 1,
  updated: new Date().toISOString(),
  total: records.length,
  bytes: chunks.reduce((s, c) => s + c.bytes, 0),
  chunks
};
writeFileSync(new URL('../out/data/full/manifest.json', import.meta.url), JSON.stringify(manifest));
console.log(`OK: ${records.length} тайтлов, ${chunks.length} чанков, ${(manifest.bytes / 1048576).toFixed(1)} MB`);
