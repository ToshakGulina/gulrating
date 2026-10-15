import { discoverTitles, getGenreMap } from '../lib/tmdb.js';
import { escapeHtml, releaseYear, posterImg, showToast } from '../lib/dom.js';

// Каталог TMDb. Фильтры — боковая панель на десктопе и складная шторка
// на телефоне: результаты видны сразу, крутить колесо к фильтрам не нужно.
// Типы — мультивыбор, сортировка с направлением, рейтинг и годы — слайдеры.
//
// Два режима ленты:
//  • «Рейтинг» — режим полных диапазонов: лента собирается по диапазонам
//    0.1 балла через фильтры vote_average.gte/lte (НЕ через сортировку:
//    пагинация TMDb на группах равных значений ненадёжна). У каждого
//    диапазона есть total_results, поэтому диапазон выкачивается целиком
//    и помечается «N из N — все»; между карточками 7.0 и 7.2 гарантированно
//    лежат все существующие 7.1.
//  • «Популярность» / «Год выхода» — префикс-лента с покрытием глобального
//    топ-K и пределом глубины: дальше 50 страниц на тип TMDb порядок не
//    гарантирует, и мы честно останавливаемся.
const SORTS = [
  { id: 'popularity', label: 'Популярность' },
  { id: 'vote', label: 'Рейтинг' },
  { id: 'release', label: 'Год выхода' },
];
const YEAR_MIN = 1900;
const YEAR_MAX = 2030;

// presets: { genres: [названия], types: ['movie'|'tv'] } — предустановка
// фильтров (переход из карточки тайтла по жанру)
export async function openCatalog(currentUser, onOpenTitle, presets = {}) {
  const overlay = document.createElement('div');
  // Оверлей сам задаёт высоту (fixed inset-0): ни одной vh-единицы на
// мобильном — шапка не может уехать за экран из-за резиновых панелей
overlay.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex flex-col p-0 sm:p-4 sm:justify-center';
  overlay.innerHTML = `
    <div class="bg-card w-full max-w-5xl mx-auto sm:rounded-2xl flex-1 min-h-0 sm:flex-none sm:max-h-[90vh] flex flex-col overflow-hidden">
      <div class="flex justify-between items-center p-4 border-b border-slate-700 flex-shrink-0 min-h-[52px] safe-top">
        <h3 class="font-bold text-lg">Каталог фильмов и сериалов</h3>
        <button id="catalog-close" class="text-gray-400 hover:text-white px-2 text-xl leading-none" aria-label="Закрыть">×</button>
      </div>

      <!-- Дублирующий крестик поверх всего: даже если шапку когда-нибудь
           снова сожмёт чужой CSS/кэш, закрытие останется доступным -->
      <button id="catalog-close-float" class="sm:hidden fixed top-2 right-2 z-[70] w-10 h-10 flex items-center justify-center rounded-full bg-card/90 border border-slate-700 text-gray-200 text-xl leading-none" aria-label="Закрыть каталог">×</button>

      <div class="flex flex-col sm:flex-row flex-1 min-h-0">
        <!-- Фильтры: сайдбар на десктопе, шторка на мобильном -->
        <aside id="catalog-filters" class="hidden sm:block w-full sm:w-60 flex-shrink-0 border-b sm:border-b-0 sm:border-r border-slate-700 p-4 space-y-4 overflow-y-auto sm:max-h-none max-h-72">
          <div>
            <p class="text-xs text-gray-500 mb-2">Тип</p>
            <div class="flex gap-2">
              <button class="catalog-type px-3 py-1.5 rounded-full text-sm font-medium" data-type="movie">Фильмы</button>
              <button class="catalog-type px-3 py-1.5 rounded-full text-sm font-medium" data-type="tv">Сериалы</button>
            </div>
          </div>
          <div>
            <p class="text-xs text-gray-500 mb-2">Сортировка</p>
            <div class="flex gap-2">
              <select id="catalog-sort" class="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white">
                ${SORTS.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
              </select>
              <button id="catalog-dir" class="px-3 py-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-lg text-sm" title="Направление сортировки">↓</button>
            </div>
          </div>
          <div>
            <p class="text-xs text-gray-500 mb-2">Рейтинг TMDb: ≥ <b id="catalog-vote-val" class="text-cyan-300">0.0</b></p>
            <input type="range" id="catalog-vote" min="0" max="10" step="0.1" value="0" class="rating-slider w-full" aria-label="Минимальный рейтинг TMDb">
          </div>
          <div>
            <p class="text-xs text-gray-500 mb-2">Годы: <b id="catalog-year-from-val" class="text-white">1900</b>–<b id="catalog-year-to-val" class="text-white">2030</b></p>
            <div class="space-y-2">
              <input type="range" id="catalog-year-from" min="${YEAR_MIN}" max="${YEAR_MAX}" step="1" value="${YEAR_MIN}" class="rating-slider w-full" aria-label="Годы с">
              <input type="range" id="catalog-year-to" min="${YEAR_MIN}" max="${YEAR_MAX}" step="1" value="${YEAR_MAX}" class="rating-slider w-full" aria-label="Годы по">
            </div>
          </div>
          <div>
            <p class="text-xs text-gray-500 mb-2">Жанры (можно несколько)</p>
            <div id="catalog-genres" class="flex flex-wrap gap-1.5 text-xs text-gray-500">Загружаем…</div>
          </div>
        </aside>

        <!-- Результаты -->
        <div class="flex-1 min-w-0 flex flex-col min-h-0">
          <div class="p-3 border-b border-slate-700 flex items-center gap-2 flex-shrink-0">
            <button id="filters-toggle" class="sm:hidden px-3 py-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-lg text-xs text-gray-300">Фильтры</button>
            <button id="catalog-random" class="px-3 py-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-lg text-xs text-gray-300" title="Случайный тайтл по текущим фильтрам">🎲 Случайное</button>
            <span id="catalog-count" class="text-xs text-gray-500 ml-auto"></span>
          </div>
          <div class="flex-1 overflow-y-auto p-4">
            <div id="catalog-grid" class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3"></div>
            <div class="text-center mt-4 pb-2">
              <button id="catalog-more" class="hidden px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm">Показать ещё</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  function onEscKey(e) { if (e.key === 'Escape') close(); }
  const close = () => {
    document.removeEventListener('keydown', onEscKey);
    overlay.remove();
  };
  document.addEventListener('keydown', onEscKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#catalog-close').addEventListener('click', close);
  overlay.querySelector('#catalog-close-float').addEventListener('click', close);
  document.body.appendChild(overlay);

  // Мобильная шторка фильтров
  const filtersBox = overlay.querySelector('#catalog-filters');
  overlay.querySelector('#filters-toggle').addEventListener('click', () => {
    filtersBox.classList.toggle('hidden');
  });

  // Типы — мультивыбор: по умолчанию включены оба; мультфильмы входят
  // и в фильмы, и в сериалы (жанр «мультфильм» / «анимация»)
  const state = {
    types: new Set(presets.types && presets.types.length ? presets.types : ['movie', 'tv']),
    genres: new Set((presets.genres || []).map(g => String(g).toLowerCase())),
    dir: 'desc',
    // префикс-лента (популярность/год)
    pages: { movie: 0, tv: 0 },
    hasMoreType: { movie: true, tv: true },
    buffers: { movie: [], tv: [] },
    shownCount: 0,
    // диапазоны (рейтинг)
    bands: [],
    nextBand: null,
    totals: { movie: 0, tv: 0 },
    totalPages: { movie: 0, tv: 0 },
    params: null,
    loading: false
  };
  const PAGE_SIZE = 20; // размер страницы TMDb
  // Предел глубины префикс-ленты: дальше 50 страниц (1000 позиций) на тип
  // поисковый движок TMDb не гарантирует устойчивый порядок
  const MAX_PAGES = 50;
  // Предел выкачки одного диапазона рейтинга на тип: 400 тайтлов
  const BAND_CAP = 400;
  const grid = overlay.querySelector('#catalog-grid');
  const genresBox = overlay.querySelector('#catalog-genres');
  const moreBtn = overlay.querySelector('#catalog-more');
  const randomBtn = overlay.querySelector('#catalog-random');
  const dirBtn = overlay.querySelector('#catalog-dir');
  const countEl = overlay.querySelector('#catalog-count');

  function paintTypeButtons() {
    overlay.querySelectorAll('.catalog-type').forEach(b => {
      const active = state.types.has(b.dataset.type);
      b.className = 'catalog-type px-3 py-1.5 rounded-full text-sm font-medium ' + (active ? 'bg-primary text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700');
    });
  }

  async function mergedGenreNames() {
    const names = new Set();
    for (const type of state.types) {
      const map = await getGenreMap(type);
      Object.keys(map).forEach(n => names.add(n));
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  async function paintGenres() {
    genresBox.innerHTML = 'Загружаем…';
    try {
      const names = await mergedGenreNames();
      genresBox.innerHTML = names.map(n => `
        <button class="catalog-genre px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 cursor-pointer" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>
      `).join('');
      genresBox.querySelectorAll('.catalog-genre').forEach(chip => {
        if (state.genres.has(chip.dataset.name)) chip.classList.add('bg-primary', 'text-white');
        chip.addEventListener('click', () => {
          const name = chip.dataset.name;
          if (state.genres.has(name)) state.genres.delete(name);
          else state.genres.add(name);
          chip.classList.toggle('bg-primary', state.genres.has(name));
          chip.classList.toggle('text-white', state.genres.has(name));
          load(true);
        });
      });
    } catch (e) {
      genresBox.innerHTML = 'Жанры недоступны — остальные фильтры работают.';
    }
  }

  function sortKeyOf(item, sortRaw) {
    if (sortRaw === 'vote') return item.vote_average || 0;
    if (sortRaw === 'release') return item.release_date || '';
    return item.popularity || 0;
  }

  function readParams() {
    const sortRaw = overlay.querySelector('#catalog-sort').value;
    const voteGte = Math.round((Number(overlay.querySelector('#catalog-vote').value) || 0) * 10) / 10;
    let yearFrom = Number(overlay.querySelector('#catalog-year-from').value);
    let yearTo = Number(overlay.querySelector('#catalog-year-to').value);
    if (yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
    return {
      sortRaw,
      voteGte,
      yearGte: yearFrom > YEAR_MIN ? String(yearFrom) : '',
      yearLte: yearTo < YEAR_MAX ? String(yearTo) : ''
    };
  }

  // Первичный ключ сортировки префикс-ленты. Мультисорт запятой TMDb может
  // проигнорировать молча, поэтому вторичных ключей не используем вовсе
  function sortByFor(type, sortRaw, dir) {
    const base = sortRaw === 'release'
      ? (type === 'tv' ? 'first_air_date' : 'primary_release_date')
      : sortRaw;
    return `${base}.${dir}`;
  }

  async function genreIdsFor(type) {
    const genreMap = await getGenreMap(type);
    return [...state.genres].map(n => genreMap[n]).filter(Boolean);
  }

  function tilesHtml(items) {
    return items.map(item => `
      <div class="catalog-item cursor-pointer group" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
        <div class="relative group-hover:opacity-80 transition-opacity">
          ${posterImg(item.poster_path, item.title, 'w-full aspect-[2/3] rounded-lg')}
          ${item.vote_average
            ? `<span class="absolute top-1 right-1 bg-black/70 text-cyan-300 text-[11px] font-bold px-1.5 py-0.5 rounded-md" title="Оценок на TMDb: ${item.vote_count || 0}">${Number(item.vote_average).toFixed(1)}</span>`
            : '<span class="absolute top-1 right-1 bg-black/70 text-gray-400 text-[11px] font-medium px-1.5 py-0.5 rounded-md">нет оценок</span>'}
        </div>
        <div class="mt-1.5 text-xs font-medium line-clamp-2 leading-tight">${escapeHtml(item.title)}</div>
        <div class="text-[11px] text-gray-500">${escapeHtml(releaseYear(item.release_date) || '—')} • ${item.media_type === 'movie' ? 'фильм' : 'сериал'}</div>
      </div>
    `).join('');
  }

  function bandDividerHtml(band) {
    const note = band.partial
      ? `показано ${band.items.length} из ${band.total} — диапазон велик, выкачан не весь`
      : `${band.total} из ${band.total} — все`;
    return `
      <div class="col-span-full flex items-center gap-2 mt-3 mb-1 first:mt-0 text-[11px] text-gray-500">
        <span class="h-px bg-slate-700 flex-1"></span>
        <span>рейтинг ${band.b.toFixed(1)} · ${note}</span>
        <span class="h-px bg-slate-700 flex-1"></span>
      </div>
    `;
  }

  // ---------- Режим полных диапазонов (сортировка «Рейтинг») ----------

  function stepBand(b) {
    const next = Math.round((b + (state.dir === 'asc' ? 0.1 : -0.1)) * 10) / 10;
    return next;
  }

  function bandInRange(b) {
    if (state.dir === 'asc') return b <= 10.0;
    const { voteGte } = state.params;
    return b + 0.09 >= voteGte && b >= 0;
  }

  // Стартовый диапазон: первая страница сортировки даёт реальную границу
  // оценок (заодно снимаем total_results для счётчика «из ~M»)
  async function probeStartBand() {
    const { voteGte, yearGte, yearLte } = state.params;
    const probed = await Promise.all([...state.types].map(async (type) => {
      const r = await discoverTitles({
        mediaType: type,
        genreIds: await genreIdsFor(type),
        sortBy: `vote_average.${state.dir}`,
        voteGte,
        yearGte,
        yearLte,
        page: 1,
        limit: 1
      });
      state.totals[type] = r.total || state.totals[type];
      state.totalPages[type] = r.totalPages || state.totalPages[type];
      return r.items[0] ? Number(r.items[0].vote_average) : null;
    }));
    const vals = probed.filter(v => v != null && !Number.isNaN(v));
    if (!vals.length) return null;
    const edge = state.dir === 'asc' ? Math.min(...vals) : Math.max(...vals);
    return Math.floor(edge * 10 + 1e-6) / 10;
  }

  // Выкачивает диапазон [b, b+0.09] целиком: фильтр диапазона, а не сортировка,
  // поэтому полнота контролируется через total_results
  async function loadBand(b) {
    const { voteGte, yearGte, yearLte } = state.params;
    const lte = Math.round((b + 0.1) * 10) / 10 - 0.01;
    const perType = await Promise.all([...state.types].map(async (type) => {
      const common = {
        mediaType: type,
        genreIds: await genreIdsFor(type),
        sortBy: 'popularity.desc', // внутри диапазона порядок не важен, важна устойчивая пагинация
        voteGte: Math.max(voteGte, b),
        voteLte: lte,
        yearGte,
        yearLte,
        limit: PAGE_SIZE
      };
      const first = await discoverTitles({ ...common, page: 1 });
      const total = first.total;
      const pages = Math.ceil(Math.min(total, BAND_CAP) / PAGE_SIZE);
      const items = [...first.items];
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => discoverTitles({ ...common, page: i + 2 }))
        );
        rest.forEach(r => items.push(...r.items));
      }
      return { items, total };
    }));
    const seen = new Set();
    const items = [];
    for (const t of perType) {
      for (const it of t.items) {
        const k = `${it.media_type}:${it.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        items.push(it);
      }
    }
    items.sort((a, b2) => (b2.vote_count || 0) - (a.vote_count || 0));
    const total = perType.reduce((s, t) => s + t.total, 0);
    return { b, items, total, partial: items.length < total };
  }

  async function loadBandsUntil(minAdd) {
    if (state.nextBand === null && !state.bands.length) {
      state.nextBand = await probeStartBand();
    }
    let added = 0;
    let guard = 0;
    while (state.nextBand !== null && added < minAdd && guard < 12) {
      guard += 1;
      const b = state.nextBand;
      if (!bandInRange(b)) { state.nextBand = null; break; }
      const band = await loadBand(b);
      if (band.total > 0) {
        state.bands.push(band);
        added += band.items.length;
      }
      const next = stepBand(b);
      state.nextBand = bandInRange(next) ? next : null;
    }
  }

  function renderBands() {
    const scroller = grid.parentElement;
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const cards = state.bands.reduce((s, b) => s + b.items.length, 0);
    grid.innerHTML = state.bands.map(band => bandDividerHtml(band) + tilesHtml(band.items)).join('')
      || '<p class="col-span-full text-sm text-gray-500 text-center py-8">Ничего не нашлось — попробуйте смягчить фильтры.</p>';
    if (scroller) scroller.scrollTop = scrollTop;
    const totalEst = [...state.types].reduce((sum, t) => sum + (state.totals[t] || 0), 0);
    countEl.textContent = `показано ${cards} из ~${totalEst.toLocaleString('ru-RU')} · полнота по разделителям диапазонов`;
    moreBtn.classList.toggle('hidden', state.nextBand === null);
  }

  // ---------- Префикс-лента (популярность / год) ----------

  // Докачивает указанные страницы типа в буфер (дедуп по id)
  async function fetchTypePages(type, pagesArr) {
    if (!pagesArr.length) return;
    const { sortRaw, voteGte, yearGte, yearLte } = state.params;
    const genreIds = await genreIdsFor(type);
    const rs = await Promise.all(pagesArr.map(page => discoverTitles({
      mediaType: type,
      genreIds,
      sortBy: sortByFor(type, sortRaw, state.dir),
      voteGte,
      yearGte,
      yearLte,
      page,
      limit: PAGE_SIZE
    })));
    const seen = new Set(state.buffers[type].map(t => t.id));
    for (const r of rs) {
      for (const it of r.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        state.buffers[type].push(it);
      }
    }
    state.pages[type] = Math.max(state.pages[type], ...pagesArr);
    state.totals[type] = rs[0].total || state.totals[type];
    state.totalPages[type] = rs[0].totalPages || state.totalPages[type];
    const last = rs[rs.length - 1];
    state.hasMoreType[type] = last.hasMore && last.items.length > 0;
  }

  // Лента = строго отсортированный префикс буфера длиной cap.
  // cap — глубина, до которой покрытие точно полное: тайтл из глобального
  // топ-K внутри своего типа имеет ранг ≤ K, значит страниц типа должно быть
  // загружено ≥ K / PAGE_SIZE. Перерисовываем префикс целиком (сохраняя
  // скролл): порядок на экране всегда совпадает с сортировкой буфера.
  function renderShown(replaceGrid) {
    const { sortRaw } = state.params;
    const merged = [...state.types].flatMap(t => state.buffers[t]);
    merged.sort((a, b) => {
      const ka = sortKeyOf(a, sortRaw);
      const kb = sortKeyOf(b, sortRaw);
      const cmp = ka === kb ? 0 : (ka > kb ? 1 : -1);
      return state.dir === 'desc' ? -cmp : cmp;
    });
    let cap = Infinity;
    for (const t of state.types) {
      cap = Math.min(cap, state.hasMoreType[t] ? state.pages[t] * PAGE_SIZE : state.buffers[t].length);
    }
    cap = Math.min(cap, merged.length);
    state.shownCount = cap;
    const scroller = grid.parentElement;
    const scrollTop = scroller ? scroller.scrollTop : 0;
    grid.innerHTML = tilesHtml(merged.slice(0, cap)) || '<p class="col-span-full text-sm text-gray-500 text-center py-8">Ничего не нашлось — попробуйте смягчить фильтры.</p>';
    if (!replaceGrid && scroller) scroller.scrollTop = scrollTop;
    const totalEst = [...state.types].reduce((sum, t) => sum + (state.totals[t] || 0), 0);
    const depthCapped = [...state.types].some(t => state.hasMoreType[t] && state.pages[t] >= MAX_PAGES);
    const canMore = merged.length > cap || [...state.types].some(t => state.hasMoreType[t] && state.pages[t] < MAX_PAGES);
    moreBtn.classList.toggle('hidden', !canMore);
    countEl.textContent = `показано ${cap} из ~${totalEst.toLocaleString('ru-RU')}`;
    if (depthCapped && !canMore) {
      countEl.textContent += ' · предел глубины: дальше TMDb не гарантирует порядок — сузьте фильтры или нажмите «Случайное»';
    }
  }

  // ---------- Общая загрузка ----------

  function paintSkeleton() {
    grid.innerHTML = Array.from({ length: 10 }).map(() => `
      <div class="animate-pulse"><div class="w-full aspect-[2/3] bg-slate-700 rounded-lg"></div><div class="h-3 bg-slate-700 rounded mt-1.5"></div></div>
    `).join('');
    countEl.textContent = '';
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    state.params = readParams();
    const voteMode = state.params.sortRaw === 'vote';
    if (reset) {
      state.buffers = { movie: [], tv: [] };
      state.pages = { movie: 0, tv: 0 };
      state.hasMoreType = { movie: true, tv: true };
      state.shownCount = 0;
      state.bands = [];
      state.nextBand = null;
      paintSkeleton();
    }

    try {
      if (voteMode) {
        await loadBandsUntil(40);
        renderBands();
      } else {
        const pagesArrFor = (t) => reset
          ? [1, 2]
          : (state.hasMoreType[t] && state.pages[t] < MAX_PAGES
            ? [state.pages[t] + 1, state.pages[t] + 2].filter(pg => pg <= MAX_PAGES)
            : []);
        await Promise.all([...state.types].map(t => fetchTypePages(t, pagesArrFor(t))));
        renderShown(reset);
      }
    } catch (e) {
      if (reset) {
        grid.innerHTML = `
          <div class="col-span-full text-center py-8">
            <p class="text-sm text-red-400 mb-3">${escapeHtml(e && e.message ? e.message : 'Не удалось загрузить каталог.')}</p>
            <button id="catalog-retry" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm">Повторить</button>
          </div>`;
        const retry = grid.querySelector('#catalog-retry');
        if (retry) retry.addEventListener('click', () => load(true));
      }
    } finally {
      state.loading = false;
    }
  }

  overlay.querySelectorAll('.catalog-type').forEach(b => {
    b.addEventListener('click', () => {
      const type = b.dataset.type;
      if (state.types.has(type)) {
        if (state.types.size === 1) return; // каталог не бывает без типа
        state.types.delete(type);
      } else {
        state.types.add(type);
      }
      paintTypeButtons();
      paintGenres();
      load(true);
    });
  });
  overlay.querySelector('#catalog-sort').addEventListener('change', () => load(true));
  dirBtn.addEventListener('click', () => {
    state.dir = state.dir === 'desc' ? 'asc' : 'desc';
    dirBtn.textContent = state.dir === 'desc' ? '↓' : '↑';
    load(true);
  });

  const voteSlider = overlay.querySelector('#catalog-vote');
  const voteVal = overlay.querySelector('#catalog-vote-val');
  const yearFrom = overlay.querySelector('#catalog-year-from');
  const yearTo = overlay.querySelector('#catalog-year-to');
  const yearFromVal = overlay.querySelector('#catalog-year-from-val');
  const yearToVal = overlay.querySelector('#catalog-year-to-val');
  let debounceTimer = null;
  const debouncedLoad = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => load(true), 400);
  };
  voteSlider.addEventListener('input', () => {
    voteVal.textContent = Number(voteSlider.value).toFixed(1);
    debouncedLoad();
  });
  const onYears = () => {
    yearFromVal.textContent = yearFrom.value;
    yearToVal.textContent = yearTo.value;
    debouncedLoad();
  };
  yearFrom.addEventListener('input', onYears);
  yearTo.addEventListener('input', onYears);

  moreBtn.addEventListener('click', () => load(false));

  // Случайное произведение по тем же фильтрам: равномерный выбор страницы
  // из окна TMDb (не глубже 500) и случайный тайтл со страницы
  async function pickRandom() {
    randomBtn.disabled = true;
    const oldLabel = randomBtn.textContent;
    randomBtn.textContent = 'Ищем…';
    try {
      state.params = readParams();
      const { voteGte, yearGte, yearLte } = state.params;
      const pool = [];
      await Promise.all([...state.types].map(async (type) => {
        const maxPage = Math.min(state.totalPages[type] || 1, 500);
        const page = 1 + Math.floor(Math.random() * maxPage);
        const r = await discoverTitles({
          mediaType: type,
          genreIds: await genreIdsFor(type),
          sortBy: 'popularity.desc',
          voteGte,
          yearGte,
          yearLte,
          page,
          limit: PAGE_SIZE
        });
        pool.push(...r.items);
      }));
      if (!pool.length) {
        showToast('Под текущие фильтры ничего не нашлось', 'error');
        return;
      }
      const item = pool[Math.floor(Math.random() * pool.length)];
      close();
      onOpenTitle(String(item.id), item.media_type);
    } catch (e) {
      showToast('Не удалось выбрать случайное — попробуйте ещё раз', 'error');
    } finally {
      randomBtn.disabled = false;
      randomBtn.textContent = oldLabel;
    }
  }
  randomBtn.addEventListener('click', pickRandom);

  grid.addEventListener('click', (e) => {
    const item = e.target.closest('.catalog-item');
    if (!item) return;
    close();
    onOpenTitle(item.dataset.id, item.dataset.type);
  });

  paintTypeButtons();
  paintGenres();
  load(true);
}
