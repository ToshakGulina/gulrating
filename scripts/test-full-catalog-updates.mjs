import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const generator = await read('../scripts/build-full-catalog.mjs');
const downloader = await read('../src/lib/fullCatalog.js');
const profile = await read('../src/components/Profile.js');
const workflow = await read('../.github/workflows/offline-catalog-full.yml');

assert.match(generator, /createHash\('sha256'\)/);
assert.match(generator, /chunk-\$\{String\(chunks\.length\)[\s\S]*?\$\{sha256\.slice\(0, 16\)\}\.json/,
  'chunk names must be content-addressed so unchanged chunks can be reused');
assert.match(generator, /const version = createHash\('sha256'\)/);
assert.match(workflow, /next\.version === current\.version/,
  'the scheduled publisher should skip a no-op release');
assert.match(downloader, /PENDING_META_KEY/);
assert.match(downloader, /setFullCatalogMeta\(manifest\)[\s\S]*?setPendingCatalogMeta\(null\)[\s\S]*?idbKeepOnly/,
  'the installed manifest changes only after all downloaded chunks are present');
assert.match(downloader, /setPendingCatalogMeta\(\{ \.\.\.manifest, partial: done \}\)/,
  'interrupted update progress is recorded separately from the active catalog');
assert.match(profile, /id="full-db-btn"[\s\S]*?id="full-db-delete-btn"/);
assert.match(profile, /Обновить полную базу/);
assert.match(profile, /Проверить обновления/);

const proxySource = await read('../functions/data/full/[[path]].js');
const proxy = await import(`data:text/javascript;base64,${Buffer.from(proxySource).toString('base64')}`);
const originalFetch = globalThis.fetch;
let requestedUrl = '';
globalThis.fetch = async url => {
  requestedUrl = String(url);
  return new Response('{"v":1,"chunks":[]}', { status: 200 });
};
try {
  const response = await proxy.onRequestGet({
    request: new Request('https://gulrating.pages.dev/data/full/manifest.json'),
    params: { path: ['manifest.json'] },
  });
  assert.equal(response.status, 200);
  assert.equal(requestedUrl, 'https://raw.githubusercontent.com/ToshakGulina/gulrating/data-full/data/full/manifest.json');
  assert.match(response.headers.get('cache-control'), /max-age=60/);
  const invalid = await proxy.onRequestGet({
    request: new Request('https://gulrating.pages.dev/data/full/anything.txt'),
    params: { path: ['anything.txt'] },
  });
  assert.equal(invalid.status, 404, 'the catalog route must not become an arbitrary GitHub proxy');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Full catalog updates are versioned, resumable, atomic, and served through a restricted same-origin route: OK');
