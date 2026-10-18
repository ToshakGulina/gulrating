#!/usr/bin/env node
// Regression test: ratings remain intact while title statuses move independently.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const calls = [];
const ratings = new Map();
const localValues = new Map();
globalThis.localStorage = {
  getItem(key) { return localValues.get(key) ?? null; },
  setItem(key, value) { localValues.set(key, String(value)); },
  removeItem(key) { localValues.delete(key); },
};
const fakeSupabase = {
  from(table) {
    const query = { table, action: 'select', payload: null, filters: [] };
    const builder = {
      select() { return builder; },
      eq(column, value) { query.filters.push([column, value]); return builder; },
      maybeSingle: async () => ({ data: table === 'titles' ? { id: 42 } : table === 'ratings' ? (ratings.get(String(query.filters.find(([key]) => key === 'title_id')?.[1])) || null) : null, error: null }),
      upsert(payload) {
        query.action = 'upsert';
        query.payload = payload;
        calls.push({ ...query, filters: [...query.filters] });
        if (table === 'ratings') ratings.set(String(payload.title_id), { id: 'rating-1', ...payload });
        return builder;
      },
      delete() {
        query.action = 'delete';
        calls.push({ ...query, filters: [...query.filters] });
        return builder;
      },
      single: async () => ({ data: { id: 'saved' }, error: null }),
      then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject); },
    };
    return builder;
  },
};

let source = await readFile(new URL('../src/lib/ratings.js', import.meta.url), 'utf8');
source = source.replace("import { supabase } from './supabase.js';", 'const supabase = globalThis.__testSupabase;');
source = source.replace("import { getTitleDetails } from './tmdb.js';", 'const getTitleDetails = async () => { throw new Error("unexpected title fetch"); };');
globalThis.__testSupabase = fakeSupabase;
const { saveRating, setUserTitleStatus, queueUserTitleStatus, getPendingTitleStatuses, getCachedUserTitleStatus, syncPendingTitleStatuses } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

await saveRating('user-1', 42, 'movie', 8.3, 'Great');
assert.equal(ratings.get('42')?.rating, 8.3, 'saving an 8.3 rating preserves the rating row');
assert.ok(calls.some(call => call.table === 'watchlist' && call.action === 'delete'), 'saving a rating removes its watchlist entry');
assert.ok(calls.some(call => call.table === 'title_statuses' && call.action === 'upsert' && call.payload.status === 'watched'), 'saving a rating sets status to watched');

await assert.rejects(
  setUserTitleStatus('user-1', 42, 'movie', 'watchlist'),
  /Оценённый тайтл/,
  'a rated title cannot be moved into the watchlist'
);
await setUserTitleStatus('user-1', 42, 'movie', 'in_progress');
assert.equal(ratings.get('42')?.rating, 8.3, 'changing a title status never deletes its rating');
assert.ok(calls.some(call => call.table === 'title_statuses' && call.action === 'upsert' && call.payload.status === 'in_progress'), 'the new status is saved');
assert.equal(calls.some(call => call.table === 'ratings' && call.action === 'delete'), false, 'status changes never delete ratings');

localStorage.setItem('gulrating:profile_snapshot:user-1', JSON.stringify({
  ratings: [{ title_id: 42, rating: 8.3, comment: 'Great' }],
  titleStatuses: [{ title_id: 42, status: 'in_progress' }],
  watchlist: [],
}));
assert.equal(getCachedUserTitleStatus('user-1', 42).currentStatus, 'in_progress', 'offline card status comes from the cached profile');
queueUserTitleStatus('user-1', 42, 'movie', 'dropped');
assert.equal(getCachedUserTitleStatus('user-1', 42).currentStatus, 'dropped', 'a queued offline status overrides the cached profile');
queueUserTitleStatus('user-1', 42, 'movie', 'dropped');
const queued = getPendingTitleStatuses('user-1');
assert.equal(queued.length, 1, 'a newer offline status replaces the older pending status for that title');
assert.equal(queued[0].status, 'dropped');
assert.equal(await syncPendingTitleStatuses('user-1'), 1, 'queued statuses sync when connectivity returns');
assert.equal(localStorage.getItem('gulrating:pending_title_statuses:user-1'), null, 'synced queue is cleared');
assert.ok(calls.some(call => call.table === 'title_statuses' && call.action === 'upsert' && call.payload.status === 'dropped'), 'offline status is eventually saved remotely');

delete globalThis.__testSupabase;
delete globalThis.localStorage;
console.log('Title status transitions preserve ratings, and offline status changes queue for sync: OK');
