#!/usr/bin/env node
// Regression test for the Pages Function fallback used when browser CORS fails.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../functions/kinobox.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { onRequestGet } = await import(moduleUrl);
const originalFetch = globalThis.fetch;
let requestedUrl = null;

globalThis.fetch = async (input) => {
  requestedUrl = new URL(input);
  return new Response(JSON.stringify({ data: [{ type: 'test', iframeUrl: 'https://player.example/embed' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

try {
  const response = await onRequestGet({
    request: new Request('https://gulrating.pages.dev/kinobox?kinopoisk=12345&title=Test'),
  });
  assert.equal(response.status, 200);
  assert.equal(requestedUrl.hostname, 'playcdnfb.top');
  assert.equal(requestedUrl.searchParams.get('kinopoisk'), '12345');
  assert.equal(requestedUrl.searchParams.get('title'), 'Test');
  assert.deepEqual(await response.json(), { data: [{ type: 'test', iframeUrl: 'https://player.example/embed' }] });

  const invalid = await onRequestGet({ request: new Request('https://gulrating.pages.dev/kinobox') });
  assert.equal(invalid.status, 400);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Kinobox Pages Function proxy mapping: OK');
