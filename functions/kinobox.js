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

const UPSTREAM = 'https://api.kinobox.tv/api/players';
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

  try {
    const r = await fetch(target.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': BROWSER_UA },
      // Токены в iframeUrl живут недолго — кэшируем коротко
      cf: { cacheTtl: 300 },
    });
    const body = await r.text();
    return new Response(body, {
      status: r.ok ? 200 : r.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
}
