import { supabase } from '../lib/supabase.js';
import { formatDistanceToNow } from '../lib/date.js';
import { searchTitles, getTrending, getRecommendations } from '../lib/tmdb.js';
import { openRatingModal } from './RatingModal.js';
import { openCatalog } from './Catalog.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';
import { getSearchQueries, getRecentTitles, addSearchQuery, clearHistory } from '../lib/history.js';

// Текущий фильтр ленты и канал реалтайма храним на уровне модуля,
// чтобы при уходе со страницы закрыть канал и не копить подписки.
const SORT_KEY = 'gulrating:feed_sort';
const SORT_OPTIONS = [
  { id: 'new', label: 'Новые' },
  { id: 'rating_desc', label: 'Высокие сначала' },
  { id: 'rating_asc', label: 'Низкие сначала' },
];

function readSort() {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return SORT_OPTIONS.some(o => o.id === value) ? value : 'new';
  } catch (e) {
    return 'new';
  }
}

function saveSort(value) {
  try {
    localStorage.setItem(SORT_KEY, value);
  } catch (e) {
    // игнорируем
  }
}

let activeFilter = 'all';
let activeSort = readSort();   // сортировка ленты: new | rating_desc | rating_asc
let feedChannel = null;
let realtimeTimer = null;
// Кэши рекомендаций на сессию: TMDb-запросы дорогие, повторный рендер ленты их не повторяет
const recsCache = { trending: null, personal: null, personalKey: '' };
let lastNewToastAt = 0;     // троттлинг тоста «новое в ленте»

export function cleanupFeed() {
  if (feedChannel) {
    supabase.removeChannel(feedChannel);
    feedChannel = null;
  }
  clearTimeout(realtimeTimer);
}

export async function renderFeed(app, currentUser) {
  cleanupFeed();
  activeFilter = 'all';

  app.innerHTML = `
    <div class="max-w-4xl mx-auto pb-20">
      <div class="sticky top-0 z-20 bg-dark/80 backdrop-blur-card py-4 px-4 border-b border-slate-800">
        <div class="flex items-center gap-3 mb-3">
          <img src="${escapeHtml(safeAvatarUrl(currentUser.profile.avatar_url, currentUser.profile.username))}" alt=""
            class="w-10 h-10 rounded-full bg-slate-700 border border-slate-600">
          <div class="min-w-0">
            <h1 class="text-xl font-bold leading-tight truncate">Привет, ${escapeHtml(currentUser.profile.username)}! 👋</h1>
            <p class="text-xs text-gray-400">${escapeHtml(todayCaption())}</p>
          </div>
        </div>
        <div class="relative">
          <input type="text" id="search-input" placeholder="Поиск фильма или сериала..." autocomplete="off"
            class="w-full pl-10 pr-24 py-3 bg-card border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
          <svg class="absolute left-3 top-3.5 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <button id="catalog-btn" class="absolute right-2 top-1.5 bottom-1.5 px-3 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-xs text-gray-300" title="Каталог: жанры, годы, рейтинг">Каталог</button>
        </div>
        <div id="search-results" class="absolute left-4 right-4 mt-2 bg-card rounded-xl border border-slate-700 shadow-xl z-30 max-h-96 overflow-y-auto hidden"></div>
      </div>

      <div class="p-4">
        <div class="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
          <button class="filter-btn px-4 py-2 bg-primary text-white rounded-full text-sm font-medium whitespace-nowrap" data-filter="all">Все оценки</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="movies">Фильмы</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="tv">Сериалы</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="mine">Мои оценки</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="watchlist">Хочу посмотреть</button>
        </div>

        <div class="flex items-center gap-2 mb-4 text-xs text-gray-400">
          <span class="flex-shrink-0">Сортировка:</span>
          <div class="flex gap-1.5 overflow-x-auto scrollbar-hide">
            ${SORT_OPTIONS.map(o => `
              <button class="sort-btn px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${o.id === activeSort ? 'bg-secondary text-white' : 'bg-card hover:bg-slate-700'}" data-sort="${o.id}">${o.label}</button>
            `).join('')}
          </div>
        </div>

        <div id="feed-note" class="hidden text-xs text-gray-500 mb-3">Показан список «хочу посмотреть» всей вашей компании</div>

        <!-- Рекомендации: популярность, вкусы друзей, персональный подбор -->
        <div id="recs-section" class="space-y-6 mb-6"></div>

        <div id="ratings-list" class="space-y-4">
          ${skeletonCards(3)}
        </div>
      </div>

      <!-- Нижняя навигация -->
      <nav class="fixed bottom-0 left-0 right-0 bg-dark/90 backdrop-blur-card border-t border-slate-800 z-10">
        <div class="max-w-4xl mx-auto flex">
          <button class="nav-btn flex-1 py-3 flex flex-col items-center text-primary" data-page="feed">
            <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4m8 4V10a1 1 0 00-1-1h-2a1 1 0 00-1 1v4m3 1h3a1 1 0 001-1V10m-4 0l2-2m0 0l2 2"></path></svg>
            <span class="text-xs">Лента</span>
          </button>
          <button class="nav-btn flex-1 py-3 flex flex-col items-center text-gray-400 hover:text-white" data-page="profile">
            <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            <span class="text-xs">Профиль</span>
          </button>
        </div>
      </nav>
    </div>
  `;

  // Загружаем оценки и рекомендации (рекомендации — параллельно, не ждём их)
  loadRecs(currentUser);
  await loadRatings(currentUser, activeFilter);

  // Инициализируем поиск и навигацию
  initSearch(currentUser);
  initNav(currentUser);
  initSort(currentUser);

  // Каталог: полноценный просмотр с жанрами и фильтрами
  document.getElementById('catalog-btn').addEventListener('click', () => {
    openCatalog(currentUser, (id, type) => {
      openRatingModal(id, type, currentUser, () => loadRatings(currentUser, activeFilter));
    });
  });

  // Подписываемся на реалтайм обновления оценок и watchlist.
  // Чужие новые оценки дополнительно подсвечиваем тостом — реалтайм становится заметным.
  const onRemoteChange = (payload) => {
    const isNewFromFriend = payload && payload.eventType === 'INSERT'
      && payload.new && payload.new.user_id !== currentUser.id;
    if (isNewFromFriend) {
      const now = Date.now();
      if (now - lastNewToastAt > 5000) {
        lastNewToastAt = now;
        showToast('🎬 Кто-то из друзей только что обновил ленту', 'info', 2500);
      }
    }
    scheduleReload(currentUser);
  };

  feedChannel = supabase.channel('feed-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, onRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'watchlist' }, onRemoteChange)
    .subscribe();
}

// Перезагрузка ленты с дебаунсом: пачка событий реалтайма не должна дёргать список
function scheduleReload(currentUser) {
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(() => {
    if (document.getElementById('ratings-list')) {
      loadRatings(currentUser, activeFilter);
    }
  }, 400);
}

async function loadRatings(currentUser, filter = 'all') {
  const listEl = document.getElementById('ratings-list');
  const noteEl = document.getElementById('feed-note');
  if (!listEl) return;

  // Примечание для режима «хочу посмотреть» (показываем всю компанию)
  if (noteEl) noteEl.classList.toggle('hidden', filter !== 'watchlist');

  let data;

  if (filter === 'watchlist') {
    const { data: watchlist, error } = await supabase
      .from('watchlist')
      .select(`*, titles!inner(*), profiles!inner(*)`)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<div class="text-center py-12 text-red-400">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
      return;
    }
    data = watchlist;
  } else {
    // titles!inner — внутренний join: фильтр по типу тайтла применяется к строкам
    // ленты, а не к вложенному объекту (без !inner PostgREST вернул бы все оценки
    // с пустым titles и страница падала бы на чтении title.title)
    let query = supabase
      .from('ratings')
      .select(`*, profiles!inner(*), titles!inner(*)`)
      .order('created_at', { ascending: false });

    if (filter === 'movies') {
      query = query.eq('titles.media_type', 'movie');
    } else if (filter === 'tv') {
      query = query.eq('titles.media_type', 'tv');
    } else if (filter === 'mine') {
      query = query.eq('user_id', currentUser.id);
    }

    const { data: ratings, error } = await query;

    if (error) {
      listEl.innerHTML = `<div class="text-center py-12 text-red-400">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
      return;
    }
    data = applySort(ratings);
  }

  if (!data || data.length === 0) {
    if (filter === 'all') {
      // Первое впечатление: не пустое полотно, а онбординг + живые постеры трендов
      listEl.innerHTML = `
        <div class="bg-card border border-slate-700/70 rounded-2xl p-5 mb-6">
          <h2 class="text-lg font-semibold mb-1">Оценок пока нет</h2>
          <p class="text-sm text-gray-400 mb-4">Лента пустая. Оцените любой фильм через поиск сверху — оценка появится здесь.</p>
          <button id="focus-search-btn" class="bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 px-5 rounded-xl">
            Найти фильм
          </button>
        </div>
      `;
      const focusBtn = document.getElementById('focus-search-btn');
      if (focusBtn) focusBtn.addEventListener('click', () => document.getElementById('search-input').focus());
      return;
    }

    let emptyText = 'Пока нет оценок. Найдите фильм через поиск и поставьте первую оценку.';
    if (filter === 'watchlist') emptyText = 'В списке «Хочу посмотреть» пока ничего нет. Найдите фильм и добавьте его.';
    if (filter === 'mine') emptyText = 'Вы еще не поставили ни одной оценки.';

    listEl.innerHTML = `
      <div class="text-center py-12 text-gray-500">
        <div class="text-4xl mb-3">🎞️</div>
        <p>${emptyText}</p>
      </div>
    `;
    return;
  }

  const isWatchlistView = filter === 'watchlist';

  listEl.innerHTML = data.map(item => {
    const title = item.titles;
    const user = item.profiles;
    if (!title || !user) return '';

    const year = releaseYear(title.release_date);
    const ratingColor = item.rating >= 8 ? 'bg-green-600' : item.rating >= 5 ? 'bg-yellow-600' : 'bg-red-600';

    return `
      <div class="title-card bg-card rounded-2xl overflow-hidden hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}">
        <div class="p-4 flex gap-4">
          <div class="flex-shrink-0 w-20">
            ${posterImg(title.poster_path, title.title, 'w-20 aspect-[2/3] rounded-lg')}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h3 class="font-semibold text-lg leading-tight">${escapeHtml(title.title)}</h3>
                <p class="text-sm text-gray-400">${year ? escapeHtml(year) + ' • ' : ''}${title.media_type === 'movie' ? 'фильм' : 'сериал'}</p>
              </div>
              ${!isWatchlistView ? `
                <div class="${ratingColor} px-2 py-1 rounded-lg text-white font-bold text-lg min-w-[44px] text-center">
                  ${escapeHtml(formatRating(item.rating))}
                </div>
              ` : `
                <div class="px-2 py-1 rounded-lg bg-slate-700 text-yellow-400 font-medium text-sm">
                  Хочу посмотреть
                </div>
              `}
            </div>
            
            <div class="mt-2 flex items-center gap-2">
              <img src="${escapeHtml(safeAvatarUrl(user.avatar_url, user.username))}" alt="" class="w-6 h-6 rounded-full bg-slate-700">
              <span class="text-sm text-gray-300">${escapeHtml(user.username)}</span>
              <span class="text-xs text-gray-500">${formatDistanceToNow(new Date(item.created_at))}</span>
            </div>
            
            ${!isWatchlistView && item.comment ? `<p class="mt-2 text-gray-300 text-sm line-clamp-2">${escapeHtml(item.comment)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Обработчик клика по карточке тайтла
  document.querySelectorAll('.title-card').forEach(card => {
    card.addEventListener('click', () => {
      const titleId = card.dataset.titleId;
      const mediaType = card.dataset.mediaType;
      openRatingModal(titleId, mediaType, currentUser, () => {
        loadRatings(currentUser, activeFilter);
      });
    });
  });
}

// Сортировка оценок ленты (выбор пользователя хранится локально)
function applySort(list) {
  const arr = [...(list || [])];
  if (activeSort === 'rating_desc') {
    arr.sort((a, b) => Number(b.rating) - Number(a.rating));
  } else if (activeSort === 'rating_asc') {
    arr.sort((a, b) => Number(a.rating) - Number(b.rating));
  }
  return arr;
}

function initSort(currentUser) {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSort = btn.dataset.sort;
      saveSort(activeSort);
      document.querySelectorAll('.sort-btn').forEach(b => {
        const active = b.dataset.sort === activeSort;
        b.classList.toggle('bg-secondary', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('bg-card', !active);
        b.classList.toggle('hover:bg-slate-700', !active);
      });
      loadRatings(currentUser, activeFilter);
    });
  });
}

// Подпись под приветствием: сегодняшняя дата по-русски
function todayCaption() {
  const s = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return 'Сегодня ' + s;
}

// Скелетоны карточек на время загрузки вместо текста «Загружаем...»
function skeletonCards(count = 3) {
  return Array.from({ length: count }).map(() => `
    <div class="bg-card rounded-2xl p-4 flex gap-4 animate-pulse">
      <div class="flex-shrink-0 w-20 aspect-[2/3] bg-slate-700 rounded-lg"></div>
      <div class="flex-1 space-y-3 py-1">
        <div class="h-5 bg-slate-700 rounded w-2/3"></div>
        <div class="h-4 bg-slate-700 rounded w-1/3"></div>
        <div class="h-4 bg-slate-700 rounded w-1/2"></div>
      </div>
    </div>
  `).join('');
}

// --- Рекомендации: три ряда подборов -------------------------------------
// 1) Популярно сейчас (тренды TMDb); 2) Друзья оценили высоко (из нашей БД,
// среднее >= 7.5 и вы ещё не оценили); 3) Похоже на то, что вам понравилось
// (TMDb recommendations от вашего топ-тайтла). Ряды кликабельны целиком.
async function loadRecs(currentUser) {
  const section = document.getElementById('recs-section');
  if (!section) return;
  if (localStorage.getItem('gulrating:show_recs') === '0') {
    section.innerHTML = '';
    return;
  }

  section.innerHTML = `
    ${recRowSkeleton('recs-popular', 'Популярно сейчас')}
    ${recRowSkeleton('recs-friends', 'Друзья оценили высоко')}
    ${recRowSkeleton('recs-want', 'Друзья хотят посмотреть')}
    ${recRowSkeleton('recs-personal', 'Похоже на то, что вам понравилось')}
  `;

  // Ряд 1: тренды недели
  try {
    if (!recsCache.trending) recsCache.trending = await getTrending(12);
    fillRecRow(section, 'recs-popular', 'Популярно сейчас', 'неделя · TMDb', recsCache.trending, null, 'Тренды недоступны — проверьте соединение с TMDb.');
  } catch (e) {
    dropRecRow(section, 'recs-popular');
  }

  // Ряд 2 и 3: одним запросом по всем оценкам компании
  try {
    const { data, error } = await supabase
      .from('ratings')
      .select('user_id, rating, titles(*)');
    if (error) throw error;

    const mine = new Set();
    let myTop = null;
    const agg = new Map();
    for (const r of data || []) {
      const t = r.titles;
      if (!t) continue;
      if (r.user_id === currentUser.id) {
        mine.add(String(t.id));
        const score = Number(r.rating);
        if (score >= myMin && (!myTop || score > myTop.score)) myTop = { id: t.id, media_type: t.media_type, score };
        continue;
      }
      const cur = agg.get(String(t.id)) || { title: t, sum: 0, count: 0 };
      cur.sum += Number(r.rating);
      cur.count += 1;
      agg.set(String(t.id), cur);
    }

    // Все пороги настраиваются в профиле, шкалы полные (0–10 / 1–6)
    const friendsThreshold = parseFloat(localStorage.getItem('gulrating:friends_threshold') ?? '7.5');
    const wantMin = parseInt(localStorage.getItem('gulrating:want_min') || '1', 10) || 1;
    const myMin = parseFloat(localStorage.getItem('gulrating:my_min') ?? '8');
    const friendsHigh = [...agg.values()]
      .map(cur => ({ ...cur.title, friends_avg: cur.sum / cur.count, friends_count: cur.count }))
      .filter(t => t.friends_avg >= friendsThreshold && !mine.has(String(t.id)))
      .sort((a, b) => b.friends_avg - a.friends_avg || b.friends_count - a.friends_count)
      .slice(0, 12)
      .map(t => ({ id: t.id, media_type: t.media_type, title: t.title, release_date: t.release_date, poster_path: t.poster_path, badge: t.friends_avg.toFixed(1) }));
    fillRecRow(section, 'recs-friends', 'Друзья оценили высоко', `средняя ≥ ${friendsThreshold.toFixed(1)} · вы ещё не оценили`, friendsHigh, 'bg-pink-600', 'Появится, когда кто-то из компании поставит оценки.');

    // Ряд без оценок: агрегат списков «хочу посмотреть» всей компании
    const { data: wl } = await supabase
      .from('watchlist')
      .select('user_id, titles(*)');
    const wantAgg = new Map();
    for (const w of wl || []) {
      const t = w.titles;
      if (!t || w.user_id === currentUser.id) continue;
      const cur = wantAgg.get(String(t.id)) || { title: t, users: new Set() };
      cur.users.add(w.user_id);
      wantAgg.set(String(t.id), cur);
    }
    const wantItems = [...wantAgg.values()]
      .filter(cur => cur.users.size >= wantMin && !mine.has(String(cur.title.id)))
      .sort((a, b) => b.users.size - a.users.size)
      .slice(0, 12)
      .map(cur => ({
        id: cur.title.id,
        media_type: cur.title.media_type,
        title: cur.title.title,
        release_date: cur.title.release_date,
        poster_path: cur.title.poster_path,
        badge: String(cur.users.size)
      }));
    fillRecRow(section, 'recs-want', 'Друзья хотят посмотреть', `в списках у ${wantMin}+ друзей · на постере число друзей`, wantItems, 'bg-secondary', 'Появится, когда друзья добавят тайтлы в списки «хочу посмотреть».');

    // Ряд 3: персональный подбор от вашей лучшей оценки
    if (myTop) {
      const key = `${myTop.media_type}:${myTop.id}`;
      if (recsCache.personalKey !== key || !recsCache.personal) {
        const recs = await getRecommendations(myTop.id, myTop.media_type, 14);
        recsCache.personal = recs
          .filter(t => !mine.has(String(t.id)))
          .slice(0, 12);
        recsCache.personalKey = key;
      }
      fillRecRow(section, 'recs-personal', 'Похоже на то, что вам понравилось', `потому что вы оценили «${escapeHtml(myTopTitle(data, currentUser, myTop) || '')}» на ${myMin.toFixed(1)}+`, recsCache.personal, 'bg-primary', 'Появится, когда вы оцените фильмы: подбор отталкивается от ваших высоких оценок.');
    } else {
      fillRecRow(section, 'recs-personal', 'Похоже на то, что вам понравилось', '', [], 'bg-primary', 'Появится, когда вы оцените фильмы: подбор отталкивается от ваших высоких оценок.');
    }
  } catch (e) {
    dropRecRow(section, 'recs-friends');
    dropRecRow(section, 'recs-personal');
  }

  section.querySelectorAll('.rec-card').forEach(card => {
    card.addEventListener('click', () => {
      openRatingModal(card.dataset.id, card.dataset.type, currentUser, () => {
        loadRatings(currentUser, activeFilter);
        loadRecs(currentUser);
      });
    });
  });
}

// Название тайтла пользователя для подписи третьего ряда
function myTopTitle(data, currentUser, myTop) {
  const row = (data || []).find(r => r.user_id === currentUser.id && r.titles && String(r.titles.id) === String(myTop.id));
  return row ? row.titles.title : '';
}

function recRowSkeleton(id, titleText) {
  return `
    <div id="${id}" class="rec-row">
      <h3 class="font-semibold mb-3">${escapeHtml(titleText)}</h3>
      <div class="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
        ${Array.from({ length: 6 }).map(() => `<div class="flex-shrink-0 w-28 animate-pulse"><div class="w-28 aspect-[2/3] bg-slate-700 rounded-lg"></div><div class="h-3 bg-slate-700 rounded mt-2"></div></div>`).join('')}
      </div>
    </div>
  `;
}

function dropRecRow(section, id) {
  const row = section.querySelector('#' + id);
  if (row) row.remove();
}

function fillRecRow(section, id, titleText, subtitle, items, badgeClass, emptyHint) {
  const row = section.querySelector('#' + id);
  if (!row) return;
  if (!items || items.length === 0) {
    // Ряд не исчезает молча: объясняем, при каком условии он наполнится
    row.innerHTML = `
      <h3 class="font-semibold mb-1">${escapeHtml(titleText)}</h3>
      <p class="text-xs text-gray-600">${escapeHtml(emptyHint || 'Пока пусто.')}</p>
    `;
    return;
  }
  row.innerHTML = `
    <h3 class="font-semibold mb-1">${escapeHtml(titleText)}</h3>
    <p class="text-xs text-gray-500 mb-3">${escapeHtml(subtitle || '')}</p>
    <div class="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
      ${items.map(item => {
        const year = releaseYear(item.release_date);
        return `
          <div class="rec-card flex-shrink-0 w-28 cursor-pointer group relative" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
            <div class="group-hover:opacity-80 transition-opacity">
              ${posterImg(item.poster_path, item.title, 'w-28 aspect-[2/3] rounded-lg shadow-lg')}
            </div>
            ${item.badge ? `<span class="absolute top-1 right-1 ${badgeClass || 'bg-primary'} text-white text-[11px] font-bold px-1.5 py-0.5 rounded-md">${escapeHtml(item.badge)}</span>` : ''}
            <div class="mt-1.5 text-xs font-medium truncate">${escapeHtml(item.title)}</div>
            <div class="text-[11px] text-gray-500">${year ? escapeHtml(year) + ' • ' : ''}${item.media_type === 'movie' ? 'фильм' : 'сериал'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function initSearch(currentUser) {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  let searchTimeout;

  // При фокусе на пустом поле показываем историю поиска
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length < 2) showHistoryDropdown();
  });

  // История: недавние запросы и недавно открытые тайтлы (хранятся локально)
  function showHistoryDropdown() {
    const queries = getSearchQueries();
    const titles = getRecentTitles();
    if (queries.length === 0 && titles.length === 0) {
      resultsContainer.classList.add('hidden');
      return;
    }

    resultsContainer.innerHTML = `
      <div class="p-2 flex items-center justify-between border-b border-slate-700">
        <span class="text-xs text-gray-500 px-1">Недавние</span>
        <button id="clear-history-btn" class="text-xs text-gray-400 hover:text-white px-2 py-1 rounded">Очистить</button>
      </div>
      ${queries.length ? `
        <div class="p-1">
          ${queries.map(q => `
            <div class="history-query p-2 hover:bg-slate-700 cursor-pointer flex items-center gap-2 rounded-lg" data-query="${escapeHtml(q)}">
              <svg class="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <span class="text-sm truncate">${escapeHtml(q)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${titles.length ? `
        <div class="p-2 border-t border-slate-700">
          <div class="grid grid-cols-4 gap-2">
            ${titles.map(t => `
              <div class="history-title cursor-pointer group min-w-0" data-id="${escapeHtml(t.id)}" data-type="${escapeHtml(t.media_type)}">
                ${posterImg(t.poster_path, t.title, 'w-full aspect-[2/3] rounded-lg')}
                <div class="text-[11px] truncate mt-1 group-hover:text-white">${escapeHtml(t.title)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
    resultsContainer.classList.remove('hidden');

    document.getElementById('clear-history-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearHistory();
      resultsContainer.classList.add('hidden');
      showToast('История очищена', 'success');
    });
    document.querySelectorAll('.history-query').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.query;
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
      });
    });
    document.querySelectorAll('.history-title').forEach(el => {
      el.addEventListener('click', () => {
        resultsContainer.classList.add('hidden');
        openRatingModal(el.dataset.id, el.dataset.type, currentUser, () => {
          loadRatings(currentUser, activeFilter);
        });
      });
    });
  }

  searchInput.addEventListener('input', async (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (query.length < 2) {
      resultsContainer.classList.add('hidden');
      return;
    }

    searchTimeout = setTimeout(async () => {
      let results = [];
      let errorText = null;
      try {
        results = await searchTitles(query);
      } catch (err) {
        errorText = err.message;
      }

      if (errorText) {
        resultsContainer.innerHTML = `<div class="p-4 text-red-400 text-center text-sm">${escapeHtml(errorText)}</div>`;
      } else if (results.length === 0) {
        resultsContainer.innerHTML = `<div class="p-4 text-gray-500 text-center">Ничего не найдено</div>`;
      } else {
        resultsContainer.innerHTML = results.map(item => {
          const year = releaseYear(item.release_date);
          return `
            <div class="search-result-item p-3 hover:bg-slate-700 cursor-pointer flex gap-3 transition-colors" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
              <div class="flex-shrink-0 w-10">
                ${posterImg(item.poster_path, item.title, 'w-10 aspect-[2/3] rounded')}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">${escapeHtml(item.title)}</div>
                <div class="text-sm text-gray-400">${year ? escapeHtml(year) + ' • ' : ''}${item.media_type === 'movie' ? 'фильм' : 'сериал'}</div>
              </div>
            </div>
          `;
        }).join('');

        // Обработчик клика по результату поиска
        document.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const titleId = item.dataset.id;
            const mediaType = item.dataset.type;

            // Запоминаем запрос, который привёл к выбору
            addSearchQuery(searchInput.value);

            resultsContainer.classList.add('hidden');
            searchInput.value = '';

            openRatingModal(titleId, mediaType, currentUser, () => {
              loadRatings(currentUser, activeFilter);
            });
          });
        });
      }

      resultsContainer.classList.remove('hidden');
    }, 300);
  });

  // Скрываем результаты при клике вне поиска и по Escape
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
      resultsContainer.classList.add('hidden');
    }
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') resultsContainer.classList.add('hidden');
    // Enter открывает первый результат — быстрее на телефоне
    if (e.key === 'Enter') {
      const first = resultsContainer.querySelector('.search-result-item');
      if (first) first.click();
    }
  });

  // Обработчики фильтров
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('bg-primary', 'text-white');
        b.classList.add('bg-card', 'hover:bg-slate-700');
      });
      btn.classList.remove('bg-card', 'hover:bg-slate-700');
      btn.classList.add('bg-primary', 'text-white');
      activeFilter = btn.dataset.filter;
      loadRatings(currentUser, activeFilter);
    });
  });
}

function initNav(currentUser) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.page === 'profile') {
        const { renderProfilePage } = await import('./Profile.js');
        renderProfilePage(document.getElementById('app'), currentUser);
      } else if (btn.dataset.page === 'feed') {
        renderFeed(document.getElementById('app'), currentUser);
      }
    });
  });
}
