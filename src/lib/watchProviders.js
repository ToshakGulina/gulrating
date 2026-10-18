const ACCESS_TYPES = [
  ['flatrate', 'подписка'],
  ['free', 'бесплатно'],
  ['ads', 'с рекламой'],
  ['rent', 'аренда'],
  ['buy', 'покупка'],
];

function normalizeProviderName(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

export function findWatchProviderOffer(regionData, service) {
  const isKinopoisk = service === 'kinopoisk';
  const matches = isKinopoisk
    ? (name) => /кинопоиск|kinopoisk/.test(name)
    : service === 'ivi'
      ? (name) => name === 'ivi' || name === 'иви'
      : () => false;

  for (const [category, accessLabel] of ACCESS_TYPES) {
    const provider = (regionData && Array.isArray(regionData[category]) ? regionData[category] : [])
      .find(item => matches(normalizeProviderName(item && item.provider_name)));
    if (provider) return { provider, category, accessLabel };
  }
  return null;
}

export function kinopoiskOfficialTitleUrl(kpId, mediaType = 'movie') {
  if (!kpId || !/^\d+$/.test(String(kpId))) return '';
  const path = mediaType === 'tv' ? 'series' : 'film';
  return `https://www.kinopoisk.ru/${path}/${encodeURIComponent(String(kpId))}/`;
}

export function iviSearchUrl(title, year = '') {
  const query = [String(title || '').trim(), String(year || '').trim()].filter(Boolean).join(' ');
  if (!query) return '';
  const url = new URL('https://www.ivi.ru/search/');
  url.searchParams.set('q', query);
  return url.toString();
}
