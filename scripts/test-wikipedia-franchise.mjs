#!/usr/bin/env node
// Only explicit Wikipedia previous/next rows define franchise membership.
import assert from 'node:assert/strict';
import { getWikipediaFranchiseTitles } from '../src/lib/wikipedia.js';
import { onRequestGet } from '../functions/wiki/[[path]].js';

const originalFetch = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    if (!url.hostname.endsWith('wikipedia.org')) throw new Error(`Unexpected request: ${url}`);

    if (url.searchParams.get('list') === 'search') {
      const query = url.searchParams.get('srsearch') || '';
      if (url.hostname.startsWith('en.')) {
        if (query.includes('The Truman Show')) {
          return Response.json({ query: { search: [
            { title: 'The Truman Show', snippet: '1998 American comedy-drama film' },
            { title: 'Jim Carrey filmography', snippet: 'Filmography includes The Truman Show' },
          ] } });
        }
        if (query.includes('Chronology Alpha')) {
          return Response.json({ query: { search: [
            { title: 'Chronology Alpha (2000 film)', snippet: '2000 feature film' },
          ] } });
        }
        if (query.includes('Mystery')) {
          const article = query.includes('film series')
            ? { title: 'Mystery (film series)', snippet: 'Mystery film series' }
            : { title: 'Mystery', snippet: 'Mystery is a 2010 film' };
          return Response.json({ query: { search: [article] } });
        }
        if (query.includes('Dune')) return Response.json({ query: { search: [
          { title: 'Dune', snippet: 'Dune is a 1965 science fiction novel' },
          { title: 'Dune (2021 film)', snippet: '2021 American science fiction film' },
        ] } });
        return Response.json({ query: { search: [
          { title: 'Despicable Me 4', snippet: '2024 animated comedy film' },
          { title: 'Despicable Me (franchise)', snippet: 'American animated media franchise and film series' },
        ] } });
      }
      if (query.includes('Шоу Трумана')) {
        return Response.json({ query: { search: [
          { title: 'Шоу Трумана', snippet: 'Фильм 1998 года' },
          { title: 'Керри, Джим', snippet: 'Актёр, сыгравший в фильме Шоу Трумана' },
        ] } });
      }
      if (query.includes('Дюна')) return Response.json({ query: { search: [
        { title: 'Дюна', snippet: 'Роман 1965 года' },
        { title: 'Дюна (фильм, 2021)', snippet: 'Фантастический фильм 2021 года' },
      ] } });
      return Response.json({ query: { search: [
        { title: 'Гадкий я 4', snippet: 'Мультфильм 2024 года' },
      ] } });
    }

    if (url.searchParams.get('prop') === 'text') {
      const page = url.searchParams.get('page');
      const rows = {
        'Chronology Alpha (2000 film)': `
          <table><tr><th scope="row">Previous film</th><td><a href="/wiki/Chronology_Zero">Chronology Zero</a> (in the franchise <a href="/wiki/Chronology">Chronology</a>)</td></tr>
          <tr><th scope="row">Next film</th><td><a href="/wiki/Chronology_Beta">Chronology Beta</a></td></tr>
          <tr><th scope="row">Production</th><td><a href="/wiki/Unrelated_Title">Unrelated Title</a></td></tr></table>`,
        'Chronology Zero': '<table><tr><th>Следующий фильм</th><td><a href="/wiki/Chronology_Alpha_(2000_film)">Chronology Alpha</a></td></tr></table>',
        'Chronology Beta': '<table><tr><th>Previous film</th><td><a href="/wiki/Chronology_Alpha_(2000_film)">Chronology Alpha</a></td></tr><tr><th>Next film</th><td><a href="/wiki/Chronology_Gamma">Chronology Gamma</a></td></tr><tr><th>Next television series</th><td><a href="/wiki/Chronology_Series">Chronology Series</a></td></tr><tr><th>Related series</th><td><a href="/wiki/Unrelated_TV">Unrelated TV</a></td></tr></table>',
        'Chronology Gamma': '<table><tr><th>Previous film</th><td><a href="/wiki/Chronology_Beta">Chronology Beta</a></td></tr></table>',
        'Dune': '<p>Original novel article; no film chronology rows.</p>',
        'Дюна': '<p>Оригинальный роман; строк хронологии фильмов нет.</p>',
        'Dune (2021 film)': '<table><tr><th>Followed by</th><td><a href="/wiki/Dune:_Part_Two">Dune: Part Two</a></td></tr></table>',
        'Дюна (фильм, 2021)': '<table><tr><th>Следующий фильм</th><td><a href="/wiki/Dune:_Part_Two">Dune: Part Two</a></td></tr></table>',
        'Dune: Part Two': '<table><tr><th>Preceded by</th><td><a href="/wiki/Dune_(2021_film)">Dune (2021 film)</a></td></tr></table>',
      };
      return Response.json({ parse: { text: { '*': rows[page] || '' } } });
    }

    throw new Error(`Unexpected Wikipedia API request: ${url}`);
  };

  const titles = await getWikipediaFranchiseTitles('Гадкий я 4', 'Despicable Me 4');
  assert.deepEqual(titles, [],
    'a broad franchise article or list of films is not used without explicit previous/next rows');
  assert.ok(requests.some(({ url }) => url.searchParams.get('prop') === 'text'),
    'the exact title page is inspected for explicit chronology rows');
  assert.equal(requests.some(({ url }) => url.searchParams.get('prop') === 'tocdata'), false,
    'franchise article section lists are never consulted');
  const requestCount = requests.length;
  assert.deepEqual(await getWikipediaFranchiseTitles('Despicable Me 4', 'Гадкий я 4'), titles);
  assert.equal(requests.length, requestCount, 'chronology results are cached locally');

  const chronologyRequestStart = requests.length;
  const chronologyTitles = await getWikipediaFranchiseTitles(
    'Chronology Alpha', 'Chronology Alpha', '2000-01-01', 'movie'
  );
  assert.deepEqual(
    chronologyTitles.map(entry => `${entry.media_type}:${entry.title}`).sort(),
    ['movie:Chronology Alpha (2000 film)', 'movie:Chronology Beta', 'movie:Chronology Gamma',
      'movie:Chronology Zero', 'tv:Chronology Series'],
    'follow previous/next rows across films and include a TV series only when an explicit chronology row links it'
  );
  assert.equal(chronologyTitles.some(entry => ['Unrelated Title', 'Unrelated TV', 'Chronology'].includes(entry.title)), false,
    'ignore unrelated rows and secondary franchise links in the chronology infobox');
  assert.ok(requests.slice(chronologyRequestStart).some(({ url }) => url.searchParams.get('prop') === 'text'),
    'inspect each film article for chronology links');
  assert.equal(requests.slice(chronologyRequestStart).some(({ url }) => url.searchParams.get('prop') === 'tocdata'), false,
    'a valid chronology graph takes precedence over broader franchise article lists');

  const duneRequestStart = requests.length;
  const duneTitles = await getWikipediaFranchiseTitles('Дюна', 'Dune', '2021-10-22', 'movie');
  assert.deepEqual(duneTitles.map(entry => entry.title).sort(), ['Dune (2021 film)', 'Dune: Part Two'],
    'when an exact-title search ranks the Dune novel first, choose the 2021 film article and follow its explicit sequel row');
  assert.equal(duneTitles.find(entry => entry.title === 'Dune (2021 film)')?.year, 2021,
    'release year from a linked disambiguated article is preserved for exact TMDb matching');
  const dunePages = requests.slice(duneRequestStart)
    .filter(({ url }) => url.searchParams.get('prop') === 'text')
    .map(({ url }) => url.searchParams.get('page'));
  assert(dunePages.includes('Dune (2021 film)'), 'the English seed selects the year-specific film article');
  assert(dunePages.includes('Дюна (фильм, 2021)'), 'Russian film disambiguation in “(фильм, 2021)” order is recognized');
  assert(!dunePages.includes('Dune') && !dunePages.includes('Дюна'),
    'the novel article must not win over the exact-year film page');

  const trumanRequestStart = requests.length;
  assert.deepEqual(
    await getWikipediaFranchiseTitles('Шоу Трумана', 'The Truman Show', '1998-06-04', 'movie'),
    [],
    'a filmography from a person page must not be mistaken for this film’s franchise'
  );
  assert.equal(requests.slice(trumanRequestStart).some(({ url }) =>
    url.searchParams.get('page') === 'Jim Carrey filmography'
  ), false, 'a person’s filmography must not be used as a franchise list');

  const fallbackTitles = await getWikipediaFranchiseTitles('Мистика 2', 'Mystery Two');
  assert.deepEqual(fallbackTitles, [],
    'broad series-list pages do not populate franchise results without explicit chronology rows');

  const proxyRequests = [];
  const proxyOptions = [];
  globalThis.fetch = async (input, options = {}) => {
    proxyRequests.push(new URL(String(input)));
    proxyOptions.push(options);
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const proxyResponse = await onRequestGet({
    request: new Request('https://gulrating.pages.dev/wiki/ru?action=query&format=json'),
    params: { path: ['ru'] },
  });
  assert.equal(proxyResponse.status, 200);
  assert.equal(proxyRequests[0].hostname, 'ru.wikipedia.org');
  assert.equal(proxyRequests[0].pathname, '/w/api.php');
  assert.equal(proxyRequests[0].searchParams.get('action'), 'query');
  assert.match(proxyOptions[0].headers['User-Agent'], /github\.com\/ToshakGulina\/gulrating/);
  assert.equal((await onRequestGet({
    request: new Request('https://gulrating.pages.dev/wiki/other'),
    params: { path: ['other'] },
  })).status, 404);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Wikipedia explicit chronology traversal, TV-series rows, and Pages proxy: OK');
