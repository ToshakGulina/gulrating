// Kinobox: API плееров по ID Кинопоиска, IMDb или названию.
// Зеркала используют playcdnfb.top; api.kinobox.tv оставлен запасным upstream.
// Запрос с сайта: GET /kinobox?kinopoisk=... (или ?imdb=... / ?title=...)

const UPSTREAMS = [
  'https://playcdnfb.top/api/players',
  'https://api.kinobox.tv/api/players',
];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const params = new URLSearchParams();
  const kpId = requestUrl.searchParams.get('kinopoisk') || requestUrl.searchParams.get('kp');
  const imdbId = requestUrl.searchParams.get('imdb');
  const title = requestUrl.searchParams.get('title');

  // У Kinobox API параметр называется kinopoisk; принимаем также короткий kp
  // для совместимости со старыми ссылками.
  if (kpId) params.set('kinopoisk', kpId);
  if (imdbId) params.set('imdb', imdbId);
  if (title) params.set('title', title);
  if (!params.toString()) return json({ error: 'нужен kinopoisk, imdb или title' }, 400);

  let lastErr = '';
  for (const upstream of UPSTREAMS) {
    const dest = new URL(upstream);
    dest.search = params.toString();
    try {
      const response = await fetch(dest.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
      });
      if (!response.ok) {
        lastErr = `${upstream} -> http ${response.status}`;
        continue;
      }
      return new Response(await response.text(), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      lastErr = `${upstream} -> ${(error && error.message) || error}`;
    }
  }
  return json({ error: lastErr || 'upstream unavailable' }, 502);
}
