import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../src/lib/tmdb.js', import.meta.url), 'utf8');
source = source.replace(
  "import { CONFIG } from '../config.js';",
  "const CONFIG = { TMDB_PROXY_URL: '', TMDB_API_KEY: 'test-key' };"
).replace(
  "import { getWikipediaFranchiseTitles } from './wikipedia.js';",
  'const getWikipediaFranchiseTitles = async () => [];'
);
const originalFetch = globalThis.fetch;
const localData = new Map();
globalThis.localStorage = {
  getItem: key => localData.get(key) ?? null,
  setItem: (key, value) => localData.set(key, String(value)),
};

try {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/movie/1')) {
      return Response.json({ id: 1, title: 'Dune', release_date: '2021-10-22', runtime: 155 });
    }
    if (url.pathname.endsWith('/movie/2')) {
      return Response.json({ id: 2, title: 'Short Film', release_date: '2020-01-01', runtime: 42 });
    }
    if (url.pathname.endsWith('/tv/3')) {
      return Response.json({ id: 3, name: 'Dune: Prophecy', first_air_date: '2024-01-01', episode_run_time: [55] });
    }
    throw new Error(`Unexpected TMDb request: ${url}`);
  };

  const { getTitleDetails, primeTitleCache, getCachedTitleDetails } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  assert.equal((await getTitleDetails(1, 'movie')).runtime, 155, 'movie details should retain TMDb runtime in minutes');
  assert.equal((await getTitleDetails(2, 'movie')).runtime, 42, 'short-film runtimes should be retained');
  assert.equal((await getTitleDetails(3, 'tv')).runtime, null, 'episode length must not be mistaken for a full-series runtime');

  primeTitleCache('movie', 4, { title: 'Cached film', runtime: 101 });
  assert.equal(getCachedTitleDetails(4, 'movie').runtime, 101, 'runtime should survive the local details cache');
  primeTitleCache('movie', 5, { title: 'Old partial cache' });
  assert.equal(getCachedTitleDetails(5, 'movie').runtime, null, 'old or sparse cached cards remain safe');

  const modal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
  assert.match(modal, /function formatRuntime\(value\)/);
  assert.match(modal, /mediaType === 'movie' \? formatRuntime\(title\.runtime\) : ''/,
    'runtime is shown only for movies, not as a misleading TV-series duration');
  assert.match(modal, /\$\{runtime \? ` • \$\{escapeHtml\(runtime\)\}` : ''\}/);
  console.log('Movie runtime is fetched, cached, and formatted in the title card: OK');
} finally {
  globalThis.fetch = originalFetch;
}
