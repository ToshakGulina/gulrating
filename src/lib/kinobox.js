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
          name: (tr && tr.name) || 'Основная озвучка',
          quality: (tr && tr.quality) || '',
          embed: (tr && tr.embed) || p.embed || 'any',
          url,
        });
      }
    } else if (p.iframeUrl) {
      out.push({ type: p.type || 'player', name: 'Основная озвучка', quality: '', embed: p.embed || 'any', url: p.iframeUrl });
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

  // Три пути: напрямую из браузера (зеркала звонят оттуда же), затем оба
  // апстрима через нашу Function. Все ошибки копим — пользователь должен
  // видеть ТОЧНУЮ причину отказа, а не молчаливый фолбэк
  const errors = [];
  for (const base of DIRECT_BASES) {
    try {
      const r = await fetch(`${base}/api/players?${qs}`, { cache: 'no-store' });
      if (!r.ok) {
        errors.push(`${base}: http ${r.status}`);
        continue;
      }
      const list = flatten(await r.json());
      if (list.length) return list;
      errors.push(`${base}: пустой список`);
    } catch (e) {
      errors.push(`${base}: ${(e && e.message) || e}`);
    }
  }
  try {
    const r2 = await fetch('/kinobox?' + qs, { cache: 'no-store' });
    if (!r2.ok) throw new Error('http ' + r2.status);
    const list = flatten(await r2.json());
    if (list.length) return list;
    errors.push('/kinobox: пустой список');
  } catch (e) {
    errors.push(`/kinobox: ${(e && e.message) || e}`);
  }
  throw new Error(errors.join(' | ') || 'плееры не найдены');
}
