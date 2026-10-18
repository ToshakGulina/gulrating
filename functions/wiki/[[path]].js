// Narrow proxy for Wikipedia's article API used by franchise discovery.
// Only fixed upstreams are permitted; this is not a general-purpose proxy.
const UPSTREAMS = {
  ru: 'https://ru.wikipedia.org/w/api.php',
  en: 'https://en.wikipedia.org/w/api.php',
};

export async function onRequestGet(context) {
  const { request, params } = context;
  const pathParts = Array.isArray(params.path)
    ? params.path
    : String(params.path || '').split('/').filter(Boolean);
  const service = pathParts[0] || '';
  const upstreamUrl = UPSTREAMS[service];
  if (!upstreamUrl || pathParts.length !== 1) {
    return new Response('Not found', { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const target = new URL(upstreamUrl);
  requestUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const headers = { Accept: 'application/json' };

  let upstream;
  try {
    upstream = await fetch(target.toString(), { headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'upstream unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': upstream.ok ? 'public, max-age=86400' : 'no-store',
    },
  });
}
