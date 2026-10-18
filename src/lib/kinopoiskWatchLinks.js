function isServiceProvider(name, service) {
  const normalized = String(name || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  if (service === 'kinopoisk') return /кино\s*поиск|kinopoisk/.test(normalized);
  if (service === 'ivi') return normalized === 'иви' || /^ivi(?:\b|\.ru)/.test(normalized);
  return false;
}

function isServiceHost(host, service) {
  if (service === 'kinopoisk') return host === 'kinopoisk.ru' || host.endsWith('.kinopoisk.ru');
  if (service === 'ivi') return host === 'ivi.ru' || host.endsWith('.ivi.ru');
  return false;
}

function isTitlePath(pathname, service) {
  if (service === 'kinopoisk') return /^\/(?:film|series)\/[^/]+/i.test(pathname);
  if (service === 'ivi') return /^\/watch\/[^/]+/i.test(pathname);
  return false;
}

// Возвращаем только прямую ссылку, пришедшую от watchability API КП.
// Никаких URL из provider availability и поисковых страниц как fallback.
export function getOfficialWatchUrl(watchability, service) {
  if (!Array.isArray(watchability)) return '';
  for (const item of watchability) {
    if (!isServiceProvider(item && item.name, service) || !item.url) continue;
    try {
      const url = new URL(item.url);
      if (url.protocol === 'https:' && isServiceHost(url.hostname.toLowerCase(), service) && isTitlePath(url.pathname, service)) {
        return url.toString();
      }
    } catch (e) {
      // Некорректные URL из внешнего API не выводим в карточку.
    }
  }
  return '';
}
