import assert from 'node:assert/strict';

const dbData = new Map();
const localData = new Map();
class FakeTransaction {
  constructor() { this.oncomplete = null; this.onerror = null; }
  finish() { queueMicrotask(() => this.oncomplete?.()); }
  objectStore() {
    const tx = this;
    return {
      get(key) {
        const request = {};
        queueMicrotask(() => { request.result = dbData.get(key); request.onsuccess?.(); });
        return request;
      },
      put(value, key) { dbData.set(key, value); tx.finish(); },
      clear() { dbData.clear(); tx.finish(); },
      openCursor() {
        const request = {};
        const keys = [...dbData.keys()];
        const advance = index => queueMicrotask(() => {
          if (index >= keys.length) {
            request.result = null;
            request.onsuccess?.();
            tx.finish();
            return;
          }
          const key = keys[index];
          request.result = {
            key,
            delete() { dbData.delete(key); },
            continue() { advance(index + 1); },
          };
          request.onsuccess?.();
        });
        advance(0);
        return request;
      },
    };
  }
}

let dbOpened = false;
globalThis.localStorage = {
  getItem: key => localData.get(key) ?? null,
  setItem: (key, value) => localData.set(key, String(value)),
  removeItem: key => localData.delete(key),
};
globalThis.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        objectStoreNames: { contains: () => dbOpened },
        createObjectStore() { dbOpened = true; },
        transaction() { return new FakeTransaction(); },
      };
      if (!dbOpened) request.onupgradeneeded?.();
      dbOpened = true;
      request.onsuccess?.();
    });
    return request;
  },
};

const oldMeta = { version: 'v1', total: 1, chunks: [{ file: 'old.json', first: 'old', count: 1 }] };
localData.set('gulrating:full_catalog_meta', JSON.stringify(oldMeta));
dbData.set('old.json', JSON.stringify([[1, 'm', 'Old film', '2020', null, 7]]));

const nextManifest = {
  v: 1,
  version: 'v2',
  updated: '2026-10-19T00:00:00.000Z',
  total: 1,
  bytes: 40,
  chunks: [{ file: 'new-a.json', first: 'new', count: 1 }, { file: 'new-b.json', first: 'newer', count: 1 }],
};
let failSecondChunk = true;
const fetchedChunks = [];
globalThis.fetch = async input => {
  const url = String(input);
  if (url.endsWith('manifest.json')) return new Response(JSON.stringify(nextManifest));
  if (url.endsWith('new-a.json')) {
    fetchedChunks.push('new-a.json');
    return new Response(JSON.stringify([[2, 'm', 'New film', '2024', null, 8]]));
  }
  if (url.endsWith('new-b.json')) {
    fetchedChunks.push('new-b.json');
    if (failSecondChunk) return new Response('', { status: 503 });
    return new Response(JSON.stringify([[3, 't', 'Newer show', '2025', null, 9]]));
  }
  return new Response('', { status: 404 });
};

const catalog = await import('../src/lib/fullCatalog.js');
const firstAttempt = await catalog.downloadFullCatalog();
assert.equal(firstAttempt, null, 'an interrupted update must not be marked complete');
assert.equal(catalog.getFullCatalogMeta().version, 'v1', 'the previous complete manifest stays active');
assert.equal(catalog.getFullCatalogPendingMeta().partial, 1, 'progress is saved separately');
assert.equal((await catalog.searchFullCatalog('old'))[0]?.title, 'Old film', 'the old catalog stays searchable');
assert.deepEqual(fetchedChunks, ['new-a.json', 'new-b.json']);

failSecondChunk = false;
const secondAttempt = await catalog.downloadFullCatalog();
assert.equal(secondAttempt.version, 'v2');
assert.equal(catalog.getFullCatalogMeta().version, 'v2');
assert.equal(catalog.getFullCatalogPendingMeta(), null);
assert.deepEqual(fetchedChunks, ['new-a.json', 'new-b.json', 'new-b.json'], 'completed content-addressed chunks are reused on resume');
assert.equal((await catalog.searchFullCatalog('newer'))[0]?.title, 'Newer show');
assert.equal(dbData.has('old.json'), false, 'obsolete chunks are removed only after update activation');

console.log('Full catalog update failure preserves the old database; resume reuses chunks and atomically activates the new version: OK');
