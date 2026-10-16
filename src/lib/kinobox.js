// Kinobox: чистые плееры по ID Кинопоиска (или названию).
// Зеркала вроде kinokino.vip — лишь обёртка: их скрипт ходит в публичный
// API api.kinobox.tv и вставляет полученный iframe. Мы делаем то же самое,
// но без рекламы, счётчиков и обвязки зеркала: берём сразу iframeUrl.
// В браузере напрямую API недоступен (CORS) — ходим через свою Pages
// Function /kinobox (см. functions/kinobox.js).

export async function fetchKinoboxPlayers({ kpId, imdbId, query } = {}) {
  const q = new URLSearchParams();
  if (kpId) q.set('kp', kpId);
  if (imdbId) q.set('imdb', imdbId);
  if (query) q.set('title', query);
  if (!q.toString()) throw new Error('kinobox: пустой запрос');

  const r = await fetch('/kinobox?' + q.toString());
  if (!r.ok) throw new Error('kinobox: http ' + r.status);
  const j = await r.json();
  if (!j) throw new Error('kinobox: пустой ответ');
  if (j.error) throw new Error(typeof j.error === 'string' ? j.error : (j.error.title || 'kinobox: ошибка'));

  const data = Array.isArray(j.data) ? j.data : [];
  return data
    .filter((p) => p && p.iframeUrl)
    .map((p) => {
      const tr = (p.translations && p.translations[0]) || {};
      return {
        type: p.type || 'player',
        name: tr.name || p.type || 'плеер',
        quality: tr.quality || '',
        url: p.iframeUrl,
      };
    });
}
