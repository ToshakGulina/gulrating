const EPISODE_KEY_PATTERN = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,4})(?:$|[^a-z0-9])/i;
const X_EPISODE_PATTERN = /(?:^|[^\d])(\d{1,3})\s*x\s*(\d{1,4})(?:$|[^\d])/i;
const NAMED_EPISODE_PATTERN = /(?:season|сезон)\s*#?\s*(\d{1,3})[^\d]{0,32}(?:episode|эпизод|сер(?:ия|ии|ию))\s*#?\s*(\d{1,4})/i;
const NUMBERED_RUSSIAN_EPISODE_PATTERN = /(?:^|[^\d])(\d{1,3})\s*сезон[^\d]{0,24}(\d{1,4})\s*сер(?:ия|ии|ию)(?:$|[^а-яё])/i;
const REVERSED_NAMED_EPISODE_PATTERN = /(?:episode|эпизод|сер(?:ия|ии|ию))\s*#?\s*(\d{1,4})[^\d]{0,32}(?:season|сезон)\s*#?\s*(\d{1,3})/i;

function normalizePair(season, episode) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  if (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)
      || seasonNumber < 0 || seasonNumber > 999 || episodeNumber < 1 || episodeNumber > 9999) return null;
  return {
    season: seasonNumber,
    episode: episodeNumber,
    key: `s${String(seasonNumber).padStart(2, '0')}e${String(episodeNumber).padStart(2, '0')}`,
  };
}

function fromSearchParams(url) {
  const params = url.searchParams;
  const season = ['season', 'season_number', 'seasonnumber', 's'].map(key => params.get(key)).find(Boolean);
  const episode = ['episode', 'episode_number', 'episodenumber', 'ep', 'e'].map(key => params.get(key)).find(Boolean);
  if (season && episode) return normalizePair(season, episode);
  return null;
}

function fromText(text) {
  const value = String(text || '').replace(/[?#&]/g, ' ');
  for (const pattern of [EPISODE_KEY_PATTERN, X_EPISODE_PATTERN, NAMED_EPISODE_PATTERN, NUMBERED_RUSSIAN_EPISODE_PATTERN]) {
    const match = pattern.exec(value);
    if (match) return normalizePair(match[1], match[2]);
  }
  const reversed = REVERSED_NAMED_EPISODE_PATTERN.exec(value);
  return reversed ? normalizePair(reversed[2], reversed[1]) : null;
}

/**
 * Best-effort episode identity for player URLs, titles and visible player text.
 * Deliberately requires explicit season/episode markers to avoid assigning a
 * wrong episode based on generic numeric URL segments.
 */
export function extractEpisodeIdentity(...sources) {
  const values = sources.flatMap(source => {
    if (source == null) return [];
    if (typeof source === 'string' || typeof source === 'number') return [String(source)];
    if (Array.isArray(source)) return source.flatMap(value => value == null ? [] : [String(value)]);
    if (typeof source === 'object') {
      const direct = normalizePair(source.season ?? source.seasonNumber, source.episode ?? source.episodeNumber);
      if (direct) return [direct.key];
      return [source.href, source.url, source.title, source.name, source.text, source.src, source.episodeKey]
        .filter(value => value != null).map(String);
    }
    return [];
  });

  for (const value of values) {
    try {
      const url = new URL(value, 'https://gulrating.invalid/');
      const queryPair = fromSearchParams(url);
      if (queryPair) return queryPair;
    } catch (error) { /* text/URL parsing below */ }
    const textPair = fromText(value);
    if (textPair) return textPair;
  }
  return null;
}

export function episodePositionKey(titleKey, episode) {
  if (!titleKey || !episode || !/^s\d{2,3}e\d{2,4}$/i.test(String(episode.key || ''))) return null;
  return `${titleKey}:episode:${String(episode.key).toLowerCase()}`;
}
