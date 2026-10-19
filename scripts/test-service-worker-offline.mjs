#!/usr/bin/env node
// Regression test: cached app shell wins when the host returns an HTTP block.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const origin = 'https://gulrating.pages.dev';
const cache = new Map();
const listeners = new Map();
const keyOf = input => {
  const url = new URL(typeof input === 'string' ? input : input.url, origin);
  return `${url.pathname}${url.search}`;
};
const caches = {
  async match(request) { return cache.get(keyOf(request)) || null; },
  async open() {
    return { async put(request, response) { cache.set(keyOf(request), response); } };
  },
  async keys() { return ['gulrating-v-test']; },
  async delete() { return true; },
};
const self = {
  location: new URL(`${origin}/sw.js`),
  addEventListener(name, callback) { listeners.set(name, callback); },
};
const networkCalls = [];

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const shellAssetsText = source.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
const shellAssets = new Set([...shellAssetsText.matchAll(/'([^']+)'/g)].map(match => match[1]));
const srcRoot = new URL('../src/', import.meta.url);
async function collectModules(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(new URL(prefix, directory), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectModules(directory, relative));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(`/src/${relative}`);
  }
  return files;
}
for (const modulePath of await collectModules(srcRoot)) {
  assert.ok(shellAssets.has(modulePath), `service worker must precache local module ${modulePath}`);
}
vm.runInNewContext(source, {
  self, caches, URL, Response,
  fetch: async (...args) => {
    networkCalls.push(args);
    return new Response('blocked', { status: 403 });
  },
});

async function requestFromWorker(url, mode = 'cors') {
  let responsePromise;
  listeners.get('fetch')({
    request: { method: 'GET', url: new URL(url, origin).href, mode },
    respondWith(value) { responsePromise = value; },
  });
  return responsePromise;
}

cache.set('/src/main.js', new Response('cached main module', { status: 200 }));
const blockedModule = await requestFromWorker('/src/main.js');
assert.equal(await blockedModule.text(), 'cached main module', 'HTTP failures fall back to cached JS modules');

cache.set('/index.html', new Response('cached app shell', { status: 200 }));
const blockedNavigation = await requestFromWorker('/?title=movie%3A42', 'navigate');
assert.equal(await blockedNavigation.text(), 'cached app shell', 'deep-link navigations fall back to cached index.html');

cache.set('/supabase/rest/v1/ratings', new Response('stale private data', { status: 200 }));
const proxyResponse = await requestFromWorker('/supabase/rest/v1/ratings');
assert.equal(await proxyResponse.text(), 'blocked', 'Supabase proxy responses must not be read from Cache Storage');
assert.equal(networkCalls.at(-1)[1].cache, 'no-store', 'Supabase requests must be network-only');

cache.set('/data/full/manifest.json', new Response('old catalog manifest', { status: 200 }));
const catalogResponse = await requestFromWorker('/data/full/manifest.json');
assert.equal(await catalogResponse.text(), 'old catalog manifest', 'catalog may fall back to its last manifest while offline');
assert.ok(networkCalls.some(([request]) => request.url.endsWith('/data/full/manifest.json')),
  'catalog manifests are revalidated online instead of remaining cache-first');

console.log('Service worker keeps Supabase network-only, revalidates catalog metadata, and falls back to cached shell/data offline: OK');
