import { discoverTitles, getGenreMap } from '../lib/tmdb.js';
import { escapeHtml, releaseYear, posterImg } from '../lib/dom.js';

// Каталог TMDb: полноценный просмотр фильмов и сериалов с жанрами,
// сортировкой, порогом рейтинга и десятилетиями. Открывается оверлеем,
// результаты — плиткой постеров, клик открывает карточку тайтла.
const SORTS = [
  { id: 'popularity.desc', label: 'По популярности' },
  { id: 'vote_average.desc', label: 'По рейтингу' },
  { id: 'release', label: 'Сначала новые' },
];
const DECADES = [
  { id: '', label: 'Любые годы', gte: '', lte: '' },
  { id: '2020', label: '2020-е', gte: '2020', lte: '2029' },
  { id: '2010', label: '2010-е', gte: '2010', lte: '2019' },
  { id: '2000', label: '2000-е', gte: '2000', lte: '2009' },
  { id: '1990', label: '1990-е', gte: '1990', lte: '1999' },
  { id: 'old', label: 'До 1990', gte: '', lte: '1989' },
];

export async function openCatalog(currentUser, onOpenTitle) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4';
  overlay.innerHTML = `
    <div class="bg-card w-full max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col overflow-hidden">
      <div class="flex justify-between items-center p-4 border-b border-slate-700">
        <h3 class="font-bold text-lg">Каталог фильмов и сериалов</h3>
        <button id="catalog-close" class="text-gray-400 hover:text-white px-2 text-xl leading-none" aria-label="Закрыть">×</button>
      </div>

      <div class="p-4 border-b border-slate-700 space-y-3 overflow-y-auto max-h-56">
        <div class="flex flex-wrap items-center gap-2">
          <button class="catalog-type px-3 py-1.5 rounded-full text-sm font-medium" data-type="movie">Фильмы</button>
          <button class="catalog-type px-3 py-1.5 rounded-full text-sm font-medium" data-type="tv">Сериалы</button>
          <select id="catalog-sort" class="ml-auto bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white">
            ${SORTS.map(s => `<option value="${s.id}">${s.label}</option>`).join('')}
          </select>
          <select id="catalog-vote" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white">
            <option value="0">Рейтинг: любой</option>
            <option value="6">TMDb ≥ 6</option>
            <option value="7">TMDb ≥ 7</option>
            <option value="8">TMDb ≥ 8</option>
          </select>
          <select id="catalog-decade" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white">
            ${DECADES.map(d => `<option value="${d.id}">${d.label}</option>`).join('')}
          </select>
        </div>
        <div id="catalog-genres" class="flex flex-wrap gap-1.5 text-xs text-gray-500">Загружаем жанры…</div>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <div id="catalog-grid" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3"></div>
        <div class="text-center mt-4">
          <button id="catalog-more" class="hidden px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm">Показать ещё</button>
        </div>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#catalog-close').addEventListener('click', close);
  document.body.appendChild(overlay);

  const state = { mediaType: 'movie', genres: new Set(), page: 1, hasMore: false, loading: false };
  const grid = overlay.querySelector('#catalog-grid');
  const genresBox = overlay.querySelector('#catalog-genres');
  const moreBtn = overlay.querySelector('#catalog-more');

  function paintTypeButtons() {
    overlay.querySelectorAll('.catalog-type').forEach(b => {
      const active = b.dataset.type === state.mediaType;
      b.className = 'catalog-type px-3 py-1.5 rounded-full text-sm font-medium ' + (active ? 'bg-primary text-white' : 'bg-slate-800 text-gray-300 hover:bg-slate-700');
    });
  }

  async function paintGenres() {
    genresBox.innerHTML = 'Загружаем жанры…';
    try {
      const map = await getGenreMap(state.mediaType);
      const names = Object.keys(map).sort((a, b) => a.localeCompare(b, 'ru'));
      genresBox.innerHTML = names.map(n => `
        <button class="catalog-genre px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 cursor-pointer" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>
      `).join('');
      genresBox.querySelectorAll('.catalog-genre').forEach(chip => {
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
      genresBox.innerHTML = 'Жанры недоступны — поиск по фильтрам всё равно работает.';
    }
  }

  async function load(reset) {
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.page = 1;
      grid.innerHTML = Array.from({ length: 10 }).map(() => `
        <div class="animate-pulse"><div class="w-full aspect-[2/3] bg-slate-700 rounded-lg"></div><div class="h-3 bg-slate-700 rounded mt-1.5"></div></div>
      `).join('');
    }

    try {
      const genreMap = await getGenreMap(state.mediaType);
      const genreIds = [...state.genres].map(n => genreMap[n]).filter(Boolean);
      const decade = DECADES.find(d => d.id === overlay.querySelector('#catalog-decade').value) || DECADES[0];
      const sortRaw = overlay.querySelector('#catalog-sort').value;
      const sortBy = sortRaw === 'release'
        ? (state.mediaType === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc')
        : sortRaw;

      const { items, hasMore } = await discoverTitles({
        mediaType: state.mediaType,
        genreIds,
        sortBy,
        voteGte: Number(overlay.querySelector('#catalog-vote').value) || 0,
        yearGte: decade.gte,
        yearLte: decade.lte,
        page: state.page
      });

      state.hasMore = hasMore;
      moreBtn.classList.toggle('hidden', !hasMore);

      const html = items.map(item => `
        <div class="catalog-item cursor-pointer group" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
          <div class="relative group-hover:opacity-80 transition-opacity">
            ${posterImg(item.poster_path, item.title, 'w-full aspect-[2/3] rounded-lg')}
            ${item.vote_average ? `<span class="absolute top-1 right-1 bg-black/70 text-cyan-300 text-[11px] font-bold px-1.5 py-0.5 rounded-md">${Number(item.vote_average).toFixed(1)}</span>` : ''}
          </div>
          <div class="mt-1.5 text-xs font-medium line-clamp-2 leading-tight">${escapeHtml(item.title)}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(releaseYear(item.release_date) || '—')}</div>
        </div>
      `).join('');

      if (reset) grid.innerHTML = html || '<p class="col-span-full text-sm text-gray-500 text-center py-8">Ничего не нашлось — попробуйте смягчить фильтры.</p>';
      else grid.insertAdjacentHTML('beforeend', html);
    } catch (e) {
      if (reset) grid.innerHTML = '<p class="col-span-full text-sm text-red-400 text-center py-8">Не удалось загрузить каталог.</p>';
    } finally {
      state.loading = false;
    }
  }

  overlay.querySelectorAll('.catalog-type').forEach(b => {
    b.addEventListener('click', () => {
      if (state.mediaType === b.dataset.type) return;
      state.mediaType = b.dataset.type;
      state.genres.clear();
      paintTypeButtons();
      paintGenres();
      load(true);
    });
  });
  ['#catalog-sort', '#catalog-vote', '#catalog-decade'].forEach(sel => {
    overlay.querySelector(sel).addEventListener('change', () => load(true));
  });
  moreBtn.addEventListener('click', () => {
    state.page += 1;
    load(false);
  });
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
