// Find the first relevant Wikipedia article with an explicit film/TV list.
// Its section links are resolved to TMDb IDs by exact title matching in tmdb.js.

const CACHE_KEY = 'gulrating:wikipedia_franchise_cache';
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

async function getArticleSections(article) {
  const params = {
    action: 'parse', format: 'json', page: article.title,
    prop: 'tocdata', origin: '*',
  };
  const data = await requestJson(apiUrl(article.language, params));
  return data?.parse?.tocdata?.sections || data?.parse?.sections || [];
}

function getSectionType(line) {
  const heading = normalize(line);
  if (/^(?:tv series|television series|tv shows|television shows|телесериалы|телевизионные сериалы|сериалы)(?: |$)/i.test(heading)) {
    return 'tv';
  }
  if (/^(?:films? and television|movies? and television|фильмы и сериалы)$/i.test(heading)) {
    return 'all';
  }
  if (/^(?:(?:feature|animated|main|prequel|sequel|live action) )?(?:films?|movies?|filmography|cinema|фильмы?|фильмография|полнометражные фильмы|список фильмов)(?: |$)/i.test(heading)) {
    return 'movie';
  }
  return '';
}

function titleOverlapScore(article, titleCandidates) {
  const articleTitle = normalize(article.title);
  const phrase = `${article.title} ${article.snippet}`.toLocaleLowerCase('ru-RU');
  const candidates = titleCandidates.map(normalize).filter(Boolean);
  let score = 7 - article.rank;
  if (/(franchise|film series|series|filmography|франшиза|серия фильмов|список фильмов)/i.test(phrase)) score += 4;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (articleTitle === candidate) score += 4;
    else if (articleTitle.startsWith(candidate) || candidate.startsWith(articleTitle)) score += 2;
    const words = candidate.split(' ').filter(word => word.length > 3);
    if (words.some(word => articleTitle.includes(word))) score += 1;
  }
  return score;
}

function datedSubsectionTitle(section) {
  const match = String(section.line || '').trim().match(/^(.+?)\s+\(((?:18|19|20)\d{2})(?:\s+[^()]*)?\)$/);
  return match ? { title: match[1].trim(), year: Number(match[2]) } : null;
}

function sectionHeadingTitles(sections, parent) {
  const parentIndex = sections.indexOf(parent);
  const parentLevel = Number(parent.tocLevel || parent.toclevel || 1);
  const titles = [];
  for (let index = parentIndex + 1; index < sections.length; index += 1) {
    const section = sections[index];
    const level = Number(section.tocLevel || section.toclevel || 1);
    if (level <= parentLevel) break;
    const title = datedSubsectionTitle(section);
    if (title) titles.push(title);
  }
  return titles;
}

async function getSectionLinks(article, sections) {
  const relevant = sections
    .map(section => ({ section, type: getSectionType(section.line || '') }))
    .filter(entry => entry.type);
  if (!relevant.length) return [];

  const linksByKey = new Map();
  const addTitle = (title, type, year = null) => {
    const normalizedTitle = normalize(title);
    if (!normalizedTitle) return;
    const keyPrefix = `${normalizedTitle}|`;
    const exactKey = `${keyPrefix}${year || ''}`;
    const priorEntry = [...linksByKey.entries()].find(([key]) =>
      key === exactKey || key === `${keyPrefix}` || (!year && key.startsWith(keyPrefix))
    );
    const priorKey = priorEntry?.[0] || '';
    const prior = priorEntry?.[1];
    const targetKey = year ? exactKey : priorKey || exactKey;
    if (year && priorKey === `${keyPrefix}`) linksByKey.delete(priorKey);
    const priority = { all: 0, tv: 1, movie: 2 };
    const mediaType = prior && priority[prior.media_type] > priority[type] ? prior.media_type : type;
    linksByKey.set(targetKey, { title, media_type: mediaType, ...(year || prior?.year ? { year: year || prior.year } : {}) });
  };

  for (const { section, type } of relevant) {
    const headings = sectionHeadingTitles(sections, section);
    if (headings.length >= 2) {
      headings.forEach(entry => addTitle(entry.title, type, entry.year));
      continue;
    }
    const params = {
      action: 'parse', format: 'json', page: article.title,
      prop: 'links', section: String(section.index), origin: '*',
    };
    const data = await requestJson(apiUrl(article.language, params));
    for (const link of data?.parse?.links || []) {
      const linkTitle = link.title || link['*'] || '';
      if (link.ns !== 0 || !linkTitle) continue;
      const titleAndYear = datedSubsectionTitle({ line: linkTitle }) || { title: linkTitle, year: null };
      addTitle(titleAndYear.title, type, titleAndYear.year);
    }
  }
  return [...linksByKey.values()];
}

async function inspectArticleCandidates(articles, titleCandidates) {
  const ordered = [...articles].sort((a, b) =>
    titleOverlapScore(b, titleCandidates) - titleOverlapScore(a, titleCandidates)
  );
  for (const article of ordered) {
    const sections = await getArticleSections(article).catch(() => []);
    if (!sections.some(section => getSectionType(section.line || ''))) continue;
    const titles = await getSectionLinks(article, sections).catch(() => []);
    if (titles.length >= 2) return titles;
  }
  return [];
}

async function discover(title, originalTitle) {
  const titleCandidates = [title, originalTitle].filter(Boolean);
  const searches = await Promise.all([
    searchArticles('ru', title).catch(() => []),
    searchArticles('en', originalTitle || title).catch(() => []),
  ]);
  const initialArticles = [...searches[0], ...searches[1]];
  const initialTitles = await inspectArticleCandidates(initialArticles, titleCandidates);
  if (initialTitles.length >= 2) return initialTitles;

  // If the first results only point to the individual title page, broaden the
  // query once to the phrase a person commonly searches for.
  const followup = await Promise.all([
    searchArticles('ru', `${title} серия фильмов`).catch(() => []),
    searchArticles('en', `${originalTitle || title} film series`).catch(() => []),
  ]);
  const seen = new Set(initialArticles.map(article => `${article.language}:${article.title}`));
  const followupArticles = followup.flat().filter(article => !seen.has(`${article.language}:${article.title}`));
  return inspectArticleCandidates(followupArticles, titleCandidates);
}

export async function getWikipediaFranchiseTitles(title, originalTitle = '') {
  const names = [String(title || '').trim(), String(originalTitle || '').trim()].filter(Boolean);
  if (!names.length) return [];
  const cacheKey = names.map(normalize).sort().join('|');
  const cached = cacheRead(cacheKey);
  if (cached !== undefined) return cached;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const pending = discover(names[0], names[1] || names[0])
    .then(titles => {
      const result = Array.isArray(titles) ? titles : [];
      cacheWrite(cacheKey, result);
      return result;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, pending);
  return pending;
}
