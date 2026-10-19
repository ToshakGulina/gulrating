// Fixed same-origin proxy for this project's public Supabase API.
// The client anon key and signed-in user's JWT remain subject to Supabase RLS;
// never add a service-role key here. Only known Supabase API namespaces pass.
const UPSTREAM = 'https://ahpgxyfkbvuabgtrgacu.supabase.co';
const SERVICES = new Set(['rest/v1', 'auth/v1', 'storage/v1', 'realtime/v1']);
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const HOP_BY_HOP = [
  'connection', 'content-length', 'host', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
];

export async function onRequest({ request, params }) {
  if (!METHODS.has(request.method)) return new Response('Method not allowed', { status: 405 });
  const parts = Array.isArray(params?.path) ? params.path : String(params?.path || '').split('/').filter(Boolean);
  const service = parts.slice(0, 2).join('/');
  if (!SERVICES.has(service) || parts.some(part => part === '.' || part === '..')) {
    return new Response('Not found', { status: 404 });
  }

  const incoming = new URL(request.url);
  const destination = new URL(`/${parts.map(encodeURIComponent).join('/')}${incoming.search}`, UPSTREAM);
  const headers = new Headers(request.headers);
  const isWebSocket = headers.get('upgrade')?.toLowerCase() === 'websocket';
  for (const name of HOP_BY_HOP) {
    if (isWebSocket && (name === 'connection' || name === 'upgrade')) continue;
    headers.delete(name);
  }

  try {
    // Forward streaming request/response bodies unchanged. Returning the
    // upstream response directly also preserves the WebSocket upgrade for
    // Supabase Realtime on runtimes that support proxy upgrades.
    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
      init.body = request.body;
      init.duplex = 'half';
    }
    return await fetch(new Request(destination, init));
  } catch (error) {
    return new Response(JSON.stringify({ message: 'Supabase upstream unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
