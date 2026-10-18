#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getOfficialWatchUrl } from '../src/lib/kinopoiskWatchLinks.js';

const links = [
  { name: 'Кинопоиск', url: 'https://hd.kinopoisk.ru/film/123' },
  { name: 'Иви', url: 'https://www.ivi.ru/watch/feature/123' },
];
assert.equal(getOfficialWatchUrl(links, 'kinopoisk'), 'https://hd.kinopoisk.ru/film/123');
assert.equal(getOfficialWatchUrl(links, 'ivi'), 'https://www.ivi.ru/watch/feature/123');
assert.equal(getOfficialWatchUrl([{ name: 'Иви', url: 'https://www.ivi.ru/search/?q=Фильм' }], 'ivi'), '');
assert.equal(getOfficialWatchUrl([{ name: 'Кинопоиск', url: 'https://kinopoisk.ru.evil.example/film/123' }], 'kinopoisk'), '');
assert.equal(getOfficialWatchUrl([{ name: 'Кинопоиск', url: 'https://example.com/film/123' }], 'kinopoisk'), '');
assert.equal(getOfficialWatchUrl([{ name: 'Иви', url: 'javascript:alert(1)' }], 'ivi'), '');
assert.equal(getOfficialWatchUrl([{ name: 'Other', url: 'https://www.ivi.ru/watch/123' }], 'ivi'), '');
assert.equal(getOfficialWatchUrl([{ name: 'Кинопоиск', url: 'https://www.kinopoisk.ru/film/123' }], 'ivi'), '');

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.localStorage.setItem('gulrating:kp_cache', JSON.stringify({
  'Тест|2018': { at: Date.now(), v: { kp: 8, imdb: null, kpId: 123 } },
}));
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input) => {
  const url = String(input);
  requests.push(url);
  if (url.includes('/v1.5/movie/123')) {
    return new Response(JSON.stringify({
      watchability: { items: links },
      budget: { value: 1000000000, currency: { code: 'RUB', name: 'Российский рубль' } },
      fees: { world: { value: 1500000000, currency: 'RUB' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`Unexpected request: ${url}`);
};
try {
  let source = await readFile(new URL('../src/lib/kinopoisk.js', import.meta.url), 'utf8');
  const moneySource = await readFile(new URL('../src/lib/money.js', import.meta.url), 'utf8');
  const moneyUrl = `data:text/javascript;base64,${Buffer.from(moneySource).toString('base64')}`;
  source = source
    .replace(
      "import { CONFIG } from '../config.js';",
      "const CONFIG = { KINOPOISK_API_KEY: 'test-key', KINOPOISK_PROXY_URL: '' };"
    )
    .replace("import { moneyValue } from './money.js';", `import { moneyValue } from '${moneyUrl}';`);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { getKinopoiskRatings } = await import(moduleUrl);
  const result = await getKinopoiskRatings('Тест', '', 2018);
  assert.equal(result.kp, 8);
  assert.equal(result.kpId, 123);
  assert.deepEqual(result.watchability, links);
  assert.equal(result.kpBudget, 1000000000);
  assert.equal(result.kpBudgetCurrency, 'RUB');
  assert.equal(result.kpFeesWorldCurrency, 'RUB');
  assert.ok(result.watchabilityAt > 0, 'availability refresh is timestamped separately from ratings cache');
  assert.ok(requests.some(url => url.includes('/kp/v1.5/movie/123')));
  assert.equal(getOfficialWatchUrl(result.watchability, 'kinopoisk'), links[0].url);
  assert.equal(getOfficialWatchUrl(result.watchability, 'ivi'), links[1].url);
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.localStorage;
}

console.log('Kinopoisk watchability exposes only direct official service URLs: OK');
