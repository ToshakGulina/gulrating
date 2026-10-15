import { supabase } from '../lib/supabase.js';
import { CONFIG } from '../config.js';
import { formatDistanceToNow } from '../lib/date.js';
import { searchTitles } from '../lib/tmdb.js';
import { openRatingModal } from './RatingModal.js';

export async function renderFeed(app, currentUser) {
  app.innerHTML = `
    <div class="max-w-4xl mx-auto pb-20">
      <div class="sticky top-0 z-20 bg-dark/80 backdrop-blur-card py-4 px-4 border-b border-slate-800">
        <h1 class="text-2xl font-bold mb-3">Лента оценок</h1>
        <div class="relative">
          <input type="text" id="search-input" placeholder="Поиск фильма или сериала..." 
            class="w-full pl-10 pr-4 py-3 bg-card border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
          <svg class="absolute left-3 top-3.5 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
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

        <div id="ratings-list" class="space-y-4">
          <div class="text-center py-12 text-gray-500">Загружаем оценки...</div>
        </div>
      </div>

      <!-- Нижняя навигация -->
      <nav class="fixed bottom-0 left-0 right-0 bg-dark/90 backdrop-blur-card border-t border-slate-800 z-10">
        <div class="max-w-4xl mx-auto flex">
          <button class="nav-btn flex-1 py-3 flex flex-col items-center text-primary" data-page="feed">
            <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
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

  // Загружаем оценки
  await loadRatings(currentUser, 'all');
  
  // Инициализируем поиск
  initSearch(currentUser);
  
  // Инициализируем навигацию
  initNav(currentUser);

  // Подписываемся на реалтайм обновления
  supabase.channel('public:ratings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, () => {
      const activeFilter = document.querySelector('.filter-btn.bg-primary').dataset.filter;
      loadRatings(currentUser, activeFilter);
    })
    .subscribe();
}

async function loadRatings(currentUser, filter = 'all') {
  let data;
  
  if (filter === 'watchlist') {
    const { data: watchlist, error } = await supabase
      .from('watchlist')
      .select(`
        *,
        titles:title_id (*),
        profiles:user_id (*)
      `)
      .order('created_at', { ascending: false });
    
    if (error) {
      document.getElementById('ratings-list').innerHTML = `<div class="text-center py-12 text-red-400">Ошибка загрузки</div>`;
      return;
    }
    data = watchlist;
  } else {
    let query = supabase
      .from('ratings')
      .select(`
        *,
        profiles:user_id (*),
        titles:title_id (*)
      `)
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
      document.getElementById('ratings-list').innerHTML = `<div class="text-center py-12 text-red-400">Ошибка загрузки</div>`;
      return;
    }
    data = ratings;
  }

  if (!data || data.length === 0) {
    let emptyText = 'Пока нет оценок. Найдите фильм через поиск и поставьте первую оценку!';
    if (filter === 'watchlist') emptyText = 'В списке "Хочу посмотреть" пока ничего нет. Найдите фильм и добавьте его.';
    if (filter === 'mine') emptyText = 'Вы еще не поставили ни одной оценки.';
    
    document.getElementById('ratings-list').innerHTML = `
      <div class="text-center py-12 text-gray-500">
        <div class="text-4xl mb-3">🎞️</div>
        <p>${emptyText}</p>
      </div>
    `;
    return;
  }

  const isWatchlistView = filter === 'watchlist';

  document.getElementById('ratings-list').innerHTML = data.map(item => {
    const title = item.titles;
    const user = item.profiles;
    const releaseYear = title.release_date ? new Date(title.release_date).getFullYear() : '';
    const ratingColor = item.rating >= 8 ? 'bg-green-600' : item.rating >= 5 ? 'bg-yellow-600' : 'bg-red-600';
    
    return `
      <div class="title-card bg-card rounded-2xl overflow-hidden hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${title.id}" data-media-type="${title.media_type}">
        <div class="p-4 flex gap-4">
          <div class="flex-shrink-0 w-20">
            ${title.poster_path 
              ? `<img src="${CONFIG.TMDB_IMG_BASE}${title.poster_path}" alt="${title.title}" class="w-full aspect-[2/3] rounded-lg object-cover">`
              : `<div class="w-full aspect-[2/3] rounded-lg bg-slate-700 flex items-center justify-center text-gray-500">🎬</div>`
            }
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <div>
                <h3 class="font-semibold text-lg leading-tight">${title.title}</h3>
                <p class="text-sm text-gray-400">${releaseYear} • ${title.media_type === 'movie' ? 'фильм' : 'сериал'}</p>
              </div>
              ${!isWatchlistView ? `
                <div class="${ratingColor} px-2 py-1 rounded-lg text-white font-bold text-lg min-w-[44px] text-center">
                  ${item.rating}
                </div>
              ` : `
                <div class="px-2 py-1 rounded-lg bg-slate-700 text-yellow-400 font-medium text-sm">
                  Хочу посмотреть
                </div>
              `}
            </div>
            
            <div class="mt-2 flex items-center gap-2">
              <img src="${user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}" alt="${user.username}" class="w-6 h-6 rounded-full bg-slate-700">
              <span class="text-sm text-gray-300">${user.username}</span>
              <span class="text-xs text-gray-500">${formatDistanceToNow(new Date(item.created_at))}</span>
            </div>
            
            ${!isWatchlistView && item.comment ? `<p class="mt-2 text-gray-300 text-sm line-clamp-2">${item.comment}</p>` : ''}
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
        const activeFilter = document.querySelector('.filter-btn.bg-primary').dataset.filter;
        loadRatings(currentUser, activeFilter);
      });
    });
  });
}

function initSearch(currentUser) {
  const searchInput = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  let searchTimeout;

  searchInput.addEventListener('input', async (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    
    if (query.length < 2) {
      resultsContainer.classList.add('hidden');
      return;
    }

    searchTimeout = setTimeout(async () => {
      const results = await searchTitles(query);
      
      if (results.length === 0) {
        resultsContainer.innerHTML = `<div class="p-4 text-gray-500 text-center">Ничего не найдено</div>`;
      } else {
        resultsContainer.innerHTML = results.map(item => {
          const year = item.release_date ? new Date(item.release_date).getFullYear() : '';
          return `
            <div class="search-result-item p-3 hover:bg-slate-700 cursor-pointer flex gap-3 transition-colors" data-id="${item.id}" data-type="${item.media_type}">
              <div class="flex-shrink-0 w-10">
                ${item.poster_path 
                  ? `<img src="${CONFIG.TMDB_IMG_BASE}${item.poster_path}" class="w-full aspect-[2/3] rounded object-cover">`
                  : `<div class="w-full aspect-[2/3] rounded bg-slate-700 flex items-center justify-center text-xs">🎬</div>`
                }
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">${item.title}</div>
                <div class="text-sm text-gray-400">${year} • ${item.media_type === 'movie' ? 'фильм' : 'сериал'}</div>
              </div>
            </div>
          `;
        }).join('');

        // Обработчик клика по результату поиска
        document.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const titleId = item.dataset.id;
            const mediaType = item.dataset.type;
            
            resultsContainer.classList.add('hidden');
            searchInput.value = '';
            
            openRatingModal(titleId, mediaType, currentUser, () => {
              const activeFilter = document.querySelector('.filter-btn.bg-primary').dataset.filter;
              loadRatings(currentUser, activeFilter);
            });
          });
        });
      }
      
      resultsContainer.classList.remove('hidden');
    }, 300);
  });

  // Скрываем результаты при клике вне поиска
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
      resultsContainer.classList.add('hidden');
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
      loadRatings(currentUser, btn.dataset.filter);
    });
  });
}

function initNav(currentUser) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.remove('text-primary');
        b.classList.add('text-gray-400');
      });
      btn.classList.remove('text-gray-400');
      btn.classList.add('text-primary');

      if (btn.dataset.page === 'profile') {
        const { renderProfilePage } = await import('./Profile.js');
        renderProfilePage(document.getElementById('app'), currentUser);
      } else if (btn.dataset.page === 'feed') {
        renderFeed(document.getElementById('app'), currentUser);
      }
    });
  });
}
