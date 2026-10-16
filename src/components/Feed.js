import { supabase } from '../lib/supabase.js';
import { formatDistanceToNow } from '../lib/date.js';
import { searchTitles, getTrending, getRecommendations, primeTitleCache } from '../lib/tmdb.js';
import { openRatingModal } from './RatingModal.js';
import { openCatalog } from './Catalog.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';
import { getSearchQueries, getRecentTitles, addSearchQuery, clearHistory } from '../lib/history.js';
import { getPendingRatings, flushPendingRatings } from '../lib/offline.js';
import { searchOfflineCatalog, getPopularOffline, getOfflineCatalogStats } from '../lib/offlineCatalog.js';
import { isFullCatalogInstalled, searchFullCatalog } from '../lib/fullCatalog.js';
import { getNotifications, markNotificationsRead, unreadNotifications } from '../lib/watchHistory.js';
import { mountPage } from '../lib/pageState.js';

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
let feedRoot = null;
const feedEl = (id) => feedRoot?.querySelector(`#${id}`) || null;
const feedAll = (selector) => feedRoot?.querySelectorAll(selector) || [];
let activeSort = readSort();   // сортировка ленты: new | rating_desc | rating_asc
let feedChannel = null;
let realtimeTimer = null;
// Вкладки трендов: каждая — своя выборка TMDb, показываются сеткой
const TREND_TABS = [
  { key: 'day', label: 'Сегодня', mediaType: 'all', window: 'day' },
  { key: 'week', label: 'Неделя', mediaType: 'all', window: 'week' },
  { key: 'movie', label: 'Фильмы', mediaType: 'movie', window: 'week' },
  { key: 'tv', label: 'Сериалы', mediaType: 'tv', window: 'week' },
];
let trendsActive = 'week';

// Кэши рекомендаций на сессию: TMDb-запросы дорогие, повторный рендер ленты их не повторяет
const recsCache = { trends: {}, personal: null, personalKey: '', personalSub: '', db: null, dbAt: 0 };

// Подписи пустых рядов рекомендаций — объясняют, при каком условии ряд наполнится
const FRIENDS_EMPTY_HINT = 'Появится, когда кто-то из компании поставит оценки.';
const WANT_EMPTY_HINT = 'Появится, когда друзья добавят тайтлы в списки «хочу посмотреть».';
const PERSONAL_EMPTY_HINT = 'Появится, когда вы оцените фильмы: подбор отталкивается от ваших оценок.';
let lastNewToastAt = 0;     // троттлинг тоста «новое в ленте»
let searchDocClickHandler = null; // document-обработчик клика из поиска
let onlineFlushHandler = null;    // автосинк отложенных оценок при появлении сети
let filtersResizeHandler = null;  // пересчёт отступа липких фильтров
let notifChangedHandler = null;   // обновление бейджа колокольчика
let feedLayoutHandler = null;
let mergeRatingsHandler = null;

// Офлайн-копия ленты: последний успешный срез по каждому фильтру
const FEED_CACHE_KEY = 'gulrating:feed_cache';
function writeFeedCache(filter, items) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '{}');
    all[filter] = (items || []).slice(0, 20);
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(all));
  } catch (e) { /* приватный режим */ }
}
function readFeedCache(filter) {
  try {
    const all = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || '{}');
    const items = all[filter];
    return Array.isArray(items) && items.length ? items : null;
  } catch (e) {
    return null;
  }
}

async function feedRequest(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(resolve => {
        timer = setTimeout(() => resolve({ data: null, error: new Error('Сервер не ответил за 5 секунд') }), 5000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function cleanupFeed() {
  if (feedChannel) {
    supabase.removeChannel(feedChannel);
    feedChannel = null;
  }
  clearTimeout(realtimeTimer);
  if (searchDocClickHandler) {
    document.removeEventListener('click', searchDocClickHandler);
    searchDocClickHandler = null;
  }
  if (onlineFlushHandler) {
    window.removeEventListener('online', onlineFlushHandler);
    onlineFlushHandler = null;
  }
  if (filtersResizeHandler) {
    window.removeEventListener('resize', filtersResizeHandler);
    filtersResizeHandler = null;
  }
  if (notifChangedHandler) {
    window.removeEventListener('gulrating:notifications-changed', notifChangedHandler);
    notifChangedHandler = null;
  }
  if (feedLayoutHandler) {
    window.removeEventListener('gulrating:feed-layout-changed', feedLayoutHandler);
    feedLayoutHandler = null;
  }
  if (mergeRatingsHandler) {
    window.removeEventListener('gulrating:merge-ratings-changed', mergeRatingsHandler);
    mergeRatingsHandler = null;
  }
}

export async function renderFeed(app, currentUser, { refresh = false } = {}) {
  const page = mountPage(app, 'feed');
  feedRoot = page.root;
  if (!page.isNew) {
    applyFeedOrder();
    if (refresh) {
      activeSort = readSort();
      await loadRatings(currentUser, activeFilter);
      recsCache.dbAt = 0;
      loadRecs(currentUser);
    }
    return;
  }

  cleanupFeed();
  activeFilter = 'all';
  activeSort = readSort(); // сортировку могли поменять из профиля

  page.root.innerHTML = `
    <div class="max-w-4xl xl:max-w-6xl mx-auto pb-20">
      <div class="sticky top-0 z-20 bg-dark/80 backdrop-blur-card py-4 px-4 border-b border-slate-800 safe-top">
        <div class="flex items-center gap-3 mb-3">
          <img src="${escapeHtml(safeAvatarUrl(currentUser.profile.avatar_url, currentUser.profile.username))}" alt=""
            class="w-10 h-10 rounded-full bg-slate-700 border border-slate-600">
          <div class="min-w-0 flex-1">
            <h1 class="text-xl font-bold leading-tight truncate">Привет, ${escapeHtml(currentUser.profile.username)}! 👋</h1>
            <p class="text-xs text-gray-400">${escapeHtml(todayCaption())}</p>
          </div>
          <button id="notif-btn" class="relative flex-shrink-0 w-10 h-10 rounded-xl bg-card hover:bg-slate-700 flex items-center justify-center" aria-label="Уведомления" title="Уведомления">
            <svg class="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
            <span id="notif-badge" class="hidden absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-secondary text-white text-[10px] font-bold flex items-center justify-center"></span>
          </button>
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

      ${currentUser.offlineOnly ? `
        <div class="mx-4 mt-3 rounded-xl border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          Офлайн-режим: показаны сохранённые данные. Серверная синхронизация продолжится при появлении сети.
        </div>
      ` : ''}
      <div class="p-4">
        <!-- Фильтры и сортировка: прилипают под шапкой и не исчезают при прокрутке -->
        <div id="feed-filters" class="sticky z-10 -mx-4 px-4 pt-2 pb-3 bg-dark/95 backdrop-blur-card">
        <div class="flex gap-2 mb-2 overflow-x-auto scrollbar-hide">
          <button class="filter-btn px-4 py-2 bg-primary text-white rounded-full text-sm font-medium whitespace-nowrap" data-filter="all">Все оценки</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="movies">Фильмы</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="tv">Сериалы</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="mine">Мои оценки</button>
          <button class="filter-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-filter="watchlist">Хочу посмотреть</button>
        </div>

        <div class="flex items-center gap-2 text-xs text-gray-400">
          <span class="flex-shrink-0">Сортировка:</span>
          <div class="flex gap-1.5 overflow-x-auto scrollbar-hide">
            ${SORT_OPTIONS.map(o => `
              <button class="sort-btn px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${o.id === activeSort ? 'bg-secondary text-white' : 'bg-card hover:bg-slate-700'}" data-sort="${o.id}">${o.label}</button>
            `).join('')}
          </div>
        </div>
        </div>

        <div id="feed-note" class="hidden text-xs text-gray-500 mt-3 mb-3">Показан список «хочу посмотреть» всей вашей компании</div>

        <div id="blocks-wrap" class="mt-4 space-y-6">

          <div id="blk-feed" class="space-y-3 ${getVisibleFeedSections().includes('feed') ? '' : 'hidden'}">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold">Оценки</h3>
            </div>

            <!-- Отложенные (офлайн) оценки: видно очередь и можно отправить вручную -->
            <div id="pending-banner" class="hidden mb-3 text-xs bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2 text-gray-300 flex items-center gap-2">
              <span id="pending-text"></span>
              <button id="pending-flush" class="ml-auto px-2 py-1 bg-primary hover:bg-primary/90 text-white rounded-lg flex-shrink-0">Отправить сейчас</button>
            </div>

            <div id="ratings-list" class="space-y-4">
              ${skeletonCards(3)}
            </div>
          </div>
        </div>
      </div>

      <!-- Нижняя навигация -->
      <nav class="fixed bottom-0 left-0 right-0 bg-dark/90 backdrop-blur-card border-t border-slate-800 z-10">
        <div class="max-w-4xl xl:max-w-6xl mx-auto flex">
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

  // Порядок секций применяется из настроек профиля; в самой ленте нет
  // элементов управления её составом и порядком.
  applyFeedOrder();

  // Уведомления: колокол с бейджем и список в оверлее
  function paintNotifBadge() {
    const badge = feedEl('notif-badge');
    if (!badge) return;
    const n = unreadNotifications();
    badge.textContent = n ? String(n) : '';
    badge.classList.toggle('hidden', !n);
  }
  notifChangedHandler = paintNotifBadge;
  window.addEventListener('gulrating:notifications-changed', notifChangedHandler);
  feedLayoutHandler = applyFeedOrder;
  window.addEventListener('gulrating:feed-layout-changed', feedLayoutHandler);
  mergeRatingsHandler = () => loadRatings(currentUser, activeFilter);
  window.addEventListener('gulrating:merge-ratings-changed', mergeRatingsHandler);
  feedEl('notif-btn').addEventListener('click', () => {
    const list = getNotifications();
    const ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-40 bg-black/60 p-4';
    ov.innerHTML = `
      <div class="mx-auto max-w-md mt-12 bg-card rounded-2xl border border-slate-700 p-4">
        <div class="flex items-center gap-2 mb-3">
          <h3 class="font-semibold flex-1">Уведомления</h3>
          <button id="notif-read" class="text-xs text-primary underline">все прочитаны</button>
          <button id="notif-close" class="text-gray-400 hover:text-white text-2xl leading-none px-1" aria-label="Закрыть">&times;</button>
        </div>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          ${list.length ? list.map(n => `
            <div class="text-sm rounded-xl p-2 ${n.read ? 'text-gray-400 bg-slate-800/40' : 'text-white bg-slate-800'}">
              ${escapeHtml(n.text)}
              <div class="text-[10px] text-gray-500 mt-0.5">${new Date(n.at).toLocaleString('ru-RU')}</div>
            </div>`).join('')
            : '<p class="text-xs text-gray-600">Пока тихо. Сюда придут уведомления о новых сезонах и сериях сериалов, а также новых частях просмотренных фильмов.</p>'}
        </div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#notif-close').addEventListener('click', () => ov.remove());
    ov.querySelector('#notif-read').addEventListener('click', () => {
      markNotificationsRead();
      paintNotifBadge();
      ov.remove();
    });
    document.body.appendChild(ov);
  });
  paintNotifBadge();

  // Липкие фильтры: отступ сверху = высота шапки (меняется с размером окна)
  const filtersBar = feedEl('feed-filters');
  const feedHeader = app.querySelector('.sticky.top-0');
  const setFiltersTop = () => {
    if (filtersBar && feedHeader) filtersBar.style.top = `${feedHeader.offsetHeight}px`;
  };
  setFiltersTop();
  filtersResizeHandler = () => {
    setFiltersTop();
    if (feedEl('trends-grid')) renderTrendsGrid(currentUser);
  };
  window.addEventListener('resize', filtersResizeHandler);

  // Очередь офлайн-оценок: баннер, ручная отправка
  paintPending();
  feedEl('pending-flush').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const sent = await flushPendingRatings(currentUser.id).catch(() => 0);
    btn.disabled = false;
    if (sent) showToast(`Отправлено отложенных оценок: ${sent}`, 'success');
    paintPending();
    loadRatings(currentUser, activeFilter);
  });

  // Сеть появилась: отложенные оценки улетают сами
  onlineFlushHandler = async () => {
    const sent = await flushPendingRatings(currentUser.id).catch(() => 0);
    if (sent) showToast(`Отложенные оценки отправлены в базу: ${sent}`, 'success');
    paintPending();
    if (feedEl('ratings-list')) {
      loadRatings(currentUser, activeFilter);
      recsCache.dbAt = 0;
      loadRecs(currentUser);
    }
  };
  window.addEventListener('online', onlineFlushHandler);

  // Каталог: полноценный просмотр с жанрами и фильтрами
  feedEl('catalog-btn').addEventListener('click', () => {
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
    if (feedEl('ratings-list')) {
      loadRatings(currentUser, activeFilter);
      recsCache.dbAt = 0; // событие из базы — обновляем ряды без троттла
      loadRecs(currentUser);
    }
  }, 400);
}

async function loadRatings(currentUser, filter = 'all') {
  const listEl = feedEl('ratings-list');
  const noteEl = feedEl('feed-note');
  if (!listEl) return;

  // Примечание для режима «хочу посмотреть» (показываем всю компанию)
  if (noteEl) noteEl.classList.toggle('hidden', filter !== 'watchlist');

  let data;
  let offlineCopy = false;

  if (filter === 'watchlist') {
    const { data: watchlist, error } = await feedRequest(supabase
      .from('watchlist')
      .select(`*, titles!inner(*), profiles!inner(*)`)
      .order('created_at', { ascending: false }));

    if (error) {
      const cached = readFeedCache(filter);
      if (!cached) {
        listEl.innerHTML = `<div class="text-center py-12 text-red-400">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
        return;
      }
      data = cached;
      offlineCopy = true;
    } else {
      data = watchlist;
      writeFeedCache(filter, watchlist);
    }
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

    const { data: ratings, error } = await feedRequest(query);

    if (error) {
      const cached = readFeedCache(filter);
      if (!cached) {
        listEl.innerHTML = `<div class="text-center py-12 text-red-400">Ошибка загрузки: ${escapeHtml(error.message)}</div>`;
        return;
      }
      data = cached;
      offlineCopy = true;
    } else {
      data = ratings;
      writeFeedCache(filter, ratings);
    }
  }

  if (filter !== 'watchlist') {
    if (localStorage.getItem('gulrating:merge_title_ratings') === '1') data = groupRatingsByTitle(data);
    data = applySort(data);
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
      const focusBtn = feedEl('focus-search-btn');
      if (focusBtn) focusBtn.addEventListener('click', () => feedEl('search-input').focus());
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
    // Офлайн-кэш: показанную карточку можно будет открыть и оценить без сети
    primeTitleCache(title.media_type, title.id, title);

    const year = releaseYear(title.release_date);
    const ratingColor = item.rating >= 8 ? 'bg-green-600' : item.rating >= 5 ? 'bg-yellow-600' : 'bg-red-600';
    const groupRows = item.groupedRatings || [];
    const visibleGroupRows = groupRows.slice(0, 4);
    const hiddenGroupCount = Math.max(0, groupRows.length - visibleGroupRows.length);

    return `
      <div class="title-card bg-card rounded-2xl overflow-hidden hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}">
        <div class="p-4 flex gap-4">
          <div class="feed-card-poster flex-shrink-0">
            ${posterImg(title.poster_path, title.title, 'w-full aspect-[2/3] rounded-lg')}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h3 class="font-semibold text-lg leading-tight">${escapeHtml(title.title)}</h3>
                <p class="text-sm text-gray-400">${year ? escapeHtml(year) + ' • ' : ''}${title.media_type === 'movie' ? 'фильм' : 'сериал'}</p>
              </div>
              ${!isWatchlistView ? (item.groupedRatings ? `
                <div class="group-average-badge ${ratingColor} flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 text-white text-center shrink-0">
                  <span class="text-[10px] font-semibold uppercase tracking-wide opacity-80">средняя</span>
                  <strong class="text-xl leading-tight">${escapeHtml(formatRating(item.rating))}</strong>
                  <span class="text-[11px] opacity-80">${groupRows.length} оценок</span>
                </div>
              ` : `
                <div class="${ratingColor} px-2 py-1 rounded-lg text-white font-bold text-lg min-w-[44px] text-center">
                  ${escapeHtml(formatRating(item.rating))}
                </div>
              `) : `
                <div class="px-2 py-1 rounded-lg bg-slate-700 text-yellow-400 font-medium text-sm">
                  Хочу посмотреть
                </div>
              `}
            </div>
            
            ${item.groupedRatings ? `
              <div class="grouped-ratings-list mt-2 grid grid-cols-1 gap-1" aria-label="Оценки участников компании">
                ${visibleGroupRows.map((r, index) => {
                  const score = Number(r.rating || 0);
                  const scoreColor = score >= 8 ? 'text-green-300' : score >= 5 ? 'text-yellow-300' : 'text-red-300';
                  return `<div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-slate-900/40 px-2.5 py-1.5">
                    <img src="${escapeHtml(safeAvatarUrl(r.profiles?.avatar_url, r.profiles?.username))}" alt="" class="h-6 w-6 flex-shrink-0 rounded-full bg-slate-700 object-cover">
                    <span class="max-w-[160px] truncate text-xs font-medium text-gray-200">${escapeHtml(r.profiles?.username || 'Участник')}</span>
                    <b class="flex-shrink-0 text-xs ${scoreColor}">${escapeHtml(formatRating(score))}</b>
                    ${r.comment && index < 2 ? `<span class="basis-full pl-8 line-clamp-2 whitespace-normal break-words text-xs leading-relaxed text-gray-400" title="${escapeHtml(r.comment)}">${escapeHtml(r.comment)}</span>` : ''}
                  </div>`;
                }).join('')}
                ${hiddenGroupCount ? `<span class="pl-2 text-[10px] text-gray-500">и ещё ${hiddenGroupCount} оценок</span>` : ''}
              </div>
            ` : `
              <div class="mt-2 flex items-center gap-2">
                <img src="${escapeHtml(safeAvatarUrl(user.avatar_url, user.username))}" alt="" class="w-6 h-6 rounded-full bg-slate-700">
                <span class="text-sm text-gray-300">${escapeHtml(user.username)}</span>
                <span class="text-xs text-gray-500">${formatDistanceToNow(new Date(item.created_at))}</span>
              </div>
              ${!isWatchlistView && item.comment ? `<p class="mt-2 text-gray-300 text-sm line-clamp-2">${escapeHtml(item.comment)}</p>` : ''}
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (offlineCopy) {
    listEl.insertAdjacentHTML('afterbegin', `
      <div class="text-xs bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2 text-gray-400">
        Офлайн: показана сохранённая копия ленты. Новые оценки сохраняются на устройстве и отправятся при появлении сети.
      </div>`);
  }
  paintPending();

  // Обработчик клика по карточке тайтла
  feedAll('.title-card').forEach(card => {
    card.addEventListener('click', () => {
      const titleId = card.dataset.titleId;
      const mediaType = card.dataset.mediaType;
      openRatingModal(titleId, mediaType, currentUser, () => {
        loadRatings(currentUser, activeFilter);
      });
    });
  });
}

// Состав и порядок ленты редактируются только в настройках профиля.
const FEED_ORDER_KEY = 'gulrating:feed_order';
const FEED_VISIBLE_KEY = 'gulrating:feed_visible';
const FEED_ORDER_DEFAULT = ['trends', 'recs', 'feed'];
export const FEED_SECTIONS = [
  { id: 'trends', label: 'Тренды' },
  { id: 'recs', label: 'Подборки по вкусам компании' },
  { id: 'feed', label: 'Оценки' }
];

export function getFeedOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEED_ORDER_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length === FEED_ORDER_DEFAULT.length
      && FEED_ORDER_DEFAULT.every(id => parsed.includes(id))) return parsed;
  } catch (e) { /* повреждено */ }
  return [...FEED_ORDER_DEFAULT];
}

export function saveFeedOrder(order) {
  const normalized = [...new Set((Array.isArray(order) ? order : []).filter(id => FEED_ORDER_DEFAULT.includes(id)))];
  for (const id of FEED_ORDER_DEFAULT) if (!normalized.includes(id)) normalized.push(id);
  localStorage.setItem(FEED_ORDER_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getVisibleFeedSections() {
  try {
    const raw = localStorage.getItem(FEED_VISIBLE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const visible = FEED_ORDER_DEFAULT.filter(id => parsed.includes(id));
        return visible.length ? visible : ['feed'];
      }
    }
  } catch (e) { /* повреждено */ }
  return localStorage.getItem('gulrating:show_recs') === '0' ? ['feed'] : [...FEED_ORDER_DEFAULT];
}

export function saveVisibleFeedSections(sections) {
  const visible = FEED_ORDER_DEFAULT.filter(id => Array.isArray(sections) && sections.includes(id));
  const result = visible.length ? visible : ['feed'];
  localStorage.setItem(FEED_VISIBLE_KEY, JSON.stringify(result));
  // Поддерживаем старую настройку для уже установленных версий приложения.
  localStorage.setItem('gulrating:show_recs', result.some(id => id === 'trends' || id === 'recs') ? '1' : '0');
  return result;
}

function applyFeedOrder() {
  const wrap = feedEl('blocks-wrap');
  if (!wrap) return;
  const visible = new Set(getVisibleFeedSections());
  for (const id of getFeedOrder()) {
    const el = feedEl('blk-' + id);
    if (!el) continue;
    el.classList.toggle('hidden', !visible.has(id));
    wrap.appendChild(el);
  }
}

// Баннер очереди отложенных оценок
function paintPending() {
  const banner = feedEl('pending-banner');
  if (!banner) return;
  const pending = getPendingRatings();
  banner.classList.toggle('hidden', pending.length === 0);
  if (!pending.length) return;
  const textEl = feedEl('pending-text');
  if (textEl) textEl.textContent = `📴 Отложенных оценок: ${pending.length} — отправятся в базу при появлении сети`;
}

// Объединяем несколько пользовательских оценок одного тайтла в одну карточку.
function groupRatingsByTitle(list) {
  const groups = new Map();
  for (const row of list || []) {
    if (!row || !row.titles) continue;
    const key = `${row.titles.media_type}:${row.title_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(rows => {
    const latest = rows.reduce((a, b) => new Date(b.created_at) > new Date(a.created_at) ? b : a, rows[0]);
    const average = rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / rows.length;
    return { ...latest, rating: average, groupedRatings: rows };
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
  feedAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSort = btn.dataset.sort;
      saveSort(activeSort);
      feedAll('.sort-btn').forEach(b => {
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
  // Блоки трендов и подборок живут в общем контейнере порядка секций
  const section = feedEl('blocks-wrap');
  if (!section) return;
  section.querySelectorAll('#blk-trends, #blk-recs').forEach(n => n.remove());
  const visibleSections = getVisibleFeedSections();
  const showTrends = visibleSections.includes('trends');
  const showRecs = visibleSections.includes('recs');
  if (!showTrends && !showRecs) return;

  section.insertAdjacentHTML('afterbegin', `
    <div id="blk-trends" class="${showTrends ? 'space-y-3' : 'hidden'}">
    <div id="recs-trends">
      <div class="flex items-center gap-2 mb-3 overflow-x-auto scrollbar-hide">
        <h3 class="font-semibold mr-1">Тренды</h3>
        ${TREND_TABS.map(t => `<button class="trend-tab px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${t.key === trendsActive ? 'bg-primary text-white' : 'bg-card hover:bg-slate-700 text-gray-300'}" data-key="${t.key}">${t.label}</button>`).join('')}
      </div>
      <div id="trends-grid" class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 sm:gap-3"></div>
    </div>
    </div>
    <div id="blk-recs" class="${showRecs ? 'space-y-4' : 'hidden'}">
      <h3 class="font-semibold">Подборки по вкусам компании</h3>
      ${recRowSkeleton('recs-friends', 'Друзья оценили высоко')}
      ${recRowSkeleton('recs-want', 'Друзья хотят посмотреть')}
      ${recRowSkeleton('recs-personal', 'Похоже на то, что вам понравилось')}
    </div>
  `);
  applyFeedOrder();

  section.querySelectorAll('.trend-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (trendsActive === btn.dataset.key) return;
      trendsActive = btn.dataset.key;
      if (recsCache.trends[trendsActive]) {
        renderTrendsGrid(currentUser);
      } else {
        paintTrendsSkeleton();
        refreshTrends(currentUser);
      }
    });
  });
  if (!section.dataset.bound) {
    section.dataset.bound = '1';
    section.addEventListener('click', (e) => {
      const card = e.target.closest('.rec-card');
      if (!card) return;
      openRatingModal(card.dataset.id, card.dataset.type, currentUser, () => {
        loadRatings(currentUser, activeFilter);
        recsCache.dbAt = 0;
        loadRecs(currentUser);
      });
    });
  }

  // 1) Мгновенная отрисовка из кэша: повторный заход не показывает скелетоны
  if (showTrends) {
    if (recsCache.trends[trendsActive]) renderTrendsGrid(currentUser);
    else paintTrendsSkeleton();
  }
  if (showRecs && recsCache.db) {
    fillRecRow(section, 'recs-friends', 'Друзья оценили высоко', recsCache.db.friendsSub, recsCache.db.friendsHigh, 'bg-pink-600', FRIENDS_EMPTY_HINT);
    fillRecRow(section, 'recs-want', 'Друзья хотят посмотреть', recsCache.db.wantSub, recsCache.db.wantItems, 'bg-secondary', WANT_EMPTY_HINT);
    fillRecRow(section, 'recs-personal', 'Похоже на то, что вам понравилось', recsCache.personalSub || '', recsCache.personal || [], 'bg-primary', PERSONAL_EMPTY_HINT);
  }

  // 2) Фоновое тихое обновление только включённых секций.
  if (showTrends) refreshTrends(currentUser);
  if (showRecs) refreshDbRecs(currentUser, section);
}

function trendColumnCount(grid) {
  try {
    const count = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    return count || 4;
  } catch (e) {
    return 4;
  }
}

function renderTrendsGrid(currentUser) {
  const grid = feedEl('trends-grid');
  if (!grid) return;
  let items = recsCache.trends[trendsActive];
  let offlineTrends = false;
  if (!items) {
    // Офлайн: вместо трендов — популярные тайтлы из базы на устройстве
    const local = getPopularOffline(20);
    if (local.length) {
      items = local;
      offlineTrends = true;
    }
  }
  feedAll('.trend-tab').forEach(btn => {
    const active = btn.dataset.key === trendsActive;
    btn.classList.toggle('bg-primary', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('bg-card', !active);
    btn.classList.toggle('hover:bg-slate-700', !active);
    btn.classList.toggle('text-gray-300', !active);
  });
  if (!items) {
    grid.innerHTML = '<p class="col-span-full text-sm text-gray-500 py-6">Тренды недоступны — проверьте соединение с TMDb.</p>';
    return;
  }
  if (!items.length) {
    grid.innerHTML = '<p class="col-span-full text-sm text-gray-500 py-6">В этой выборке пусто.</p>';
    return;
  }
  // Оставляем только полные ряды карточек: число столбцов адаптируется к экрану.
  const columns = trendColumnCount(grid);
  const completeCount = Math.floor(items.length / columns) * columns;
  if (completeCount > 0) items = items.slice(0, completeCount);
  grid.innerHTML = (offlineTrends
    ? `<p class="col-span-full text-xs text-gray-500 pb-1">📴 Офлайн: популярные тайтлы из базы на устройстве (${getOfflineCatalogStats().count})</p>`
    : '') + items.map(item => {
    const year = releaseYear(item.release_date);
    primeTitleCache(item.media_type, item.id, item);
    return `
      <div class="rec-card cursor-pointer group" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
        <div class="relative group-hover:opacity-80 transition-opacity">
          ${posterImg(item.poster_path, item.title, 'w-full aspect-[2/3] rounded-lg shadow-lg')}
          ${item.vote_average
            ? `<span class="absolute top-1 right-1 bg-black/700 text-cyan-300 text-[11px] font-bold px-1.5 py-0.5 rounded-md" title="Оценок на TMDb: ${item.vote_count || 0}">${Number(item.vote_average).toFixed(1)}</span>`
            : '<span class="absolute top-1 right-1 bg-black/700 text-gray-400 text-[11px] font-medium px-1.5 py-0.5 rounded-md">нет оценок</span>'}
        </div>
        <div class="mt-1.5 text-xs font-medium truncate">${escapeHtml(item.title)}</div>
        <div class="text-[11px] text-gray-500">${year ? escapeHtml(year) + ' • ' : ''}${item.media_type === 'movie' ? 'фильм' : 'сериал'}</div>
      </div>
    `;
  }).join('');
}

function paintTrendsSkeleton() {
  const grid = feedEl('trends-grid');
  if (!grid) return;
  const columns = trendColumnCount(grid);
  const count = Math.max(columns, Math.floor(20 / columns) * columns);
  grid.innerHTML = Array.from({ length: count }).map(() => `
    <div class="animate-pulse"><div class="w-full aspect-[2/3] bg-slate-700 rounded-lg"></div><div class="h-3 bg-slate-700 rounded mt-1.5"></div></div>
  `).join('');
}

async function refreshTrends(currentUser) {
  await Promise.all(TREND_TABS.map(async (t) => {
    if (recsCache.trends[t.key]) return;
    try {
      recsCache.trends[t.key] = await getTrending({ mediaType: t.mediaType, window: t.window, limit: 20 });
    } catch (e) {
      recsCache.trends[t.key] = null;
    }
  }));
  renderTrendsGrid(currentUser);
}

// Пересчёт рядов по базе компании: не чаще раза в минуту, результат — в кэш
async function refreshDbRecs(currentUser, section) {
  const now = Date.now();
  if (recsCache.dbAt && now - recsCache.dbAt < 60000) return;
  recsCache.dbAt = now;
  try {
    const [{ data, error }, { data: wl }] = await Promise.all([
      supabase.from('ratings').select('user_id, rating, titles(*)'),
      supabase.from('watchlist').select('user_id, titles(*)')
    ]);
    if (error) throw error;

    const friendsThreshold = parseFloat(localStorage.getItem('gulrating:friends_threshold') ?? '7.5');
    const wantMin = parseInt(localStorage.getItem('gulrating:want_min') || '1', 10) || 1;
    const myMin = parseFloat(localStorage.getItem('gulrating:my_min') ?? '8');

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

    const friendsHigh = [...agg.values()]
      .map(cur => ({ ...cur.title, friends_avg: cur.sum / cur.count, friends_count: cur.count }))
      .filter(t => t.friends_avg >= friendsThreshold && !mine.has(String(t.id)))
      .sort((a, b) => b.friends_avg - a.friends_avg || b.friends_count - a.friends_count)
      .slice(0, 12)
      .map(t => ({ id: t.id, media_type: t.media_type, title: t.title, release_date: t.release_date, poster_path: t.poster_path, badge: t.friends_avg.toFixed(1) }));

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

    recsCache.db = {
      friendsHigh,
      wantItems,
      friendsSub: `средняя ≥ ${friendsThreshold.toFixed(1)} · вы ещё не оценили`,
      wantSub: `в списках у ${wantMin}+ друзей · на постере число друзей`
    };
    fillRecRow(section, 'recs-friends', 'Друзья оценили высоко', recsCache.db.friendsSub, friendsHigh, 'bg-pink-600', FRIENDS_EMPTY_HINT);
    fillRecRow(section, 'recs-want', 'Друзья хотят посмотреть', recsCache.db.wantSub, wantItems, 'bg-secondary', WANT_EMPTY_HINT);

    if (myTop) {
      const key = `${myTop.media_type}:${myTop.id}`;
      if (recsCache.personalKey !== key || !recsCache.personal) {
        const recs = await getRecommendations(myTop.id, myTop.media_type, 14);
        recsCache.personal = recs.filter(t => !mine.has(String(t.id))).slice(0, 12);
        recsCache.personalKey = key;
      }
      recsCache.personalSub = `потому что вы оценили «${myTopTitle(data, currentUser, myTop) || ''}» на ${myMin.toFixed(1)}+`;
      fillRecRow(section, 'recs-personal', 'Похоже на то, что вам понравилось', recsCache.personalSub, recsCache.personal, 'bg-primary', PERSONAL_EMPTY_HINT);
    } else {
      recsCache.personal = null;
      recsCache.personalKey = '';
      recsCache.personalSub = '';
      fillRecRow(section, 'recs-personal', 'Похоже на то, что вам понравилось', '', [], 'bg-primary', PERSONAL_EMPTY_HINT);
    }
  } catch (e) {
    // сеть моргнула: кэшированные ряды не трогаем
    if (!recsCache.db) {
      dropRecRow(section, 'recs-friends');
      dropRecRow(section, 'recs-want');
      dropRecRow(section, 'recs-personal');
    }
  }
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
        ${Array.from({ length: 6 }).map(() => `<div class="flex-shrink-0 w-24 animate-pulse"><div class="w-24 aspect-[2/3] bg-slate-700 rounded-lg"></div><div class="h-3 bg-slate-700 rounded mt-2"></div></div>`).join('')}
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
        primeTitleCache(item.media_type, item.id, item);
        return `
          <div class="rec-card flex-shrink-0 w-24 cursor-pointer group relative" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
            <div class="group-hover:opacity-80 transition-opacity">
              ${posterImg(item.poster_path, item.title, 'w-24 aspect-[2/3] rounded-lg shadow-lg')}
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
  const searchInput = feedEl('search-input');
  const resultsContainer = feedEl('search-results');
  let searchTimeout;

  // При фокусе на пустом поле показываем историю поиска
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length < 2) showHistoryDropdown();
  });

  // История: недавние запросы и недавно открытые тайтлы (хранятся локально)
  function showHistoryDropdown() {
    const queries = getSearchQueries();
    const titles = getRecentTitles();
    // История тоже кэшируется: недавние тайтлы можно открыть и оценить офлайн
    titles.forEach(t => primeTitleCache(t.media_type, t.id, { ...t, release_date: t.year ? `${t.year}-01-01` : null }));
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
          <div class="flex gap-2 overflow-x-auto pb-1">
            ${titles.map(t => `
              <div class="history-title cursor-pointer group flex-shrink-0" data-id="${escapeHtml(t.id)}" data-type="${escapeHtml(t.media_type)}">
                ${posterImg(t.poster_path, t.title, 'w-full aspect-[2/3] rounded-md')}
                <div class="text-[10px] leading-tight line-clamp-2 mt-1 group-hover:text-white">${escapeHtml(t.title)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
    resultsContainer.classList.remove('hidden');

    feedEl('clear-history-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearHistory();
      resultsContainer.classList.add('hidden');
      showToast('История очищена', 'success');
    });
    feedAll('.history-query').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.query;
        searchInput.dispatchEvent(new Event('input'));
        searchInput.focus();
      });
    });
    feedAll('.history-title').forEach(el => {
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
      let offlineNote = null;
      try {
        if (navigator.onLine === false) throw new Error('Нет сети.');
        results = await searchTitles(query);
      } catch (err) {
        // Без сети (или TMDb недоступен) ищем в текстовой базе на устройстве
        const stats = getOfflineCatalogStats();
        let local = searchOfflineCatalog(query);
        let fullUsed = false;
        if (isFullCatalogInstalled()) {
          resultsContainer.innerHTML = '<div class="p-4 text-gray-500 text-center text-sm">Ищем по полной базе на устройстве…</div>';
          resultsContainer.classList.remove('hidden');
          const full = await searchFullCatalog(query, 20, local);
          if (full.length) {
            local = [...local, ...full];
            fullUsed = true;
          }
        }
        if (local.length) {
          results = local;
          offlineNote = `Офлайн-поиск по базе на устройстве (${stats.count} тайтлов${fullUsed ? ' + полная база' : ''})`;
        } else if (stats.count) {
          errorText = `${err.message} В базе на устройстве (${stats.count} тайтлов) ничего не нашлось.`;
        } else {
          errorText = `${err.message} База фильмов для офлайна ещё не скачана — она загружается автоматически, когда есть сеть.`;
        }
      }

      if (errorText) {
        resultsContainer.innerHTML = `<div class="p-4 text-red-400 text-center text-sm">${escapeHtml(errorText)}</div>`;
      } else if (results.length === 0) {
        resultsContainer.innerHTML = `<div class="p-4 text-gray-500 text-center">Ничего не найдено</div>`;
      } else {
        resultsContainer.innerHTML = (offlineNote
          ? `<div class="px-3 pt-2 pb-1 text-xs text-gray-500">📴 ${escapeHtml(offlineNote)}</div>`
          : '') + results.map(item => {
          const year = releaseYear(item.release_date);
          primeTitleCache(item.media_type, item.id, item);
          return `
            <div class="search-result-item p-3 hover:bg-slate-700 cursor-pointer flex gap-3 transition-colors" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.media_type)}">
              <div class="flex-shrink-0 w-14">
                ${posterImg(item.poster_path, item.title, 'w-14 aspect-[2/3] rounded')}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">${escapeHtml(item.title)}</div>
                <div class="text-sm text-gray-400">${year ? escapeHtml(year) + ' • ' : ''}${item.media_type === 'movie' ? 'фильм' : 'сериал'}</div>
              </div>
            </div>
          `;
        }).join('');

        // Обработчик клика по результату поиска
        feedAll('.search-result-item').forEach(item => {
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

  // Скрываем результаты при клике вне поиска и по Escape.
  // Обработчик document-уровня снимаем при cleanupFeed, иначе он копился
  // при каждом возврате в ленту (утечка слушателей)
  if (searchDocClickHandler) document.removeEventListener('click', searchDocClickHandler);
  searchDocClickHandler = (e) => {
    if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
      resultsContainer.classList.add('hidden');
    }
  };
  document.addEventListener('click', searchDocClickHandler);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') resultsContainer.classList.add('hidden');
    // Enter открывает первый результат — быстрее на телефоне
    if (e.key === 'Enter') {
      const first = resultsContainer.querySelector('.search-result-item');
      if (first) first.click();
    }
  });

  // Обработчики фильтров
  feedAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      feedAll('.filter-btn').forEach(b => {
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
  feedAll('.nav-btn').forEach(btn => {
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
