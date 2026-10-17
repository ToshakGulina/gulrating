#!/usr/bin/env node
// Regression test: cached app shell wins when the host returns an HTTP block.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
