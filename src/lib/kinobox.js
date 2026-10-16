// Kinobox: чистые плееры по ID Кинопоиска (или названию).
// Зеркала вроде kinokino.vip — лишь обёртка: их виджет kinobox.js дёргает
// публичный API «/api/players?kinopoisk=…» (у зеркал baseUrl playcdnfb.top)
// и вставляет полученные iframe. Мы делаем то же, но без рекламы, счётчиков
// и обвязки зеркала: берём сразу адреса плееров.
//
// Порядок запросов:
//  1) напрямую из браузера в playcdnfb.top и api.kinobox.tv — зеркала звонят
//     туда же из браузера, поэтому API отдаёт CORS-заголовки;
//  2) через свою Pages Function /kinobox (серверный обход, если браузерный
//     запрос упёрся в CORS/блокировку).
// Каждый плеер раскрываем в кнопки по озвучкам: у translations свои iframeUrl.

const DIRECT_BASES = ['https://playcdnfb.top', 'https://api.kinobox.tv'];

function flatten(j) {
  if (!j) throw new Error('kinobox: пустой ответ');
  if (j.error) throw new Error(typeof j.error === 'string' ? j.error : (j.error.title || 'kinobox: ошибка'));
  const data = Array.isArray(j.data) ? j.data : [];
  const out = [];
  for (const p of data) {
    if (!p) continue;
    const trs = Array.isArray(p.translations) ? p.translations : [];
    if (trs.length) {
      for (const tr of trs) {
        const url = (tr && tr.iframeUrl) || p.iframeUrl;
        if (!url) continue;
        out.push({
          type: p.type || 'player',
          name: (tr && tr.name) || p.type || 'плеер',
          quality: (tr && tr.quality) || '',
          url,
        });
      }
    } else if (p.iframeUrl) {
      out.push({ type: p.type || 'player', name: p.type || 'плеер', quality: '', url: p.iframeUrl });
    }
  }
  return out;
}

export async function fetchKinoboxPlayers({ kpId, imdbId, query } = {}) {
  const q = new URLSearchParams();
  if (kpId) q.set('kinopoisk', kpId);
  if (imdbId) q.set('imdb', imdbId);
  if (query) q.set('title', query);
  if (!q.toString()) throw new Error('kinobox: пустой запрос');
  const qs = q.toString();

  // 1) напрямую: зеркала делают ровно этот запрос из браузера
  for (const base of DIRECT_BASES) {
    try {
      const r = await fetch(`${base}/api/players?${qs}`);
      if (!r.ok) continue;
      const list = flatten(await r.json());
      if (list.length) return list;
    } catch (e) {
      // CORS или сеть — пробуем следующий адрес, затем прокси
    }
  }

  // 2) серверный обход через нашу Function
  const r2 = await fetch('/kinobox?' + qs);
  if (!r2.ok) throw new Error('kinobox: http ' + r2.status);
  const list = flatten(await r2.json());
  if (!list.length) throw new Error('kinobox: пусто');
  return list;
}
