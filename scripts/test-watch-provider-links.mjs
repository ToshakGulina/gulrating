import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  findWatchProviderOffer,
  kinopoiskOfficialTitleUrl,
  iviSearchUrl,
} from '../src/lib/watchProviders.js';

const providers = {
  flatrate: [{ provider_id: 1, provider_name: 'Кинопоиск' }],
  rent: [{ provider_id: 2, provider_name: 'ivi' }],
};
assert.equal(findWatchProviderOffer(providers, 'kinopoisk')?.accessLabel, 'подписка');
assert.equal(findWatchProviderOffer(providers, 'ivi')?.accessLabel, 'аренда');
assert.equal(findWatchProviderOffer({ buy: [{ provider_name: 'Other' }] }, 'ivi'), null);
assert.equal(kinopoiskOfficialTitleUrl(12345, 'movie'), 'https://www.kinopoisk.ru/film/12345/');
assert.equal(kinopoiskOfficialTitleUrl(12345, 'tv'), 'https://www.kinopoisk.ru/series/12345/');
assert.equal(kinopoiskOfficialTitleUrl('bad/id', 'movie'), '');
const iviUrl = new URL(iviSearchUrl('Тихое место', '2018'));
assert.equal(iviUrl.origin, 'https://www.ivi.ru');
assert.equal(iviUrl.pathname, '/search/');
assert.equal(iviUrl.searchParams.get('q'), 'Тихое место 2018');

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { location: { hostname: 'test.local' } };
let fetchCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  fetchCount += 1;
  assert.match(String(input), /^https:\/\/api\.themoviedb\.org\/3\/movie\/123\/watch\/providers\?/);
  return new Response(JSON.stringify({ results: { RU: providers } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
try {
  let source = await readFile(new URL('../src/lib/tmdb.js', import.meta.url), 'utf8');
  source = source.replace(
    "import { CONFIG } from '../config.js';",
    "const CONFIG = { TMDB_PROXY_URL: '', TMDB_API_KEY: 'test-key' };"
  );
  const { getTitleWatchProviders } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(await getTitleWatchProviders(123, 'movie', 'ru'), providers);
  assert.deepEqual(await getTitleWatchProviders(123, 'movie', 'RU'), providers);
  assert.equal(fetchCount, 1, 'provider availability is cached by title and region');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.window;
  delete globalThis.localStorage;
}

console.log('Provider buttons require regional availability; official/search URLs are safely formed: OK');
