import { supabase } from '../lib/supabase.js';
import { APP_BUILD } from '../config.js';
import { formatDistanceToNow } from '../lib/date.js';
import { openRatingModal } from './RatingModal.js';
import { cleanupFeed } from './Feed.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';

// Акценты интерфейса: RGB-тройки для CSS-переменной --p-rgb (index.html)
const ACCENTS = [
  { name: 'Индиго', rgb: '99 102 241' },
  { name: 'Малиновый', rgb: '225 29 72' },
  { name: 'Изумруд', rgb: '16 185 129' },
  { name: 'Синий', rgb: '59 130 246' },
  { name: 'Оранжевый', rgb: '249 115 22' },
];

export async function renderProfilePage(app, currentUser) {
  cleanupFeed();

  // Загружаем статистику пользователя
  const [{ data: myRatings, count: ratingsCount }, { data: watchlist }, { data: profiles }] = await Promise.all([
    supabase.from('ratings').select('*, titles!inner(*)', { count: 'exact' }).eq('user_id', currentUser.id).order('created_at', { ascending: false }),
    supabase.from('watchlist').select('*, titles!inner(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('username', { ascending: true })
  ]);

  const myRatingsList = myRatings || [];
  const watchlistList = watchlist || [];
  const profileList = profiles || [];

  const averageRating = myRatingsList.length > 0
    ? (myRatingsList.reduce((sum, r) => sum + r.rating, 0) / myRatingsList.length).toFixed(1)
    : '—';

  const pendingUsers = profileList.filter(p => !p.is_approved);
  const approvedUsers = profileList.filter(p => p.is_approved);

  app.innerHTML = `
    <div class="max-w-4xl mx-auto pb-20">
      <div class="sticky top-0 z-20 bg-dark/80 backdrop-blur-card py-4 px-4 border-b border-slate-800">
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-bold">Профиль</h1>
          <button id="logout-btn" class="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg bg-card hover:bg-slate-700">Выйти</button>
        </div>
      </div>

      <div class="p-4">
        <!-- Карточка профиля -->
        <div class="bg-card rounded-2xl p-5 mb-6">
          <div class="flex items-center gap-4 mb-4">
            <img src="${escapeHtml(safeAvatarUrl(currentUser.profile.avatar_url, currentUser.profile.username))}" alt="" class="w-20 h-20 rounded-full bg-slate-700">
            <div>
              <h2 class="text-xl font-bold">${escapeHtml(currentUser.profile.username)}</h2>
              <p class="text-gray-400 text-sm">${escapeHtml(currentUser.email)}</p>
              ${currentUser.profile.is_admin ? '<span class="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full mt-1 inline-block">Администратор</span>' : ''}
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3 text-center">
            <div class="bg-slate-800 rounded-xl p-3">
              <div class="text-2xl font-bold">${ratingsCount ?? myRatingsList.length}</div>
              <div class="text-xs text-gray-400">Оценок</div>
            </div>
            <div class="bg-slate-800 rounded-xl p-3">
              <div class="text-2xl font-bold">${averageRating}</div>
              <div class="text-xs text-gray-400">Средняя</div>
            </div>
            <div class="bg-slate-800 rounded-xl p-3">
              <div class="text-2xl font-bold">${watchlistList.length}</div>
              <div class="text-xs text-gray-400">В планах</div>
            </div>
          </div>
        </div>

        <!-- Настройки: ник, аватар, поведение ленты -->
        <div class="bg-card rounded-2xl p-5 mb-6">
          <h3 class="font-semibold mb-4">Ник и аватар</h3>
          <div class="flex items-center gap-4 mb-4">
            <img id="avatar-preview" src="${escapeHtml(safeAvatarUrl(currentUser.profile.avatar_url, currentUser.profile.username))}" alt="" class="w-16 h-16 rounded-full bg-slate-700">
            <div class="flex flex-col items-start gap-2">
              <label class="text-sm cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg">
                Загрузить фото
                <input id="avatar-input" type="file" accept="image/*" class="hidden">
              </label>
              <button id="avatar-remove-btn" class="text-xs text-gray-400 hover:text-white">Убрать аватар</button>
            </div>
          </div>
          <div class="flex gap-2">
            <input id="nick-input" type="text" value="${escapeHtml(currentUser.profile.username)}" maxlength="40"
              class="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white" placeholder="Ник">
            <button id="nick-save-btn" class="px-4 py-2.5 bg-primary hover:bg-primary/90 rounded-xl text-sm font-medium">Сохранить</button>
          </div>

          <h3 class="font-semibold mt-6 mb-3">Лента</h3>
          <div class="space-y-3 text-sm">
            <label class="flex items-center justify-between gap-3">
              <span class="text-gray-300">Сортировка по умолчанию</span>
              <select id="sort-select" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white">
                <option value="new">Сначала новые</option>
                <option value="rating_desc">Сначала высокие оценки</option>
                <option value="rating_asc">Сначала низкие оценки</option>
              </select>
            </label>
            <label class="flex items-center justify-between gap-3">
              <span class="text-gray-300">Порог ряда «Друзья оценили высоко»</span>
              <select id="threshold-select" class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white">
                ${[6, 6.5, 7, 7.5, 8, 8.5, 9].map(v => `<option value="${v}">${v.toFixed(1)}</option>`).join('')}
              </select>
            </label>
            <label class="flex items-center justify-between gap-3">
              <span class="text-gray-300">Блок рекомендаций в ленте</span>
              <input id="recs-toggle" type="checkbox" class="w-4 h-4">
            </label>
            <div class="flex items-center justify-between gap-3">
              <span class="text-gray-300">Акцент интерфейса</span>
              <div id="accent-swatches" class="flex gap-2">
                ${ACCENTS.map(a => `<button class="accent-swatch w-6 h-6 rounded-full border-2" data-rgb="${a.rgb}" style="background: rgb(${a.rgb})" title="${a.name}" aria-label="${a.name}"></button>`).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Секция админа: управление пользователями -->
        ${currentUser.profile.is_admin ? `
          <div class="bg-card rounded-2xl p-4 mb-6">
            <h3 class="font-semibold mb-3">👥 Управление доступом (${profileList.length})</h3>
            
            ${pendingUsers.length > 0 ? `
              <p class="text-sm text-yellow-400 mb-2">Ожидают подтверждения доступа:</p>
              <div class="space-y-2 mb-4">
                ${pendingUsers.map(p => `
                  <div class="flex items-center justify-between p-2 bg-slate-800 rounded-lg">
                    <div class="flex items-center gap-2">
                      <img src="${escapeHtml(safeAvatarUrl(p.avatar_url, p.username))}" alt="" class="w-8 h-8 rounded-full bg-slate-700">
                      <div class="font-medium text-sm">${escapeHtml(p.username)}</div>
                    </div>
                    <button class="approve-user-btn px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm" data-user-id="${escapeHtml(p.id)}">Одобрить</button>
                  </div>
                `).join('')}
              </div>
            ` : '<p class="text-sm text-gray-400 mb-3">Нет новых заявок на доступ</p>'}
            
            <p class="text-sm font-medium mb-2">Участники:</p>
            <div class="space-y-2">
              ${approvedUsers.map(p => `
                <div class="flex items-center justify-between p-2 hover:bg-slate-800 rounded-lg">
                  <div class="flex items-center gap-2">
                    <img src="${escapeHtml(safeAvatarUrl(p.avatar_url, p.username))}" alt="" class="w-8 h-8 rounded-full bg-slate-700">
                    <div>
                      <div class="font-medium text-sm">${escapeHtml(p.username)}</div>
                      ${p.is_admin ? '<span class="text-xs text-primary">админ</span>' : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
            <button id="export-btn" class="w-full mt-4 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">💾 Экспортировать все данные в JSON (бэкап)</button>
            <p class="text-xs text-gray-500 mt-3">Просто разошлите друзьям ссылку на сайт. После того как они зарегистрируются по почте, они появятся в списке выше и вы сможете одобрить им доступ в один клик.</p>
          </div>
        ` : ''}

        <!-- Табы -->
        <div class="flex gap-2 mb-4 overflow-x-auto scrollbar-hide">
          <button class="tab-btn px-4 py-2 bg-primary text-white rounded-full text-sm font-medium whitespace-nowrap" data-tab="ratings">Мои оценки</button>
          <button class="tab-btn px-4 py-2 bg-card hover:bg-slate-700 rounded-full text-sm font-medium whitespace-nowrap" data-tab="watchlist">Хочу посмотреть</button>
        </div>

        <div id="profile-content" class="space-y-3">
          ${renderMyRatings(myRatingsList)}
        </div>

        <p class="text-[10px] text-gray-600 text-center mt-8">ГульРейтинг · сборка ${escapeHtml(APP_BUILD)}</p>
      </div>

      <!-- Нижняя навигация -->
      <nav class="fixed bottom-0 left-0 right-0 bg-dark/90 backdrop-blur-card border-t border-slate-800 z-10">
        <div class="max-w-4xl mx-auto flex">
          <button class="nav-btn flex-1 py-3 flex flex-col items-center text-gray-400 hover:text-white" data-page="feed">
            <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4m8 4V10a1 1 0 00-1-1h-2a1 1 0 00-1 1v4m3 1h3a1 1 0 001-1V10m-4 0l2-2m0 0l2 2"></path></svg>
            <span class="text-xs">Лента</span>
          </button>
          <button class="nav-btn flex-1 py-3 flex flex-col items-center text-primary" data-page="profile">
            <svg class="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            <span class="text-xs">Профиль</span>
          </button>
        </div>
      </nav>
    </div>
  `;

  // Обработчик выхода
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  // --- Настройки: аватар, ник, лента ---
  const avatarPreview = document.getElementById('avatar-preview');
  const avatarInput = document.getElementById('avatar-input');
  const nickInput = document.getElementById('nick-input');
  const sortSelect = document.getElementById('sort-select');
  const recsToggle = document.getElementById('recs-toggle');

  async function saveProfileFields(fields) {
    const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
    if (error) {
      const msg = (error.message || '');
      showToast(/duplicate|unique/i.test(msg) ? 'Такой ник уже занят' : 'Не удалось сохранить: ' + msg, 'error', 5000);
      return false;
    }
    Object.assign(currentUser.profile, fields);
    return true;
  }

  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files && avatarInput.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      showToast('Файл больше 8 МБ — возьмите картинку поменьше', 'error', 5000);
      avatarInput.value = '';
      return;
    }
    try {
      const dataUrl = await downscaleImage(file, 160);
      if (await saveProfileFields({ avatar_url: dataUrl })) {
        avatarPreview.src = dataUrl;
        showToast('Аватар обновлён', 'success');
      }
    } catch (e) {
      showToast('Не удалось прочитать картинку', 'error', 5000);
    }
    avatarInput.value = '';
  });

  document.getElementById('avatar-remove-btn').addEventListener('click', async () => {
    if (await saveProfileFields({ avatar_url: null })) {
      avatarPreview.src = safeAvatarUrl(null, currentUser.profile.username);
      showToast('Аватар убран', 'success');
    }
  });

  document.getElementById('nick-save-btn').addEventListener('click', async () => {
    const value = nickInput.value.trim();
    if (!value) {
      showToast('Ник не может быть пустым', 'error');
      return;
    }
    if (value === currentUser.profile.username) return;
    if (await saveProfileFields({ username: value })) {
      showToast('Ник сохранён', 'success');
      renderProfilePage(app, currentUser);
    }
  });

  sortSelect.value = localStorage.getItem('gulrating:feed_sort') || 'new';
  sortSelect.addEventListener('change', () => {
    localStorage.setItem('gulrating:feed_sort', sortSelect.value);
    showToast('Порядок ленты обновлён', 'success');
  });

  const thresholdSelect = document.getElementById('threshold-select');
  thresholdSelect.value = localStorage.getItem('gulrating:friends_threshold') || '7.5';
  thresholdSelect.addEventListener('change', () => {
    localStorage.setItem('gulrating:friends_threshold', thresholdSelect.value);
    showToast('Порог применится к рекомендациям в ленте', 'success');
  });

  recsToggle.checked = localStorage.getItem('gulrating:show_recs') !== '0';
  recsToggle.addEventListener('change', () => {
    localStorage.setItem('gulrating:show_recs', recsToggle.checked ? '1' : '0');
    showToast('В ленте обновится блок рекомендаций', 'success');
  });

  // Акцент: сохраняем RGB-тройку и сразу применяем к CSS-переменной
  const currentAccent = localStorage.getItem('gulrating:accent') || '99 102 241';
  document.querySelectorAll('.accent-swatch').forEach(sw => {
    sw.classList.toggle('border-white', sw.dataset.rgb === currentAccent);
    sw.classList.toggle('border-transparent', sw.dataset.rgb !== currentAccent);
    sw.addEventListener('click', () => {
      localStorage.setItem('gulrating:accent', sw.dataset.rgb);
      document.documentElement.style.setProperty('--p-rgb', sw.dataset.rgb);
      document.querySelectorAll('.accent-swatch').forEach(x => {
        x.classList.toggle('border-white', x === sw);
        x.classList.toggle('border-transparent', x !== sw);
      });
      showToast('Акцент применён', 'success');
    });
  });

  // Обработчики табов
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('bg-primary', 'text-white');
        b.classList.add('bg-card', 'hover:bg-slate-700');
      });
      btn.classList.remove('bg-card', 'hover:bg-slate-700');
      btn.classList.add('bg-primary', 'text-white');

      if (btn.dataset.tab === 'ratings') {
        document.getElementById('profile-content').innerHTML = renderMyRatings(myRatingsList);
      } else {
        document.getElementById('profile-content').innerHTML = renderWatchlist(watchlistList);
      }

      // Добавляем обработчики кликов по карточкам
      initTitleCards(currentUser);
    });
  });

  // Обработчики навигации
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.page === 'feed') {
        const { renderFeed } = await import('./Feed.js');
        renderFeed(document.getElementById('app'), currentUser);
      }
    });
  });

  // Инициализируем клики по карточкам
  initTitleCards(currentUser);

  // Обработчики одобрения пользователей для админа
  if (currentUser.profile.is_admin) {
    document.querySelectorAll('.approve-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        btn.disabled = true;
        btn.textContent = 'Одобряем...';

        const { error } = await supabase
          .from('profiles')
          .update({ is_approved: true })
          .eq('id', userId);

        if (error) {
          showToast('Не удалось одобрить: ' + error.message, 'error', 5000);
          btn.disabled = false;
          btn.textContent = 'Одобрить';
          return;
        }

        showToast('Доступ одобрен', 'success');
        // Перерисовываем профиль вместо полной перезагрузки страницы
        renderProfilePage(app, currentUser);
      });
    });

    // Экспорт данных
    document.getElementById('export-btn').addEventListener('click', async () => {
      try {
        const [{ data: titles }, { data: ratings }, { data: watchlistData }, { data: profilesData }] = await Promise.all([
          supabase.from('titles').select('*'),
          supabase.from('ratings').select('*, profiles:user_id(username)'),
          supabase.from('watchlist').select('*, profiles:user_id(username), titles:title_id(title)'),
          supabase.from('profiles').select('username, is_admin, created_at')
        ]);

        const backup = {
          exported_at: new Date().toISOString(),
          titles,
          ratings,
          watchlist: watchlistData,
          profiles: profilesData
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gulrating-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Бэкап сохранён в файл', 'success');
      } catch (e) {
        showToast('Ошибка экспорта: ' + e.message, 'error', 5000);
      }
    });
  }
}

function renderMyRatings(ratings) {
  if (!ratings || ratings.length === 0) {
    return `
      <div class="text-center py-12 text-gray-500">
        <div class="text-4xl mb-3">📝</div>
        <p>Вы еще не поставили ни одной оценки</p>
      </div>
    `;
  }

  return ratings.map(r => {
    const title = r.titles;
    if (!title) return '';
    const year = releaseYear(title.release_date);
    const ratingColor = r.rating >= 8 ? 'bg-green-600' : r.rating >= 5 ? 'bg-yellow-600' : 'bg-red-600';

    return `
      <div class="title-card bg-card rounded-2xl p-4 flex gap-4 hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}">
        <div class="flex-shrink-0 w-16">
          ${posterImg(title.poster_path, title.title, 'w-16 aspect-[2/3] rounded-lg')}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h3 class="font-semibold leading-tight">${escapeHtml(title.title)}</h3>
              <p class="text-sm text-gray-400">${year ? escapeHtml(year) + ' • ' : ''}${title.media_type === 'movie' ? 'фильм' : 'сериал'}</p>
            </div>
            <div class="${ratingColor} px-2 py-1 rounded-lg text-white font-bold min-w-[40px] text-center">${escapeHtml(formatRating(r.rating))}</div>
          </div>
          ${r.comment ? `<p class="mt-1 text-sm text-gray-300 line-clamp-2">${escapeHtml(r.comment)}</p>` : ''}
          <p class="text-xs text-gray-500 mt-1">${formatDistanceToNow(new Date(r.created_at))}</p>
        </div>
      </div>
    `;
  }).join('');
}

function renderWatchlist(items) {
  if (!items || items.length === 0) {
    return `
      <div class="text-center py-12 text-gray-500">
        <div class="text-4xl mb-3">📋</div>
        <p>Список «Хочу посмотреть» пуст</p>
      </div>
    `;
  }

  return items.map(item => {
    const title = item.titles;
    if (!title) return '';
    const year = releaseYear(title.release_date);

    return `
      <div class="title-card bg-card rounded-2xl p-4 flex gap-4 hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}">
        <div class="flex-shrink-0 w-16">
          ${posterImg(title.poster_path, title.title, 'w-16 aspect-[2/3] rounded-lg')}
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-semibold leading-tight">${escapeHtml(title.title)}</h3>
          <p class="text-sm text-gray-400">${year ? escapeHtml(year) + ' • ' : ''}${title.media_type === 'movie' ? 'фильм' : 'сериал'}</p>
          <span class="text-xs text-yellow-400 mt-1 inline-block">Добавлено ${formatDistanceToNow(new Date(item.created_at))}</span>
        </div>
      </div>
    `;
  }).join('');
}

function initTitleCards(currentUser) {
  document.querySelectorAll('.title-card').forEach(card => {
    card.addEventListener('click', () => {
      const titleId = card.dataset.titleId;
      const mediaType = card.dataset.mediaType;
      openRatingModal(titleId, mediaType, currentUser, (appEl) => {
        // Перерисовываем профиль, чтобы обновилась статистика (без полной перезагрузки)
        renderProfilePage(document.getElementById('app'), currentUser);
      });
    });
  });
}

// Уменьшает картинку до квадрата не больше maxSide и отдаёт data-URL JPEG.
// Храним аватар прямо в profiles.avatar_url — отдельное хранилище не нужно.
function downscaleImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
