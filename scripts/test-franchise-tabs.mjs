#!/usr/bin/env node
// Regression test: article-listed franchise titles are matched exactly to TMDb IDs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../src/lib/tmdb.js', import.meta.url), 'utf8');
source = source.replace(
  "import { CONFIG } from '../config.js';",
  "const CONFIG = { TMDB_PROXY_URL: '', TMDB_API_KEY: 'test-key' };"
).replace(
  "import { getWikipediaFranchiseTitles } from './wikipedia.js';",
  "const getWikipediaFranchiseTitles = async (title, originalTitle) => {\n  const key = [title, originalTitle].filter(Boolean).join('|');\n  return globalThis.__wikipediaTitlesByTitle?.[key] || globalThis.__wikipediaTitlesByTitle?.[title] || [];\n};"
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
    if (url.pathname.endsWith('/movie/89')) {
      return Response.json({
        id: 89, title: 'Unknown Canon Film', release_date: '2020-01-01',
        belongs_to_collection: { id: 77, name: 'Noisy Collection' },
      });
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
      return Response.json({ id: 201, title: 'Гадкий я 4', original_title: 'Despicable Me 4', release_date: '2024-01-01' });
    }
    if (url.pathname.endsWith('/movie/202')) {
      return Response.json({ id: 202, title: 'Гадкий я', original_title: 'Despicable Me', release_date: '2010-01-01', belongs_to_collection: { id: 900 } });
    }
    if (url.pathname.endsWith('/movie/203')) {
      return Response.json({ id: 203, title: 'Гадкий я 3', original_title: 'Despicable Me 3', release_date: '2017-01-01', belongs_to_collection: { id: 900 } });
    }
    if (url.pathname.endsWith('/movie/315')) {
      return Response.json({ id: 315, title: 'Endless Saga 15', release_date: '2014-01-01', belongs_to_collection: { id: 910 } });
    }
    if (url.pathname.endsWith('/tv/401')) {
      return Response.json({ id: 401, name: 'Dune', first_air_date: '2021-01-01' });
    }
    if (url.pathname.endsWith('/collection/77')) {
      return Response.json({
        id: 77,
        name: 'Noisy Collection',
        parts: [
          { id: 89, title: 'Unknown Canon Film', release_date: '2020-01-01' },
          { id: 90, title: 'Unrelated Collection Entry', release_date: '2021-01-01' },
        ],
      });
    }
    if (url.pathname.endsWith('/collection/910')) {
      return Response.json({
        id: 910,
        name: 'Endless Saga Collection',
        parts: Array.from({ length: 15 }, (_, index) => ({
          id: 301 + index,
          title: `Endless Saga ${index + 1}`,
          release_date: `${2000 + index}-01-01`,
        })),
      });
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
          { id: 88, title: 'Galaxy Saga: Unrelated Film', release_date: '2019-01-01' },
        ],
      });
    }
    if (url.pathname.endsWith('/search/multi')) {
      const query = url.searchParams.get('query');
      if (query === 'Unknown Canon Film') {
        return Response.json({ results: [
          { id: 89, media_type: 'movie', title: 'Unknown Canon Film', release_date: '2020-01-01' },
        ] });
      }
      if (query.startsWith('Последний богатырь')) {
        return Response.json({ results: [
          { id: 101, media_type: 'movie', title: 'Последний богатырь. Колобок', release_date: '2026-01-01' },
          { id: 102, media_type: 'movie', title: 'Последний богатырь: Начало', release_date: '2017-01-01' },
          { id: 103, media_type: 'movie', title: 'Последний богатырь: Корень зла', release_date: '2021-01-01' },
        ] });
      }
      if (query === 'Dune: Prophecy') {
        return Response.json({ results: [
          { id: 402, media_type: 'tv', name: 'Dune: Prophecy', first_air_date: '2024-01-01' },
        ] });
      }
      if (query === 'Dune') {
        return Response.json({ results: [
          { id: 402, media_type: 'tv', name: 'Dune: Prophecy', first_air_date: '2024-01-01' },
          { id: 403, media_type: 'tv', name: 'Dune Detective', first_air_date: '2024-01-01' }
        ] });
      }
      if (query === 'Гадкий я') return Response.json({ results: [] });
      if (query.startsWith('Despicable Me')) {
        return Response.json({ results: [
          { id: 201, media_type: 'movie', title: 'Гадкий я 4', original_title: 'Despicable Me 4', release_date: '2024-01-01' },
          { id: 202, media_type: 'movie', title: 'Гадкий я', original_title: 'Despicable Me', release_date: '2010-01-01' },
          { id: 203, media_type: 'movie', title: 'Гадкий я 3', original_title: 'Despicable Me 3', release_date: '2017-01-01' },
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

  globalThis.__wikipediaTitlesByTitle = {
    'Unknown Canon Film': [
      { title: 'Unknown Canon Film', media_type: 'movie', year: 2020 },
      { title: 'Unknown Canon Sequel not in TMDb', media_type: 'movie', year: 2024 },
    ],
    'Galaxy Saga': [
      { title: 'Galaxy Saga', media_type: 'movie', year: 2022 },
      { title: 'Galaxy Saga: Chapter Two', media_type: 'movie', year: 2020 },
      { title: 'Galaxy Saga: The Series', media_type: 'tv', year: 2021 },
    ],
    'Galaxy Saga: The Series': [
      { title: 'Galaxy Saga', media_type: 'movie', year: 2022 },
      { title: 'Galaxy Saga: Chapter Two', media_type: 'movie', year: 2020 },
      { title: 'Galaxy Saga: The Series', media_type: 'tv', year: 2021 },
    ],
    'Последний богатырь. Колобок': [
      { title: 'Последний богатырь: Начало', media_type: 'movie', year: 2017 },
      { title: 'Последний богатырь: Корень зла', media_type: 'movie', year: 2021 },
      { title: 'Последний богатырь. Колобок', media_type: 'movie', year: 2026 },
    ],
    'Гадкий я 4|Despicable Me 4': [
      { title: 'Despicable Me', media_type: 'movie', year: 2010 },
      { title: 'Despicable Me 3', media_type: 'movie', year: 2017 },
      { title: 'Despicable Me 4', media_type: 'movie', year: 2024 },
    ],
    Dune: [
      { title: 'Dune', media_type: 'tv', year: 2021 },
      { title: 'Dune: Prophecy', media_type: 'tv', year: 2024 },
    ],
  };

  const unknownResolutionParts = await getFranchiseTitles(89, 'movie');
  assert.deepEqual(
    unknownResolutionParts.map(part => part.id),
    [89],
    'unresolved Wikipedia chronology entries must not trigger unrelated TMDb collection fallback'
  );

  const parts = await getFranchiseTitles(42, 'movie');
  assert.deepEqual(
    parts.map(part => `${part.media_type}:${part.id}`),
    ['movie:43', 'tv:99', 'movie:42'],
    'use the article list as authoritative and exclude a mismatched TMDb collection entry'
  );

  const tvParts = await getFranchiseTitles(99, 'tv');
  assert.deepEqual(
    tvParts.map(part => `${part.media_type}:${part.id}`),
    ['movie:43', 'tv:99', 'movie:42'],
    'opening another tab reuses the same article-derived part list'
  );

  const lastWarriorParts = await getFranchiseTitles(101, 'movie');
  assert.deepEqual(
    lastWarriorParts.map(part => part.id),
    [102, 103, 101],
    'Russian article-listed sequel titles are matched to exact TMDb titles and years'
  );

  const despicableMeParts = await getFranchiseTitles(201, 'movie');
  assert.deepEqual(
    despicableMeParts.map(part => part.id),
    [202, 203, 201],
    'the localized title is searched in Wikipedia and English article titles map by exact name and year'
  );

  const longSeriesParts = await getFranchiseTitles(315, 'movie');
  assert.equal(longSeriesParts.length, 15, 'all parts of a long official collection are included');

  const duneParts = await getFranchiseTitles(401, 'tv');
  assert.deepEqual(
    duneParts.map(part => part.id),
    [401, 402],
    'the article list maps the related series directly and excludes similarly named but unlisted titles'
  );

  const modalSource = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
  assert.match(modalSource, /franchiseContext = null/);
  assert.match(modalSource, /openRatingModal\(tab\.dataset\.titleId, tab\.dataset\.mediaType, currentUser, onSaveCallback, \{ parts \}\)/);
  assert.match(modalSource, /franchisePartsPromise/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Franchise tabs use authoritative Wikipedia parts and exact TMDb matching: OK');
