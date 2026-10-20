#!/usr/bin/env node
// A failed WebView/offline send must retain every queued rating for retry.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
} });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
globalThis.__saveRating = async () => { throw new Error('Failed to fetch'); };

try {
  let source = await readFile(new URL('../src/lib/offline.js', import.meta.url), 'utf8');
  source = source.replace(
    "import { saveRating } from './ratings.js';",
    'const saveRating = (...args) => globalThis.__saveRating(...args);'
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { enqueueRating, flushPendingRatings, getPendingRatings, networkLikeError } = await import(moduleUrl);
  assert.equal(networkLikeError(new Error('Permission denied (403)')), false,
    'a browser offline hint does not turn an authorization failure into a network failure');

  enqueueRating({ title_id: 1, media_type: 'movie', rating: 7 });
  enqueueRating({ title_id: 2, media_type: 'tv', rating: 8 });
  enqueueRating({ title_id: 3, media_type: 'movie', rating: 9 });
  assert.equal(await flushPendingRatings('user-1'), 0);
  assert.equal(getPendingRatings().length, 3,
    'a failed connection retains both the failed item and later items not attempted');

  globalThis.__saveRating = async () => {};
  assert.equal(await flushPendingRatings('user-1'), 3);
  assert.deepEqual(getPendingRatings(), [], 'all ratings are removed only after successful saves');
  console.log('Failed rating flush retains the complete queue and retries it successfully: OK');
} finally {
  delete globalThis.__saveRating;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete globalThis.localStorage;
}
