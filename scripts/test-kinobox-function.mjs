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

  // Browser playback uses dynamic iframeUrl values returned for each provider,
  // rather than loading the Kinokino/Brogiro mirror page.
  const clientSource = await readFile(new URL('../src/lib/kinobox.js', import.meta.url), 'utf8');
  const clientUrl = `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`;
  const { fetchKinoboxPlayers } = await import(clientUrl);
  const directPlayers = [
    { type: 'Alloha', embed: 'any', translations: [{ name: 'Дубляж', quality: '4K', iframeUrl: 'https://kurolesya.link/balancer-api/iframe?movie_id=1171&token=fresh' }] },
    { type: 'Turbo', iframeUrl: 'https://api.nextembed.ws/embed/movie/1621' },
  ];
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(input);
    return new Response(JSON.stringify({ data: directPlayers }), { status: 200 });
  };
  const directList = await fetchKinoboxPlayers({ kpId: '12345' });
  assert.equal(requestedUrl.hostname, 'playcdnfb.top');
  assert.deepEqual(directList.map(({ type, embed, url }) => ({ type, embed, url })), [
    { type: 'Alloha', embed: 'any', url: 'https://kurolesya.link/balancer-api/iframe?movie_id=1171&token=fresh' },
    { type: 'Turbo', embed: 'any', url: 'https://api.nextembed.ws/embed/movie/1621' },
  ]);
  assert.ok(directList.every((player) => !player.url.includes('brogiro') && !player.url.includes('kinokino')));
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Kinobox proxy and direct iframe URL mapping: OK');
