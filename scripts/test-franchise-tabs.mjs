#!/usr/bin/env node
// Regression test: franchise tabs combine TMDb movie collections and matching TV series.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../src/lib/tmdb.js', import.meta.url), 'utf8');
source = source.replace(
  "import { CONFIG } from '../config.js';",
  "const CONFIG = { TMDB_PROXY_URL: '', TMDB_API_KEY: 'test-key' };"
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { getFranchiseTitles } = await import(moduleUrl);
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/movie/42')) {
      return Response.json({
        id: 42,
        title: 'Galaxy Saga',
        release_date: '2022-01-01',
        belongs_to_collection: { id: 7, name: 'Galaxy Saga Collection' },
      });
    }
    if (url.pathname.endsWith('/tv/99')) {
      return Response.json({
        id: 99,
        name: 'Galaxy Saga: The Series',
        first_air_date: '2021-01-01',
      });
    }
    if (url.pathname.endsWith('/movie/43')) {
      return Response.json({
        id: 43,
        title: 'Galaxy Saga: Chapter Two',
        release_date: '2020-01-01',
        belongs_to_collection: { id: 7, name: 'Galaxy Saga Collection' },
      });
    }
    if (url.pathname.endsWith('/movie/88')) {
      return Response.json({ id: 88, title: 'Galaxy Saga: Unrelated Film', release_date: '2019-01-01' });
    }
    if (url.pathname.endsWith('/collection/7')) {
      return Response.json({
        id: 7,
        name: 'Galaxy Saga Collection',
        parts: [
          { id: 42, title: 'Galaxy Saga', release_date: '2020-01-01' },
          { id: 43, title: 'Galaxy Saga: Chapter Two', release_date: '2022-01-01' },
        ],
      });
    }
    if (url.pathname.endsWith('/search/multi')) {
      return Response.json({ results: [
        { id: 42, media_type: 'movie', title: 'Galaxy Saga', release_date: '2022-01-01' },
        { id: 43, media_type: 'movie', title: 'Galaxy Saga: Chapter Two', release_date: '2020-01-01' },
        { id: 88, media_type: 'movie', title: 'Galaxy Saga: Unrelated Film', release_date: '2019-01-01' },
        { id: 99, media_type: 'tv', name: 'Galaxy Saga: The Series', first_air_date: '2021-01-01' },
        { id: 100, media_type: 'tv', name: 'The Galaxy Saga Detective', first_air_date: '2023-01-01' },
        { id: 123, media_type: 'tv', name: 'Unrelated Detective', first_air_date: '2024-01-01' },
      ] });
    }
    throw new Error(`Unexpected TMDb request: ${url}`);
  };

  const parts = await getFranchiseTitles(42, 'movie');
  assert.deepEqual(
    parts.map(part => `${part.media_type}:${part.id}`),
    ['movie:43', 'tv:99', 'movie:42'],
    'include only official collection movies and directly titled TV series, sorted by release date'
  );

  const tvParts = await getFranchiseTitles(99, 'tv');
  assert.deepEqual(
    tvParts.map(part => `${part.media_type}:${part.id}`),
    ['movie:43', 'tv:99', 'movie:42'],
    'a directly related series includes only movies from its verified official collection'
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Franchise tabs combine movie collections and matching TV series: OK');
