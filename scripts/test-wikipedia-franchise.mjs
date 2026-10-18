#!/usr/bin/env node
// Wikipedia chronology links are crawled before the curated film-list fallback.
import assert from 'node:assert/strict';
import { getWikipediaFranchiseTitles } from '../src/lib/wikipedia.js';
import { onRequestGet } from '../functions/wiki/[[path]].js';

const originalFetch = globalThis.fetch;
const requests = [];
const filmLinks = [
  { title: 'Despicable Me', year: 2010 },
  { title: 'Despicable Me 2', year: 2013 },
  { title: 'Despicable Me 3', year: 2017 },
  { title: 'Despicable Me 4', year: 2024 },
  { title: 'Minions', year: 2015 },
  { title: 'Minions: The Rise of Gru', year: 2022 },
  { title: 'Minions & Monsters', year: 2026 },
];

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
      return Response.json({ query: { search: [
        { title: 'Гадкий я 4', snippet: 'Мультфильм 2024 года' },
      ] } });
    }

    if (url.searchParams.get('prop') === 'tocdata') {
      const title = url.searchParams.get('page');
      if (title === 'Jim Carrey filmography') {
        return Response.json({ parse: { tocdata: { sections: [
          { index: '1', tocLevel: 1, line: 'Film' },
          { index: '2', tocLevel: 1, line: 'Television' },
        ] } } });
      }
      if (title === 'Mystery (film series)') {
        return Response.json({ parse: { tocdata: { sections: [
          { index: '1', tocLevel: 1, line: 'Films' },
          { index: '2', tocLevel: 2, line: 'Mystery (2010)' },
          { index: '3', tocLevel: 2, line: 'Mystery Two (2012)' },
        ] } } });
      }
      if (title === 'Despicable Me (franchise)') {
        return Response.json({ parse: { tocdata: { sections: [
          { index: '1', tocLevel: 1, line: 'Feature films' },
          { index: '2', tocLevel: 2, line: 'Main series' },
          { index: '3', tocLevel: 3, line: 'Despicable Me (2010)' },
          { index: '4', tocLevel: 3, line: 'Despicable Me 2 (2013)' },
          { index: '5', tocLevel: 3, line: 'Despicable Me 3 (2017)' },
          { index: '6', tocLevel: 3, line: 'Despicable Me 4 (2024)' },
          { index: '7', tocLevel: 2, line: 'Prequel series' },
          { index: '8', tocLevel: 3, line: 'Minions (2015)' },
          { index: '9', tocLevel: 3, line: 'Minions: The Rise of Gru (2022)' },
          { index: '10', tocLevel: 3, line: 'Minions & Monsters (2026)' },
          { index: '11', tocLevel: 1, line: 'Short films' },
          { index: '12', tocLevel: 1, line: 'Television series' },
        ] } } });
      }
      return Response.json({ parse: { tocdata: { sections: [{ index: '1', line: 'Production' }] } } });
    }

    if (url.searchParams.get('prop') === 'links') {
      const section = url.searchParams.get('section');
      if (url.searchParams.get('page') === 'Jim Carrey filmography' && section === '1') {
        return Response.json({ parse: { links: [
          { ns: 0, '*': 'Sonic the Hedgehog 3' },
          { ns: 0, '*': 'Sonic the Hedgehog 4' },
        ] } });
      }
      const links = section === '2'
        ? filmLinks.map(({ title }) => ({ ns: 0, '*': title }))
        : [{ ns: 0, '*': 'Minions: The Rise of Gru' }];
      return Response.json({ parse: { links } });
    }

    if (url.searchParams.get('prop') === 'text') {
      const page = url.searchParams.get('page');
      const rows = {
        'Chronology Alpha (2000 film)': `
          <table><tr><th scope="row">Previous film</th><td><a href="/wiki/Chronology_Zero">Chronology Zero</a> (in the franchise <a href="/wiki/Chronology">Chronology</a>)</td></tr>
          <tr><th scope="row">Next film</th><td><a href="/wiki/Chronology_Beta">Chronology Beta</a></td></tr>
          <tr><th scope="row">Production</th><td><a href="/wiki/Unrelated_Title">Unrelated Title</a></td></tr></table>`,
        'Chronology Zero': '<table><tr><th>Следующий фильм</th><td><a href="/wiki/Chronology_Alpha_(2000_film)">Chronology Alpha</a></td></tr></table>',
        'Chronology Beta': '<table><tr><th>Previous film</th><td><a href="/wiki/Chronology_Alpha_(2000_film)">Chronology Alpha</a></td></tr><tr><th>Next film</th><td><a href="/wiki/Chronology_Gamma">Chronology Gamma</a></td></tr></table>',
        'Chronology Gamma': '<table><tr><th>Previous film</th><td><a href="/wiki/Chronology_Beta">Chronology Beta</a></td></tr></table>',
      };
      return Response.json({ parse: { text: { '*': rows[page] || '' } } });
    }

    throw new Error(`Unexpected Wikipedia API request: ${url}`);
  };

  const titles = await getWikipediaFranchiseTitles('Гадкий я 4', 'Despicable Me 4');
  assert.deepEqual(titles, filmLinks.map(entry => ({ ...entry, media_type: 'movie' })));
  assert.ok(requests.some(({ url }) => url.searchParams.get('prop') === 'tocdata'
    && url.searchParams.get('page') === 'Despicable Me (franchise)'),
  'search-result article is inspected for an explicit film list');
  assert.equal(requests.some(({ url }) => url.searchParams.get('section') === '11'), false,
    'short-film list sections are excluded from feature-film tabs');
  const requestCount = requests.length;
  assert.deepEqual(await getWikipediaFranchiseTitles('Despicable Me 4', 'Гадкий я 4'), titles);
  assert.equal(requests.length, requestCount, 'article-derived title lists are cached locally');

  const chronologyRequestStart = requests.length;
  const chronologyTitles = await getWikipediaFranchiseTitles(
    'Chronology Alpha', 'Chronology Alpha', '2000-01-01', 'movie'
  );
  assert.deepEqual(
    chronologyTitles.map(entry => entry.title).sort(),
    ['Chronology Alpha (2000 film)', 'Chronology Beta', 'Chronology Gamma', 'Chronology Zero'],
    'follow explicit previous/next film links in both directions and several steps'
  );
  assert.equal(chronologyTitles.some(entry => entry.title === 'Unrelated Title' || entry.title === 'Chronology'), false,
    'ignore unrelated rows and secondary franchise links in the chronology infobox');
  assert.ok(requests.slice(chronologyRequestStart).some(({ url }) => url.searchParams.get('prop') === 'text'),
    'inspect each film article for chronology links');
  assert.equal(requests.slice(chronologyRequestStart).some(({ url }) => url.searchParams.get('prop') === 'tocdata'), false,
    'a valid chronology graph takes precedence over broader franchise article lists');

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
  assert.deepEqual(fallbackTitles, [
    { title: 'Mystery', media_type: 'movie', year: 2010 },
    { title: 'Mystery Two', media_type: 'movie', year: 2012 },
  ], 'a targeted film-series article search is tried when basic title results have no list');

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

console.log('Wikipedia chronology traversal, film-list fallback, and Pages proxy: OK');
