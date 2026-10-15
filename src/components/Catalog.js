import { discoverTitles, getGenreMap } from '../lib/tmdb.js';
import { escapeHtml, releaseYear, posterImg } from '../lib/dom.js';

// Каталог TMDb. Фильтры — боковая панель на десктопе и складная шторка
// на телефоне: результаты видны сразу, крутить колесо к фильтрам не нужно.
// Типы — мультивыбор, сортировка с направлением, рейтинг и годы — слайдеры.
const SORTS = [
  { id: 'popularity', label: 'Популярность' },
  { id: 'vote', label: 'Рейтинг' },
  { id: 'release', label: 'Год выхода' },
];
const YEAR_MIN = 1900;
const YEAR_MAX = 2030;

export async function openCatalog(currentUser, onOpenTitle) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4';
  overlay.innerHTML = `
    <div class="bg-card w-full max-w-5xl rounded-t-2xl sm:rounded-2xl max-h-[94vh] sm:max-h-[90vh] flex flex-col overflow-hidden">
      <div class="flex justify-between items-center p-4 border-b border-slate-700">
        <h3 class="font-bold text-lg">Каталог фильмов и сериалов</h3>
        <button id="catalog-close" class="text-gray-400 hover:text-white px-2 text-xl leading-none" aria-label="Закрыть">×</button>
      </div>

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
          <div class="p-3 border-b border-slate-700 flex items-center gap-2">
            <button id="filters-toggle" class="sm:hidden px-3 py-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 rounded-lg text-xs text-gray-300">Фильтры</button>
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

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#catalog-close').addEventListener('click', close);
  document.body.appendChild(overlay);

  // Мобильная шторка фильтров
  const filtersBox = overlay.querySelector('#catalog-filters');
  overlay.querySelector('#filters-toggle').addEventListener('click', () => {
    filtersBox.classList.toggle('hidden');
  });

  // Типы — мультивыбор: по умолчанию включены оба; мультфильмы входят
  // и в фильмы, и в сериалы (жанр «мультфильм» / «анимация»)
  const state = {
    types: new Set(['movie', 'tv']),
    genres: new Set(),
    dir: 'desc',
    pages: { movie: 0, tv: 0 },
    hasMoreType: { movie: true, tv: true },
    totals: { movie: 0, tv: 0 },
    buffers: { movie: [], tv: [] },
    params: null,
    loading: false,
    shownCount: 0
  };
  const PAGE_SIZE = 20; // размер страницы TMDb
  const grid = overlay.querySelector('#catalog-grid');
  const genresBox = overlay.querySelector('#catalog-genres');
  const moreBtn = overlay.querySelector('#catalog-more');
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

  // Докачивает указанные страницы типа в буфер (дедуп по id)
  async function fetchTypePages(type, pagesArr) {
    if (!pagesArr.length) return;
    const { sortRaw, voteGte, yearGte, yearLte } = state.params;
    const genreMap = await getGenreMap(type);
    const genreIds = [...state.genres].map(n => genreMap[n]).filter(Boolean);
    const sortByBase = sortRaw === 'release'
      ? (type === 'tv' ? 'first_air_date' : 'primary_release_date')
      : sortRaw;
    const rs = await Promise.all(pagesArr.map(page => discoverTitles({
      mediaType: type,
      genreIds,
      sortBy: `${sortByBase}.${state.dir}`,
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
    const last = rs[rs.length - 1];
    state.hasMoreType[type] = last.hasMore && last.items.length > 0;
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

  // Отрисовка очередной порции глобально отсортированной ленты.
  // cap — сколько позиций буфера уже образуют точный глобальный топ без
  // «дыр»: тайтл, попавший в глобальный топ-K, внутри своего типа имеет ранг
  // ≤ K, значит страниц каждого типа должно быть загружено ≥ K / PAGE_SIZE.
  function renderDelta(replaceGrid) {
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
    const from = replaceGrid ? 0 : state.shownCount;
    const delta = merged.slice(from, cap);
    state.shownCount = cap;
    if (replaceGrid) {
      grid.innerHTML = tilesHtml(delta) || '<p class="col-span-full text-sm text-gray-500 text-center py-8">Ничего не нашлось — попробуйте смягчить фильтры.</p>';
    } else if (delta.length) {
      grid.insertAdjacentHTML('beforeend', tilesHtml(delta));
    }
    const totalEst = [...state.types].reduce((sum, t) => sum + (state.totals[t] || 0), 0);
    countEl.textContent = `показано ${cap} из ~${totalEst.toLocaleString('ru-RU')}`;
    const canMore = merged.length > cap || [...state.types].some(t => state.hasMoreType[t]);
    moreBtn.classList.toggle('hidden', !canMore);
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    state.params = readParams();
    if (reset) {
      state.buffers = { movie: [], tv: [] };
      state.pages = { movie: 0, tv: 0 };
      state.hasMoreType = { movie: true, tv: true };
      state.shownCount = 0;
      grid.innerHTML = Array.from({ length: 10 }).map(() => `
        <div class="animate-pulse"><div class="w-full aspect-[2/3] bg-slate-700 rounded-lg"></div><div class="h-3 bg-slate-700 rounded mt-1.5"></div></div>
      `).join('');
      countEl.textContent = '';
    }

    try {
      const pagesArrFor = (t) => reset
        ? [1, 2]
        : (state.hasMoreType[t] ? [state.pages[t] + 1, state.pages[t] + 2] : []);
      await Promise.all([...state.types].map(t => fetchTypePages(t, pagesArrFor(t))));
      renderDelta(reset);
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
