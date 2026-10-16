// Прокси Kinobox для Cloudflare Pages (Pages Functions).
// Kinobox — сервис, которым зеркала (kinokino.vip и др.) пользуются для
// встраивания плееров: по ID Кинопоиска он выдаёт список чистых плееров
// (озвучки + iframe-адреса) без рекламы и обвязки зеркала.
//
// Запрос: GET /kinobox?kp=14029326  (или ?imdb=tt1234567, или ?title=Название)
// Ответ: JSON api.kinobox.tv как есть: { data: [{ type, iframeUrl, translations: [...] }] }
//
// Зачем прокси: напрямую из браузера api.kinobox.tv блокируется CORS,
// а кэш Cloudflare экономит запросы к API и не светит его с клиентских IP.

// Зеркала пользуют playcdnfb.top (их baseUrl в опциях виджета);
// api.kinobox.tv — дефолт из исходников виджета, держим запасным
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
  const { request } = context;
  const u = new URL(request.url);
  const target = new URL(UPSTREAM);
  if (u.searchParams.get('kp')) target.searchParams.set('kinopoisk', u.searchParams.get('kp'));
  if (u.searchParams.get('imdb')) target.searchParams.set('imdb', u.searchParams.get('imdb'));
  if (u.searchParams.get('title')) target.searchParams.set('title', u.searchParams.get('title'));
  if (!target.search) return json({ error: 'нужен kp, imdb или title' }, 400);

  let lastErr = '';
  for (const up of UPSTREAMS) {
    const dest = new URL(up);
    target.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    try {
      const r = await fetch(dest.toString(), {
        headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
        // Токены в iframeUrl живут недолго — кэшируем коротко
        cf: { cacheTtl: 300 },
      });
      if (!r.ok) {
        lastErr = up + ' -> http ' + r.status;
        continue;
      }
      const body = await r.text();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (e) {
      lastErr = up + ' -> ' + String((e && e.message) || e);
    }
  }
  return json({ error: lastErr || 'upstream unavailable' }, 502);
}
