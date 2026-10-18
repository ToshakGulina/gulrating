#!/usr/bin/env node
// Regression test: HTTP geo-block/CDN errors (not only rejected fetches) use the Pages proxy.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../src/lib/tmdb.js', import.meta.url), 'utf8');
source = source.replace(
  "import { CONFIG } from '../config.js';",
  "const CONFIG = { TMDB_PROXY_URL: '', TMDB_API_KEY: 'test-key' };"
).replace(
  "import { getWikipediaFranchiseTitles } from './wikipedia.js';",
  "const getWikipediaFranchiseTitles = async () => [];"
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { searchTitles } = await import(moduleUrl);
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const hadWindow = Object.hasOwn(globalThis, 'window');

try {
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith('https://api.themoviedb.org/3/')) {
      return new Response('Cloudflare geo-block', { status: 530 });
    }
    assert.match(url, /^\/tmdb\/search\/multi\?/);
    return new Response(JSON.stringify({ results: [{
      id: 123,
      media_type: 'movie',
      title: 'Test film',
      release_date: '2020-01-01',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const results = await searchTitles('test film');
  assert.equal(requests.length, 2, 'HTTP 530 should retry through Pages Function');
  assert.match(requests[0], /^https:\/\/api\.themoviedb\.org\/3\/search\/multi\?/);
  assert.match(requests[1], /^\/tmdb\/search\/multi\?/);
  assert.equal(results[0].id, 123);
  assert.equal(results[0].title, 'Test film');

  // Authentication errors aren't geo-blocks; preserve their useful message and don't retry.
  requests.length = 0;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ status_message: 'Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await assert.rejects(() => searchTitles('test film'), /Ключ TMDb не принят сервером/);
  assert.equal(requests.length, 1, '401 should not be retried through the proxy');

  // On Pages hosts, prefer the server-side proxy immediately, avoiding a
  // round-trip to the geo-blocked public TMDb API.
  globalThis.window = { location: { hostname: 'arena-46e90052-gulrating.gulrating.pages.dev' } };
  const pagesModuleUrl = `data:text/javascript;base64,${Buffer.from(`${source}\n// Pages-host test`).toString('base64')}`;
  const { searchTitles: searchOnPages } = await import(pagesModuleUrl);
  requests.length = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    assert.match(url, /^\/tmdb\/search\/multi\?/);
    assert.doesNotMatch(url, /api_key=/);
    return new Response(JSON.stringify({ results: [{
      id: 456,
      media_type: 'movie',
      title: 'Pages proxy film',
      release_date: '2021-01-01',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const pagesResults = await searchOnPages('pages film');
  assert.equal(requests.length, 1);
  assert.equal(pagesResults[0].id, 456);
} finally {
  globalThis.fetch = originalFetch;
  if (hadWindow) globalThis.window = originalWindow;
  else delete globalThis.window;
}

console.log('TMDb HTTP geo-block fallback: OK');
