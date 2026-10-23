// Franchise membership is derived only from explicit Wikipedia previous/next rows.

const CACHE_KEY = 'gulrating:wikipedia_franchise_cache_v8';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL = 6 * 60 * 60 * 1000;
const memoryCache = new Map();
const inflight = new Map();

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ru-RU')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cacheTtl(titles) {
  return titles.length ? CACHE_TTL : EMPTY_CACHE_TTL;
}

function cacheRead(key) {
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && Date.now() - memoryEntry.at < cacheTtl(memoryEntry.titles)) return memoryEntry.titles;
  if (memoryEntry) memoryCache.delete(key);
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const entry = all[key];
    if (entry && Date.now() - entry.at < cacheTtl(entry.titles || []) && Array.isArray(entry.titles)) {
      memoryCache.set(key, entry);
      return entry.titles;
    }
  } catch (e) { /* localStorage unavailable */ }
  return undefined;
}

function cacheWrite(key, titles) {
  const entry = { at: Date.now(), titles };
  memoryCache.set(key, entry);
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[key] = entry;
    const keys = Object.keys(all).sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0));
    while (keys.length > 100) delete all[keys.shift()];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch (e) { /* localStorage unavailable */ }
}

function apiUrl(language, params) {
  const query = new URLSearchParams(params).toString();
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const onPages = hostname === 'gulrating.pages.dev' || hostname.endsWith('.gulrating.pages.dev');
  if (onPages) return `/wiki/${language}?${query}`;
  return `https://${language}.wikipedia.org/w/api.php?${query}`;
}

async function requestJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Wikipedia lookup failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchArticles(language, query) {
  const params = {
    action: 'query', format: 'json', list: 'search', srsearch: query,
    srnamespace: '0', srlimit: '7', srprop: 'snippet', origin: '*',
  };
  const data = await requestJson(apiUrl(language, params));
  return (data?.query?.search || []).map((result, index) => ({
    language,
    title: result.title,
    snippet: result.snippet || '',
    rank: index,
  }));
}

function normalizePageTitle(value) {
  return normalize(String(value || '')
    .replace(/\s+\((?:(?:18|19|20)\d{2}\s+)?(?:film|movie|film series|tv series|television series|фильм|мультфильм|сериал|телесериал)\)\s*$/i, '')
    .replace(/\s+\((?:film|movie|film series|tv series|television series|фильм|мультфильм|сериал|телесериал),?\s*(?:18|19|20)\d{2}\)\s*$/i, ''));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function plainHtmlText(value) {
  return decodeHtml(String(value || '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function chronologyLinksFromHtml(html) {
  const links = [];
  const rows = String(html || '').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const labelMatch = row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
    if (!labelMatch) continue;
    const label = normalize(plainHtmlText(labelMatch[1]));
    const isPrevious = /(?:previous|preceded|prior|предыдущ|предшеств)/i.test(label);
    const isNext = /(?:next|followed|following|следующ)/i.test(label);
    if (isPrevious === isNext) continue;

    const tv = /(?:tv|television|series|show|сериал|телесериал)/i.test(label);
    const film = /(?:film|movie|фильм|мультфильм)/i.test(label);
    // Bare Previous/Next rows can bridge movies and TV entries. Never inherit
    // the current article's type; use a type explicitly stated by the row or
    // by the linked article's own disambiguation suffix, otherwise defer to TMDb.
    const valueMatch = row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (!valueMatch) continue;
    const anchorMatch = valueMatch[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;

    const href = anchorMatch[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (!href.startsWith('/wiki/')) continue;
    let title = href.slice('/wiki/'.length).split('#')[0].replace(/_/g, ' ');
    try { title = decodeURIComponent(title); } catch (error) { /* retain the raw title */ }
    title = plainHtmlText(title);
    if (!title || /^(?:special|category|file|help|portal|wikipedia|template|talk|media|служебная|категория|файл|справка|портал|шаблон|обсуждение):/i.test(title)) continue;
    const year = title.match(/\(((?:18|19|20)\d{2})\s+(?:film|movie|tv series|television series|фильм|мультфильм|сериал|телесериал)\)/i)?.[1]
      || title.match(/\((?:film|movie|tv series|television series|фильм|мультфильм|сериал|телесериал),?\s*((?:18|19|20)\d{2})\)/i)?.[1];
    const disambiguation = title.match(/\(([^()]*)\)\s*$/)?.[1] || '';
    const linkedType = /(?:film|movie|фильм|мультфильм)/i.test(disambiguation) ? 'movie'
      : /(?:tv|television|series|сериал|телесериал)/i.test(disambiguation) ? 'tv'
        : 'all';
    const media_type = tv ? 'tv' : film ? 'movie' : linkedType;
    links.push({
      title,
      media_type,
      relation: isPrevious ? 'previous' : 'next',
      ...(year ? { year: Number(year) } : {}),
    });
  }
  return links;
}

async function findChronologySeed(language, query, titleCandidates, year, mediaType) {
  const articles = await searchArticles(language, query).catch(() => []);
  const wanted = titleCandidates.map(normalize).filter(Boolean);
  const matches = articles.filter(article => wanted.includes(normalizePageTitle(article.title)));
  if (!matches.length) return [];

  // Broad exact-title searches can rank a novel or a franchise page above the
  // film itself (e.g. “Dune” before “Dune (2021 film)”). Prefer the matching-
  // year, matching-medium article when Wikipedia supplies one.
  const yearPattern = year ? new RegExp(`(?:^|\\D)${year}(?:\\D|$)`) : null;
  const yearMatches = yearPattern ? matches.filter(article => yearPattern.test(article.title)) : [];
  const mediaPattern = mediaType === 'tv'
    ? /(?:tv|television|series|show|сериал|телесериал)/i
    : /(?:film|movie|мультфильм|фильм)/i;
  const yearAndMediaMatches = yearMatches.filter(article => mediaPattern.test(article.title));
  const preferred = yearAndMediaMatches.length ? yearAndMediaMatches
    : yearMatches.length ? yearMatches
      : matches;
  return preferred.sort((a, b) => a.rank - b.rank).slice(0, 1);
}

async function inspectChronologyPage(article) {
  const params = {
    action: 'parse', format: 'json', page: article.title,
    prop: 'text', section: '0', origin: '*',
  };
  const data = await requestJson(apiUrl(article.language, params));
  const html = data?.parse?.text?.['*'] || data?.parse?.text || '';
  return chronologyLinksFromHtml(html);
}

async function findChronologyBacklinks(language, title) {
  const params = {
    action: 'query', format: 'json', list: 'backlinks',
    bltitle: title, blnamespace: '0', blfilterredir: 'nonredirects', bllimit: '20', origin: '*',
  };
  const data = await requestJson(apiUrl(language, params));
  return (data?.query?.backlinks || []).map(page => {
    const disambiguation = String(page.title || '').match(/\(([^()]*)\)\s*$/)?.[1] || '';
    const media_type = /(?:film|movie|фильм|мультфильм)/i.test(disambiguation) ? 'movie'
      : /(?:tv|television|series|сериал|телесериал)/i.test(disambiguation) ? 'tv'
        : 'all';
    const year = String(page.title || '').match(/\(((?:18|19|20)\d{2})\s+(?:film|movie|tv series|television series|фильм|мультфильм|сериал|телесериал)\)/i)?.[1]
      || String(page.title || '').match(/\((?:film|movie|tv series|television series|фильм|мультфильм|сериал|телесериал),?\s*((?:18|19|20)\d{2})\)/i)?.[1];
    return {
      language,
      title: page.title,
      media_type,
      ...(year ? { year: Number(year) } : {}),
    };
  });
}

async function discoverChronology(title, originalTitle, year, mediaType) {
  const mediaHintRu = mediaType === 'tv' ? 'сериал' : 'фильм';
  const mediaHintEn = mediaType === 'tv' ? 'television series' : 'film';
  const searches = await Promise.all([
    findChronologySeed('ru', `${title} ${mediaHintRu} ${year || ''}`.trim(), [title], year, mediaType),
    findChronologySeed('en', `${originalTitle || title} ${mediaHintEn} ${year || ''}`.trim(), [originalTitle || title], year, mediaType),
  ]);
  const queue = searches.flat().map(article => ({ ...article, media_type: mediaType, depth: 0 }));
  const visited = new Set();
  const related = new Map();
  let processed = 0;
  let backlinkQueries = 0;

  while (queue.length && processed < 20) {
    const batch = [];
    while (queue.length && batch.length < 4 && processed + batch.length < 20) {
      const article = queue.shift();
      const key = `${article.language}:${normalize(article.title)}`;
      if (visited.has(key)) continue;
      visited.add(key);
      batch.push(article);
    }
    if (!batch.length) break;
    processed += batch.length;
    const discovered = await Promise.all(batch.map(article =>
      inspectChronologyPage(article).catch(() => [])
    ));
    const backlinks = await Promise.all(batch.map((article, index) => {
      const hasPrevious = discovered[index].some(link => link.relation === 'previous');
      if (article.depth > 0 || hasPrevious || backlinkQueries >= 2) return [];
      backlinkQueries += 1;
      return findChronologyBacklinks(article.language, article.title).catch(() => []);
    }));

    for (let index = 0; index < batch.length; index += 1) {
      const article = batch[index];
      const links = discovered[index];
      if (article.requiredLink && !links.some(link =>
        normalizePageTitle(link.title) === normalizePageTitle(article.requiredLink)
      )) continue;

      if (article.requiredLink) {
        const disambiguation = String(article.title || '').match(/\(([^()]*)\)\s*$/)?.[1] || '';
        const pageYear = String(article.title || '').match(/\(((?:18|19|20)\d{2})\s+(?:film|movie|tv series|television series|фильм|мультфильм|сериал|телесериал)\)/i)?.[1]
          || String(article.title || '').match(/\((?:film|movie|tv series|television series|фильм|мультфильм|сериал|телесериал),?\s*((?:18|19|20)\d{2})\)/i)?.[1];
        const pageType = /(?:film|movie|фильм|мультфильм)/i.test(disambiguation) ? 'movie'
          : /(?:tv|television|series|сериал|телесериал)/i.test(disambiguation) ? 'tv'
            : 'all';
        const key = normalize(article.title);
        const existing = related.get(key);
        if (!existing || (existing.media_type === 'all' && pageType !== 'all')) {
          related.set(key, {
            title: article.title,
            media_type: pageType,
            ...(pageYear ? { year: Number(pageYear) } : {}),
          });
        }
      }

      for (const link of links) {
        const key = normalize(link.title);
        const existing = related.get(key);
        if (!existing || (existing.media_type === 'all' && link.media_type !== 'all')) {
          related.set(key, link);
        }
        if (article.depth < 5) {
          queue.push({
            language: article.language,
            title: link.title,
            media_type: link.media_type,
            depth: article.depth + 1,
          });
        }
      }

      // Backlinks are only candidates. A title joins the franchise graph only
      // after its own explicit Previous/Next row points back to this article.
      for (const candidate of backlinks[index].slice(0, 12)) {
        const candidateKey = `${candidate.language}:${normalize(candidate.title)}`;
        if (article.depth < 5 && !visited.has(candidateKey)) {
          queue.push({
            ...candidate,
            depth: article.depth + 1,
            requiredLink: article.title,
          });
        }
      }
    }
  }
  return [...related.values()];
}

async function discover(title, originalTitle, year, mediaType) {
  // Do not infer franchise membership from broad Wikipedia list sections or
  // TMDb collections: only titles linked from explicit previous/next rows count.
  return discoverChronology(title, originalTitle, year, mediaType).catch(() => []);
}

export async function getWikipediaFranchiseTitles(title, originalTitle = '', releaseDate = '', mediaType = 'movie') {
  const names = [String(title || '').trim(), String(originalTitle || '').trim()].filter(Boolean);
  if (!names.length) return [];
  const year = Number(String(releaseDate || '').slice(0, 4)) || null;
  const normalizedNames = names.map(normalize).sort().join('|');
  const cacheKey = `${normalizedNames}|${mediaType}|${year || ''}`;
  const cached = cacheRead(cacheKey);
  if (cached !== undefined) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const pending = discover(names[0], names[1] || names[0], year, mediaType)
    .then(titles => {
      const result = Array.isArray(titles) ? titles : [];
      cacheWrite(cacheKey, result);
      return result;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, pending);
  return pending;
}
