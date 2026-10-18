#!/usr/bin/env node
// Regression test: offline watch actions avoid network calls, and Wikipedia-backed franchise parts can notify.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = { dispatchEvent() {} };
globalThis.__watchTest = {
  titleCalls: 0,
  collectionCalls: 0,
  franchiseCalls: 0,
  titleDetails: new Map(),
  franchiseParts: [],
};

let source = await readFile(new URL('../src/lib/watchHistory.js', import.meta.url), 'utf8');
source = source.replace(
  "import { getTitleDetails, getCachedTitleDetails, getMovieCollection, getFranchiseTitles } from './tmdb.js';",
  `const { getTitleDetails, getCachedTitleDetails, getMovieCollection, getFranchiseTitles } = {
    getTitleDetails: async (id, type) => { globalThis.__watchTest.titleCalls += 1; return globalThis.__watchTest.titleDetails.get(type + ':' + id); },
    getCachedTitleDetails: (id, type) => globalThis.__watchTest.titleDetails.get(type + ':' + id) || null,
    getMovieCollection: async id => { globalThis.__watchTest.collectionCalls += 1; return { id, name: 'Franchise', parts: [] }; },
    getFranchiseTitles: async () => { globalThis.__watchTest.franchiseCalls += 1; return globalThis.__watchTest.franchiseParts; },
  };`
);
const { addWatchEntry, markWatchDone, checkNewSeasons, getNotifications } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

const today = new Date().toISOString().slice(0, 10);
__watchTest.titleDetails.set('movie:10', {
  id: 10, media_type: 'movie', title: 'Franchise One', collection_id: 99, collection_name: 'Saga'
});
__watchTest.franchiseParts = [
  { id: 10, media_type: 'movie', title: 'Franchise One', release_date: '2020-01-01' },
  { id: 11, media_type: 'movie', title: 'Franchise Two', release_date: today },
];
addWatchEntry({ id: 10, media_type: 'movie', title: 'Franchise One' });
const marked = await markWatchDone('movie:10', { offline: true });
assert.ok(marked.done, 'offline viewing can be marked from cached title data');
assert.equal(__watchTest.titleCalls, 0, 'offline mark-done does not fetch TMDb');
assert.equal(__watchTest.collectionCalls, 0, 'offline mark-done does not fetch collections');

assert.deepEqual(await checkNewSeasons({ offlineOnly: true }), []);
assert.equal(__watchTest.franchiseCalls, 0, 'offline startup does not check Wikipedia/TMDb');
assert.equal(localStorage.getItem('gulrating:season_check_at_v2'), null, 'offline checks do not postpone the next online check');

const movieNotifications = await checkNewSeasons();
assert.equal(movieNotifications.length, 1, 'a released Wikipedia-listed franchise part triggers a notification');
assert.match(movieNotifications[0], /Franchise Two/);
assert.equal(__watchTest.franchiseCalls, 1);
assert.equal(getNotifications()[0].kind, 'new_movie_part');

console.log('Offline watch actions are immediate; Wikipedia franchise releases trigger notifications: OK');
