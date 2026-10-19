// Полная офлайн-база TMDb (~1 млн тайтлов) отдельным скачанным файлом-чанками.
// Чанки лежат в IndexedDB (дисковая квота, не лимит localStorage в 5 МБ),
// названия отсортированы — префиксный поиск идёт бинарным поиском без
// загрузки всей базы в память; поиск «содержит» сканирует чанки потоком.
//
// Источник по умолчанию — same-origin Pages Function над веткой data-full;
// внешние jsDelivr/raw остаются резервом на случай временной ошибки прокси.

const DB_NAME = 'gulrating-full-catalog';
const META_KEY = 'gulrating:full_catalog_meta';
const PENDING_META_KEY = 'gulrating:full_catalog_pending_meta';

const manifestVersion = meta => String(meta?.version || meta?.updated || '');

const SOURCES = [
  '/data/full/',
  'https://cdn.jsdelivr.net/gh/ToshakGulina/gulrating@data-full/data/full/',
  'https://raw.githubusercontent.com/ToshakGulina/gulrating/data-full/data/full/'
];

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

// --- IndexedDB: строка чанка по имени файла ---

function openDB() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => {
      if (!rq.result.objectStoreNames.contains('chunks')) rq.result.createObjectStore('chunks');
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

async function idbGet(file) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('chunks', 'readonly');
    const rq = tx.objectStore('chunks').get(file);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => resolve(null);
  });
}

async function idbPut(file, text) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').put(text, file);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbKeepOnly(files) {
  const keep = new Set(files);
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (!keep.has(String(entry.key))) entry.delete();
      entry.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// --- Метаданные и манифест ---

export function getFullCatalogMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    // Старые версии могли заменить активную мету частичным обновлением.
    // Такую базу не выдаём за полноценную; её можно докачать заново ниже.
    return meta && meta.chunks && !meta.partial ? meta : null;
  } catch (e) {
    return null;
  }
}

export function getFullCatalogPendingMeta() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_META_KEY) || 'null');
    if (pending?.chunks) return pending;
    // Совместимость с частично скачанными базами старых сборок.
    const legacy = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    return legacy?.partial ? legacy : null;
  } catch (e) {
    return null;
  }
}

function setFullCatalogMeta(meta) {
  try {
    if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
    else localStorage.removeItem(META_KEY);
  } catch (e) { /* приватный режим */ }
}

function setPendingCatalogMeta(meta) {
  try {
    if (meta) localStorage.setItem(PENDING_META_KEY, JSON.stringify(meta));
    else localStorage.removeItem(PENDING_META_KEY);
  } catch (e) { /* приватный режим */ }
}

export function isFullCatalogInstalled() {
  const meta = getFullCatalogMeta();
  return Boolean(meta && meta.chunks && meta.chunks.length);
}

async function fetchJson(url, timeoutMs = 20000, cache = 'default') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFullManifest() {
  for (const base of SOURCES) {
    const manifest = await fetchJson(`${base}manifest.json`, 20000, 'no-store');
    if (manifest && manifest.v === 1 && Array.isArray(manifest.chunks) && manifest.chunks.length) {
      return { manifest, base };
    }
  }
  return null;
}

// --- Закачка с прогрессом и удалением ---

let downloading = false;

export async function downloadFullCatalog(onProgress) {
  if (downloading) return getFullCatalogMeta();
  downloading = true;
  try {
    const got = await fetchFullManifest();
    if (!got) return null;
    const { manifest, base } = got;
    const active = getFullCatalogMeta();
    if (active && manifestVersion(active) === manifestVersion(manifest)) {
      setPendingCatalogMeta(null);
      return active;
    }

    // Chunk filenames contain their content hash. Existing chunks are reused,
    // new chunks are downloaded beside the active database, and the installed
    // manifest switches only after every chunk is safely present in IndexedDB.
    // Thus a failed update never corrupts the currently searchable catalog.
    let done = 0;
    for (const chunk of manifest.chunks) {
      if (await idbGet(chunk.file)) {
        done += 1;
        if (onProgress) onProgress(done, manifest.chunks.length);
        continue;
      }
      const text = await fetchJson(`${base}${chunk.file}`, 60000);
      if (!text) break; // сеть пропала: продолжим при следующем нажатии
      await idbPut(chunk.file, JSON.stringify(text));
      done += 1;
      if (onProgress) onProgress(done, manifest.chunks.length);
    }
    if (done >= manifest.chunks.length) {
      setFullCatalogMeta(manifest);
      setPendingCatalogMeta(null);
      await idbKeepOnly(manifest.chunks.map(chunk => chunk.file));
      return manifest;
    }

    // Активная версия остаётся доступна; прогресс этой версии хранится отдельно.
    setPendingCatalogMeta({ ...manifest, partial: done });
    return null;
  } finally {
    downloading = false;
  }
}

export async function deleteFullCatalog() {
  await idbClear();
  setFullCatalogMeta(null);
  setPendingCatalogMeta(null);
}

// --- Чтение чанка с раскодированием записи ---

async function readChunk(file) {
  const raw = await idbGet(file);
  if (!raw) return null;
  try {
    const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(items) ? items : null;
  } catch (e) {
    return null;
  }
}

function toCard(entry) {
  const [id, type, title, year, poster, vote] = entry;
  return {
    id,
    media_type: type === 'm' ? 'movie' : 'tv',
    title,
    release_date: year ? `${year}-01-01` : null,
    poster_path: poster || null,
    vote_average: vote != null ? Number(vote) : null
  };
}

// --- Поиск: префикс бинарным поиском, «содержит» потоковым сканом ---

function chunkIndexForPrefix(meta, q) {
  // последний чанк, у которого first <= q: совпадения начинаются не раньше него
  let lo = 0;
  let hi = meta.chunks.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (meta.chunks[mid].first <= q) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

async function searchPrefix(meta, q, limit, already) {
  const out = [];
  const seen = already || new Set();
  let ci = chunkIndexForPrefix(meta, q);
  while (ci < meta.chunks.length && out.length < limit) {
    const items = await readChunk(meta.chunks[ci].file);
    if (!items) break;
    for (const entry of items) {
      const t = norm(entry[2]);
      if (t >= q) {
        if (!t.startsWith(q)) {
          // ушли за префикс внутри отсортированного чанка
          if (t > q) return out;
          continue;
        }
        const key = `${entry[1]}:${entry[0]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(toCard(entry));
        }
        if (out.length >= limit) break;
      }
    }
    // следующий чанк может продолжать префикс, только если начинается с него
    ci += 1;
    if (ci < meta.chunks.length && !meta.chunks[ci].first.startsWith(q) && meta.chunks[ci].first > q) break;
  }
  return out;
}

async function searchContains(meta, q, limit, already) {
  const out = [];
  const seen = already || new Set();
  for (const chunk of meta.chunks) {
    if (out.length >= limit) break;
    const items = await readChunk(chunk.file);
    if (!items) continue;
    // даём интерфейсу дышать между чанками
    await new Promise(r => setTimeout(r, 0));
    for (const entry of items) {
      const t = norm(entry[2]);
      if (t.includes(q)) {
        const key = `${entry[1]}:${entry[0]}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(toCard(entry));
        }
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

// resultsSoFar — уже найденное в топе: не дублируем карточки
export async function searchFullCatalog(query, limit = 20, resultsSoFar = []) {
  const meta = getFullCatalogMeta();
  const q = norm(query);
  if (!meta || q.length < 2) return [];
  const seen = new Set(resultsSoFar.map(r => `${r.media_type === 'movie' ? 'm' : 't'}:${r.id}`));
  const byPrefix = await searchPrefix(meta, q, limit, seen);
  if (byPrefix.length >= limit) return byPrefix;
  const byContains = await searchContains(meta, q, limit - byPrefix.length, new Set([...seen, ...byPrefix.map(r => `${r.media_type === 'movie' ? 'm' : 't'}:${r.id}`)]));
  return [...byPrefix, ...byContains];
}
