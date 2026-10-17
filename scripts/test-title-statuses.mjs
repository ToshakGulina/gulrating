#!/usr/bin/env node
// Regression test: ratings remain intact while title statuses move independently.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const calls = [];
const ratings = new Map();
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
const { saveRating, setUserTitleStatus } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

await saveRating('user-1', 42, 'movie', 8.3, 'Great');
assert.equal(ratings.get('42')?.rating, 8.3, 'saving an 8.3 rating preserves the rating row');
assert.equal(calls.some(call => call.table === 'watchlist'), false, 'saving a rating does not change watchlist status');
assert.equal(calls.some(call => call.table === 'title_statuses'), false, 'saving a rating does not change title status');

await setUserTitleStatus('user-1', 42, 'movie', 'watchlist');
assert.ok(calls.some(call => call.table === 'watchlist' && call.action === 'upsert'), 'the title card can add a rated title to watch later');
await setUserTitleStatus('user-1', 42, 'movie', 'in_progress');
assert.equal(ratings.get('42')?.rating, 8.3, 'changing a title status never deletes its rating');
assert.ok(calls.some(call => call.table === 'title_statuses' && call.action === 'upsert' && call.payload.status === 'in_progress'), 'the new status is saved');
assert.equal(calls.some(call => call.table === 'ratings' && call.action === 'delete'), false, 'status changes never delete ratings');

delete globalThis.__testSupabase;
console.log('Saving ratings leaves status untouched; card status changes preserve ratings: OK');
