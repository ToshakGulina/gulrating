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
    if (url.pathname.endsWith('/movie/101')) {
      return Response.json({ id: 101, title: 'Последний богатырь. Колобок', release_date: '2026-01-01' });
    }
    if (url.pathname.endsWith('/movie/102')) {
      return Response.json({ id: 102, title: 'Последний богатырь: Начало', release_date: '2017-01-01', belongs_to_collection: { id: 800 } });
    }
    if (url.pathname.endsWith('/movie/103')) {
      return Response.json({ id: 103, title: 'Последний богатырь: Корень зла', release_date: '2021-01-01', belongs_to_collection: { id: 800 } });
    }
    if (url.pathname.endsWith('/movie/201')) {
      return Response.json({ id: 201, title: 'Despicable Me 4', release_date: '2024-01-01' });
    }
    if (url.pathname.endsWith('/movie/202')) {
      return Response.json({ id: 202, title: 'Despicable Me', release_date: '2010-01-01', belongs_to_collection: { id: 900 } });
    }
    if (url.pathname.endsWith('/movie/203')) {
      return Response.json({ id: 203, title: 'Despicable Me 3', release_date: '2017-01-01', belongs_to_collection: { id: 900 } });
    }
    if (url.pathname.endsWith('/collection/800')) {
      return Response.json({
        id: 800,
        name: 'Последний богатырь Collection',
        parts: [
          { id: 102, title: 'Последний богатырь: Начало', release_date: '2017-01-01' },
          { id: 103, title: 'Последний богатырь: Корень зла', release_date: '2021-01-01' },
        ],
      });
    }
    if (url.pathname.endsWith('/collection/900')) {
      return Response.json({
        id: 900,
        name: 'Despicable Me Collection',
        parts: [
          { id: 202, title: 'Despicable Me', release_date: '2010-01-01' },
          { id: 203, title: 'Despicable Me 3', release_date: '2017-01-01' },
        ],
      });
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
      const query = url.searchParams.get('query');
      if (query === 'Последний богатырь') {
        return Response.json({ results: [
          { id: 101, media_type: 'movie', title: 'Последний богатырь. Колобок', release_date: '2026-01-01' },
          { id: 102, media_type: 'movie', title: 'Последний богатырь: Начало', release_date: '2017-01-01' },
          { id: 103, media_type: 'movie', title: 'Последний богатырь: Корень зла', release_date: '2021-01-01' },
        ] });
      }
      if (query === 'Despicable Me 4') {
        return Response.json({ results: [
          { id: 201, media_type: 'movie', title: 'Despicable Me 4', release_date: '2024-01-01' },
          { id: 202, media_type: 'movie', title: 'Despicable Me', release_date: '2010-01-01' },
          { id: 203, media_type: 'movie', title: 'Despicable Me 3', release_date: '2017-01-01' },
        ] });
      }
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

  const lastWarriorParts = await getFranchiseTitles(101, 'movie');
  assert.deepEqual(
    lastWarriorParts.map(part => part.id),
    [102, 103, 101],
    'a dot subtitle is reduced to the franchise root and films are recovered from their official collection'
  );

  const despicableMeParts = await getFranchiseTitles(201, 'movie');
  assert.deepEqual(
    despicableMeParts.map(part => part.id),
    [202, 203, 201],
    'a new movie without collection_id can find the matching official movie collection'
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Franchise tabs combine movie collections and matching TV series: OK');
