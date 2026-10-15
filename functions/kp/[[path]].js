// Прокси Кинопоиска для Cloudflare Pages (Pages Functions).
// Работает автоматически после деплоя: запросы вида /kp/api/v2.2/films?...
// уходят на kinopoiskapiunofficial.tech с ключом из секрета KINOPOISK_API_KEY
// (или из FALLBACK_KEY, если секрет не задан в дашборде Pages).
//
// Зачем: браузерные запросы к сервису напрямую могут блокироваться CORS,
// а кэш Cloudflare (max-age=86400) экономит дневной лимит токена (~200/сутки)
// на всю компанию — повторные запросы тех же фильмов до сервиса не доходят.
//
// Секрет (по желанию): Pages → Settings → Functions → Environment variables
// → добавить KINOPOISK_API_KEY. Без секрета используется FALLBACK_KEY.

const UPSTREAM = 'https://kinopoiskapiunofficial.tech';
const FALLBACK_KEY = '0MHQ7TX-71WMDSP-HVF6YHV-FMWFRDM';

export async function onRequestGet(context) {
  const { request, env, params } = context;

  const path = Array.isArray(params.path) ? params.path.join('/') : '';
  if (!/^api\//.test(path)) {
    return new Response('Not found', { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const target = new URL(`${UPSTREAM}/${path}`);
  requestUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const key = env.KINOPOISK_API_KEY || FALLBACK_KEY;

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: { 'X-API-KEY': key, Accept: 'application/json' },
    });
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
      'Cache-Control': upstream.ok ? 'public, max-age=86400' : 'no-store',
    },
  });
}
