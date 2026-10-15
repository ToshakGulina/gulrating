// ============================================================================
// ОПЦИОНАЛЬНЫЙ прокси для TMDb через Cloudflare Workers.
// Нужен ТОЛЬКО если api.themoviedb.org блокируется у кого-то из друзей
// (некоторые провайдеры периодически ограничивают доступ).
//
// Как включить:
// 1. Cloudflare Dashboard → Workers & Pages → Create → Workers → "Hello world".
// 2. Вставьте этот код вместо шаблона, нажмите Deploy.
// 3. В настройках воркера: Settings → Variables and Secrets → добавьте
//    секрет TMDB_API_KEY со своим ключом TMDb.
// 4. Скопируйте адрес воркера (вида https://tmdb-proxy.<ваш-логин>.workers.dev)
//    и впишите его в src/config.js в поле TMDB_PROXY_URL.
// 5. Закоммитьте и задеплойте — приложение начнёт ходить за фильмами через прокси.
//
// Воркер не требует авторизации, но и не раскрывает ничего лишнего:
// он умеет только проксировать GET-запросы чтения к api.themoviedb.org.
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight из браузера
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    if (!env.TMDB_API_KEY) {
      return new Response('Прокси не настроен: добавьте секрет TMDB_API_KEY в настройках воркера', {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    // Разрешаем только пути чтения TMDb вида /search/multi, /movie/123, /tv/456
    if (!/^\/(search|movie|tv|genre|configuration)\//.test(url.pathname)) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }

    const target = new URL('https://api.themoviedb.org/3' + url.pathname);
    for (const [key, value] of url.searchParams) {
      if (key === 'api_key') continue; // ключ подставляет воркер, из клиента он не приходит
      target.searchParams.set(key, value);
    }
    target.searchParams.set('api_key', env.TMDB_API_KEY);

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        headers: { Accept: 'application/json' },
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
    } catch (e) {
      return new Response('TMDb недоступен: ' + e.message, { status: 502, headers: CORS_HEADERS });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  },
};
