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
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const tmdbRequests = [];

try {
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    tmdbRequests.push(url);

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
    if (url.pathname.endsWith('/movie/501')) {
      return Response.json({
        id: 501, title: 'Dune', original_title: 'Dune', release_date: '2021-10-22',
        belongs_to_collection: { id: 78, name: 'Dune Collection' },
      });
    }
    if (url.pathname.endsWith('/tv/401')) {
      return Response.json({ id: 401, name: 'Dune', first_air_date: '2021-01-01' });
    }
    if (url.pathname.endsWith('/tv/402')) {
      return Response.json({ id: 402, name: 'Dune: Prophecy', first_air_date: '2024-11-17' });
    }
    if (url.pathname.endsWith('/collection/78')) {
      return Response.json({
        id: 78,
        name: 'Dune Collection',
        parts: [
          { id: 502, title: 'Dune', release_date: '1984-12-14' },
          { id: 501, title: 'Dune', release_date: '2021-10-22' },
          { id: 503, title: 'Dune: Part Two', release_date: '2024-02-28' },
        ],
      });
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
      if (query === 'Dune: Part Two') {
        return Response.json({ results: [
          { id: 503, media_type: 'movie', title: 'Dune: Part Two', release_date: '2024-02-28' },
        ] });
      }
      if (query === 'Dune') {
        return Response.json({ results: [
          { id: 401, media_type: 'tv', name: 'Dune', first_air_date: '2021-01-01' },
          { id: 502, media_type: 'movie', title: 'Dune', release_date: '1984-12-14' },
          { id: 501, media_type: 'movie', title: 'Dune', release_date: '2021-10-22' },
          { id: 402, media_type: 'tv', name: 'Dune: Prophecy', first_air_date: '2024-01-01' },
          { id: 403, media_type: 'tv', name: 'Dune Detective', first_air_date: '2024-01-01' },
          { id: 503, media_type: 'movie', title: 'Dune: Part Two', release_date: '2024-02-28' },
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
    'Dune|Dune': [
      { title: 'Dune', media_type: 'movie', year: 1984 },
      { title: 'Dune', media_type: 'movie', year: 2021 },
      { title: 'Dune: Part Two', media_type: 'movie', year: 2024 },
    ],
    'Dune: Prophecy': [
      { title: 'Dune (2021 film)', media_type: 'all', year: 2021 },
      { title: 'Dune: Part Two', media_type: 'all', year: 2024 },
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
  assert.deepEqual(longSeriesParts.map(part => part.id), [315],
    'TMDb collection members are not inferred when Wikipedia has no explicit previous/next rows');

  const duneParts = await getFranchiseTitles(401, 'tv');
  assert.deepEqual(
    duneParts.map(part => part.id),
    [401, 402],
    'the article list maps the related series directly and excludes similarly named but unlisted titles'
  );

  storage.delete('gulrating:wikipedia_franchise_parts_v5');
  const prophecyParts = await getFranchiseTitles(402, 'tv');
  assert.deepEqual(
    prophecyParts.map(part => `${part.media_type}:${part.id}`),
    ['movie:501', 'movie:503', 'tv:402'],
    'the Dune (2021 film) disambiguation forces movie matching even when TMDb ranks a same-year TV title first'
  );

  storage.set('gulrating:wikipedia_franchise_parts_v3', JSON.stringify({
    'movie:501': { at: Date.now(), parts: [
      { id: 501, media_type: 'movie', title: 'Dune: Part Two', release_date: '2024-02-28' },
      { id: 503, media_type: 'movie', title: 'Dune: Part Three', release_date: '2026-12-18' },
    ] },
  }));
  storage.delete('gulrating:wikipedia_franchise_parts_v5');
  const duneRequestsStart = tmdbRequests.length;
  const duneFilmParts = await getFranchiseTitles(501, 'movie');
  assert.deepEqual(
    duneFilmParts.map(part => part.id),
    [502, 501, 503],
    'only the exact film titles in the provided chronology rows are mapped; no collection extras are added'
  );
  assert.equal(tmdbRequests.slice(duneRequestsStart).some(url => url.pathname.endsWith('/collection/78')),
    false, 'TMDb collection data does not broaden an explicit chronology list');
  const openedFromSequel = await getFranchiseTitles(503, 'movie');
  assert.deepEqual(openedFromSequel.map(part => part.id), [502, 501, 503],
    'the full explicit chronology component remains available when a sequel is opened independently later');

  const modalSource = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
  const franchiseCacheSource = await readFile(new URL('../src/lib/tmdb.js', import.meta.url), 'utf8');
  const wikiCacheSource = await readFile(new URL('../src/lib/wikipedia.js', import.meta.url), 'utf8');
  const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(franchiseCacheSource, /FRANCHISE_PARTS_CACHE_KEY = 'gulrating:wikipedia_franchise_parts_v5'/,
    'the incomplete franchise graphs from earlier previews are invalidated');
  assert.match(wikiCacheSource, /CACHE_KEY = 'gulrating:wikipedia_franchise_cache_v8'/,
    'the incomplete Wikipedia chronology results from earlier previews are invalidated');
  assert.match(htmlSource, /@keyframes franchise-tab-enter-from-left \{[^\n]+\} \}/,
    'both directions of the franchise swipe keyframes have complete CSS blocks');
  assert.match(modalSource, /franchiseContext = null/);
  assert.match(modalSource, /openRatingModal\(tab\.dataset\.titleId, tab\.dataset\.mediaType, currentUser, onSaveCallback, \{ parts, direction \}\)/,
    'a franchise switch passes its ordered parts and direction without pinning the modal to a stale viewport rectangle');
  assert.match(modalSource, /const direction = targetIndex >= 0 && currentIndex >= 0 && targetIndex < currentIndex \? -1 : 1/);
  assert.match(modalSource, /animateFranchiseModalEnter\(modal, franchiseDirection\)/);
  assert.match(modalSource, /modal\.dataset\.franchiseTransitioning = 'true'[\s\S]*?document\.body\.appendChild\(modal\)/,
    'the modal is reserved before the shared MutationObserver sees it');
  assert.match(modalSource, /rating-modal-panel bg-card/,
    'the new modal does not run a CSS keyframe on its loading skeleton');
  const tabsReadyIndex = modalSource.indexOf('tabs.innerHTML = parts.map');
  const scrollReadyIndex = modalSource.indexOf('requestAnimationFrame(() => {', tabsReadyIndex);
  const enterReadyIndex = modalSource.indexOf('startFranchiseEnter();', scrollReadyIndex);
  assert(tabsReadyIndex >= 0 && scrollReadyIndex > tabsReadyIndex && enterReadyIndex > scrollReadyIndex,
    'franchise entrance begins only after the full content and tab strip have settled, preventing vertical re-centering during the slide');
  assert.match(modalSource, /closeModal\(direction\)/);
  assert.match(modalSource, /franchisePartsPromise/);
  const ratingModalFunction = modalSource.slice(modalSource.indexOf('export async function openRatingModal('));
  assert.doesNotMatch(ratingModalFunction, /document\.getElementById\(/,
    'title switching must scope repeated element IDs to the modal being loaded');
  assert.match(ratingModalFunction, /modal\.querySelector\('#modal-content'\)\.innerHTML/g,
    'each selected franchise title renders into its own modal rather than a closing modal');
  assert.match(ratingModalFunction, /activeRatingModals\.size \? 'hidden' : ratingModalPreviousBodyOverflow/,
    'closing the previous title during a tab switch does not unlock the page under the new modal');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Franchise tabs use authoritative Wikipedia parts and exact TMDb matching: OK');
