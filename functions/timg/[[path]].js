// Прокси постеров TMDb: /timg/w500/xxx.jpg → image.tmdb.org/t/p/w500/xxx.jpg.
// Нужен по той же причине: CDN постеров гео-блокирует российские IP,
// а серверный край Cloudflare отдаёт картинку всем. Кэш 7 дней.

const UPSTREAM = 'https://image.tmdb.org/t/p';

export async function onRequestGet(context) {
  const { params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : '';
  if (!/^w\d+\//.test(path)) return new Response('Not found', { status: 404 });

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${path}`);
  } catch (e) {
    return new Response('upstream unavailable', { status: 502 });
  }
  if (!upstream.ok) return new Response('not found', { status: upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
