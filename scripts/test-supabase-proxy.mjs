import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const proxySource = await readFile(new URL('../functions/supabase/[[path]].js', import.meta.url), 'utf8');
const proxyModule = await import(`data:text/javascript;base64,${Buffer.from(proxySource).toString('base64')}`);
const originalFetch = globalThis.fetch;
let upstreamRequest;
globalThis.fetch = async request => {
  upstreamRequest = request;
  return new Response('{"message":"ok"}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

try {
  const request = new Request('https://gulrating.pages.dev/supabase/rest/v1/ratings?select=*&limit=5', {
    headers: { apikey: 'public-anon-key', authorization: 'Bearer user-jwt', prefer: 'return=representation' },
  });
  const response = await proxyModule.onRequest({ request, params: { path: ['rest', 'v1', 'ratings'] } });
  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.url, 'https://ahpgxyfkbvuabgtrgacu.supabase.co/rest/v1/ratings?select=*&limit=5');
  assert.equal(upstreamRequest.headers.get('apikey'), 'public-anon-key');
  assert.equal(upstreamRequest.headers.get('authorization'), 'Bearer user-jwt');
  assert.equal(upstreamRequest.headers.get('prefer'), 'return=representation');

  upstreamRequest = null;
  const blocked = await proxyModule.onRequest({
    request: new Request('https://gulrating.pages.dev/supabase/admin/v1/users'),
    params: { path: ['admin', 'v1', 'users'] },
  });
  assert.equal(blocked.status, 404, 'the function must not become an arbitrary URL proxy');
  assert.equal(upstreamRequest, null);

  const supabaseSource = await readFile(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
  assert.match(supabaseSource, /window\.location\.origin}\/supabase/);
  assert.match(supabaseSource, /storageKey: `sb-\$\{projectRef\}-auth-token`/,
    'switching to the same-origin URL must keep existing local auth sessions');
  const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(workerSource, /url\.pathname\.startsWith\('\/supabase\/'\)[\s\S]*?cache: 'no-store'/,
    'the service worker must never cache authenticated API traffic');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Same-origin Supabase proxy keeps auth headers, restricts upstream routes, and bypasses PWA cache: OK');
