import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};

const { getSearchQueries, addSearchQuery, clearHistory } = await import('../src/lib/history.js');

addSearchQuery('  Dune  ');
addSearchQuery('Arrival');
addSearchQuery('dUnE');
assert.deepEqual(getSearchQueries(), ['dUnE', 'Arrival'],
  'a new search is stored first and duplicate queries are matched case-insensitively');
addSearchQuery('Blade Runner');
addSearchQuery('The Matrix');
assert.deepEqual(getSearchQueries(), ['The Matrix', 'Blade Runner', 'dUnE'],
  'the three most recent searches are retained');

values.set('gulrating:search_queries', JSON.stringify(['Alien', { old: 'malformed legacy item' }, '  ' , 'AliEn']));
assert.deepEqual(getSearchQueries(), ['Alien'],
  'invalid or duplicate legacy entries cannot break saving/showing search history');
addSearchQuery('Interstellar');
assert.deepEqual(getSearchQueries(), ['Interstellar', 'Alien'],
  'new queries remain usable when the stored list contains malformed legacy data');

values.set('gulrating:recent_titles', JSON.stringify([{ id: 1 }]));
clearHistory();
assert.equal(values.has('gulrating:search_queries'), false);
assert.equal(values.has('gulrating:recent_titles'), false);

globalThis.localStorage = undefined;
const feed = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
assert.match(feed, /const close = \(\) => \{[\s\S]*?searchInput\.value = '';[\s\S]*?searchInput\.focus\(\);/,
  'returning from full-page search clears its committed query so focus reveals recent searches');
assert.match(feed, /addSearchQuery\(query\);[\s\S]*?openSearchResultsPage\(query\)/,
  'pressing Enter records the query before opening full-page results');
console.log('Search history retains recent queries, tolerates malformed legacy entries, and reappears on return: OK');
