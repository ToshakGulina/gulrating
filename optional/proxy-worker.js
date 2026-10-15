// ============================================================================
// ОПЦИОНАЛЬНЫЙ универсальный прокси через Cloudflare Workers: TMDb + Кинопоиск.
//
// Зачем нужен:
// - api.themoviedb.org периодически блокируется отдельными провайдерами;
// - рейтинг Кинопоиска берётся из неофициального API
//   kinopoiskapiunofficial.tech (официальный закрыт для физлиц); прокси
//   дополнительно кэширует ответы на сутки, экономя дневной лимит токена.
//
// Как включить:
// 1. Cloudflare Dashboard → Workers & Pages → Create → Worker («Hello world»).
// 2. Вставьте этот код вместо шаблона, нажмите Deploy.
// 3. Settings → Variables and Secrets → добавьте секреты:
//      TMDB_API_KEY       — ваш ключ TMDb (обязательно, если используете /tmdb);
//      KINOPOISK_API_KEY  — токен kinopoiskapiunofficial.tech (только если нужен /kp).
// 4. В src/config.js впишите адрес воркера:
//      TMDB_PROXY_URL      = "https://<имя>.workers.dev/tmdb"   (опционально)
//      KINOPOISK_PROXY_URL = "https://<имя>.workers.dev/kp"      (опционально)
//    Старые значения TMDB_PROXY_URL без префикса тоже продолжают работать:
//    воркер распознаёт «голые» пути TMDb ради совместимости.
// 5. Закоммитьте и задеплойте приложение.
//
// Воркер умеет только проксировать GET-запросы чтения и не раскрывает ключи:
// они лежат в секретах воркера, из браузера не приходят и не логируются.
// ============================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(body, status, contentType, cacheSeconds) {
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': contentType || 'application/json',
      'Cache-Control': `public, max-age=${cacheSeconds || 0}`,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return respond('Method not allowed', 405, 'text/plain');
    }

    let upstreamUrl = null;
    let apiKeyHeader = null;
    let cacheSeconds = 3600;

    const path = url.pathname;
    const isTmdbPath = /^\/(search|movie|tv|genre|configuration)\//.test(path);

    if (path.startsWith('/tmdb/')) {
      // Явный префикс TMDb
      if (!env.TMDB_API_KEY) return respond('Прокси: добавьте секрет TMDB_API_KEY', 500, 'text/plain');
      upstreamUrl = new URL('https://api.themoviedb.org/3' + path.slice('/tmdb'.length));
      for (const [k, v] of url.searchParams) if (k !== 'api_key') upstreamUrl.searchParams.set(k, v);
      upstreamUrl.searchParams.set('api_key', env.TMDB_API_KEY);
    } else if (path.startsWith('/kp/')) {
      // Явный префикс Кинопоиска (неофициальный API kinopoiskapiunofficial.tech).
      // Кэшируем ответы на сутки: у токена бесплатный лимит ~200 запросов/день.
      if (!env.KINOPOISK_API_KEY) return respond('Прокси: добавьте секрет KINOPOISK_API_KEY', 500, 'text/plain');
      upstreamUrl = new URL('https://kinopoiskapiunofficial.tech' + path.slice('/kp'.length));
      for (const [k, v] of url.searchParams) upstreamUrl.searchParams.set(k, v);
      apiKeyHeader = env.KINOPOISK_API_KEY;
      cacheSeconds = 86400;
    } else if (isTmdbPath) {
      // Обратная совместимость: TMDB_PROXY_URL без префикса
      if (!env.TMDB_API_KEY) return respond('Прокси: добавьте секрет TMDB_API_KEY', 500, 'text/plain');
      upstreamUrl = new URL('https://api.themoviedb.org/3' + path);
      for (const [k, v] of url.searchParams) if (k !== 'api_key') upstreamUrl.searchParams.set(k, v);
      upstreamUrl.searchParams.set('api_key', env.TMDB_API_KEY);
    } else {
      return respond('Not found', 404, 'text/plain');
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl.toString(), {
        headers: {
          Accept: 'application/json',
          ...(apiKeyHeader ? { 'X-API-KEY': apiKeyHeader } : {}),
        },
        cf: { cacheTtl: cacheSeconds, cacheEverything: true },
      });
    } catch (e) {
      return respond('Апстрим недоступен: ' + e.message, 502, 'text/plain');
    }

    const body = await upstream.text();
    return respond(body, upstream.status, upstream.headers.get('Content-Type') || 'application/json', cacheSeconds);
  },
};
