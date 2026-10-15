// Прокси TMDb для Cloudflare Pages: запросы /tmdb/... уходят на
// api.themoviedb.org СЕРВЕРНЫМ боком (Cloudflare), поэтому работают даже
// там, где сам TMDb гео-блокирует клиентские IP (Россия: GeoDNS отдаёт
// 127.0.0.1 на прямые запросы из браузера). Клиент (tmdb.js) сначала пробует
// напрямую и автоматически падает сюда при сетевой ошибке.
// Кэш Cloudflare 6 часов экономит квоту ключа на всю компанию.

const UPSTREAM = 'https://api.themoviedb.org/3';
const FALLBACK_KEY = 'd39e2fce46e85938f7a896c767301d28';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const path = Array.isArray(params.path) ? params.path.join('/') : '';
  if (!/^(movie|tv|search|discover|genre|trending)/.test(path)) {
    return new Response('Not found', { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const target = new URL(`${UPSTREAM}/${path}`);
  // язык по умолчанию русский, если клиент не передал свой
  if (!requestUrl.searchParams.has('language')) target.searchParams.set('language', 'ru-RU');
  target.searchParams.set('include_adult', 'false');
  requestUrl.searchParams.forEach((value, key) => {
    if (key !== 'api_key') target.searchParams.set(key, value);
  });
  target.searchParams.set('api_key', env.TMDB_API_KEY || FALLBACK_KEY);

  let upstream;
  try {
    upstream = await fetch(target.toString(), { headers: { Accept: 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upstream unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': upstream.ok ? 'public, max-age=21600' : 'no-store',
    },
  });
}
