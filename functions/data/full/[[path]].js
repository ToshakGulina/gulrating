// Serve the generated full offline catalog through the app's own Pages domain.
// This lets the PWA use the same origin (and avoids depending on client access
// to raw GitHub/jsDelivr). Only catalog manifest/chunk filenames are exposed.
const UPSTREAM = 'https://raw.githubusercontent.com/ToshakGulina/gulrating/data-full/data/full';
const CHUNK_PATTERN = /^chunk-\d{3}(?:-[a-f0-9]{16})?\.json$/;

export async function onRequestGet({ request, params }) {
  const parts = Array.isArray(params?.path) ? params.path : String(params?.path || '').split('/').filter(Boolean);
  if (parts.length !== 1 || (parts[0] !== 'manifest.json' && !CHUNK_PATTERN.test(parts[0]))) {
    return new Response('Not found', { status: 404 });
  }

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${parts[0]}`, { headers: { Accept: 'application/json' } });
  } catch (error) {
    return new Response('Catalog source unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }

  if (!upstream.ok) return new Response('Catalog file not found', { status: upstream.status });
  const isManifest = parts[0] === 'manifest.json';
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': isManifest ? 'public, max-age=60' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
