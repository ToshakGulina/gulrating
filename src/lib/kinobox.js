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

// Kinobox sometimes reports several iframe variants for one voice. Prefer the
// highest advertised resolution; this does not inspect a provider's cross-origin
// iframe or its private adaptive-stream menu.
export function qualityRank(value) {
  const quality = String(value || '').toLowerCase().replace(/к/g, 'k');
  if (/\b8k\b|4320/.test(quality)) return 4320;
  if (/\b4k\b|\buhd\b|2160/.test(quality)) return 2160;
  if (/\b2k\b|1440/.test(quality)) return 1440;
  const match = quality.match(/(?:^|[^0-9])(1080|960|720|576|540|480|360|240)(?:p|i)?(?:$|[^0-9])/);
  if (match) return Number(match[1]);
  if (/\b(?:full hd|fhd)\b/.test(quality)) return 1080;
  if (/\bhd\b/.test(quality)) return 720;
  if (/\bsd\b/.test(quality)) return 480;
  return 0;
}

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
          url,
        });
      }
    } else if (p.iframeUrl) {
      out.push({ type: p.type || 'player', name: 'Основная озвучка', quality: '', url: p.iframeUrl });
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
