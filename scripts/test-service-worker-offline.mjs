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
vm.runInNewContext(source, { self, caches, URL, Response, fetch: async () => new Response('blocked', { status: 403 }) });

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

console.log('Service worker falls back to cached shell on HTTP blocks and deep links: OK');
