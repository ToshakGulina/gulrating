import { supabase } from '../lib/supabase.js';
import { APP_BUILD } from '../config.js';
import { formatDistanceToNow } from '../lib/date.js';
import { openRatingModal } from './RatingModal.js';
import { cleanupFeed } from './Feed.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';
import { getCatalogSizeSetting, setCatalogSizeSetting, syncOfflineCatalog, getOfflineCatalogStats, isAppContext } from '../lib/offlineCatalog.js';
import { getFullCatalogMeta, fetchFullManifest, downloadFullCatalog, deleteFullCatalog } from '../lib/fullCatalog.js';
import { getWatchHistory, getPositions, removeWatchEntry, markWatchDone, reportWatchNative } from '../lib/watchHistory.js';
import { openWatchOverlay } from './RatingModal.js';
import { getKpCacheTtlDays } from '../lib/kinopoisk.js';

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
    <div class="max-w-4xl xl:max-w-6xl mx-auto pb-20">
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

        <!-- История просмотров: продолжить с места, прогресс, «досмотрено» -->
        <div class="bg-card rounded-2xl border border-slate-700 p-4 mb-4">
          <h3 class="font-semibold mb-3">История просмотров</h3>
          <div id="watch-history" class="space-y-2"></div>
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
          <div class="mb-4">
            <p class="text-xs text-gray-500 mb-2">Или выберите готовый аватар</p>
            <div id="avatar-presets" class="grid grid-cols-8 sm:grid-cols-12 gap-2"></div>
          </div>
          <div class="flex gap-2">
            <input id="nick-input" type="text" value="${escapeHtml(currentUser.profile.username)}" maxlength="40"
              class="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white" placeholder="Ник">
            <button id="nick-save-btn" class="px-4 py-2.5 bg-primary hover:bg-primary/90 rounded-xl text-sm font-medium">Сохранить</button>
          </div>

          <h3 class="font-semibold mt-6 mb-3">Приложение на устройстве</h3>
          <div id="install-box" class="text-sm text-gray-300 space-y-2 mb-2"></div>

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
            <div>
              <div class="flex items-center justify-between gap-3 mb-1">
                <span class="text-gray-300">Порог ряда «Друзья оценили высоко»</span>
                <span id="threshold-val" class="text-sm font-bold text-pink-300">7.5</span>
              </div>
              <input type="range" id="threshold-range" min="0" max="10" step="0.1" class="rating-slider w-full" aria-label="Порог средней оценки друзей">
            </div>
            <div>
              <div class="flex items-center justify-between gap-3 mb-1">
                <span class="text-gray-300">Минимум друзей для ряда «Хотят посмотреть»</span>
                <span id="wantmin-val" class="text-sm font-bold text-secondary">1</span>
              </div>
              <input type="range" id="wantmin-range" min="1" max="6" step="1" class="rating-slider w-full" aria-label="Минимальное число друзей в списках">
            </div>
            <div>
              <div class="flex items-center justify-between gap-3 mb-1">
                <span class="text-gray-300">Ваша оценка для персонального подбора</span>
                <span id="mymin-val" class="text-sm font-bold text-primary">8.0</span>
              </div>
              <input type="range" id="mymin-range" min="0" max="10" step="0.1" class="rating-slider w-full" aria-label="Минимальная ваша оценка для подбора похожего">
            </div>
            <div id="cat-size-box">
              <div class="flex items-center justify-between gap-3 mb-1">
                <span class="text-gray-300">Офлайн-база фильмов (тайтлов)</span>
                <span id="cat-size-val" class="text-sm font-bold text-cyan-300">3000</span>
              </div>
              <input type="range" id="cat-size-range" min="500" max="15000" step="500" class="rating-slider w-full" aria-label="Сколько популярных тайтлов держать на устройстве">
              <p id="cat-size-status" class="text-xs text-gray-600 mt-1"></p>
            </div>
            <div id="full-db-box">
              <div class="flex items-center justify-between gap-3 mb-1">
                <span class="text-gray-300">Полная база TMDb на устройстве</span>
                <span id="full-db-status" class="text-xs text-gray-500"></span>
              </div>
              <p class="text-xs text-gray-600 mb-2">Весь каталог (~1 млн тайтлов, ≈100 МБ одним скачиванием) для полностью офлайн-поиска. Хранится чанками в IndexedDB, целиком в память не загружается.</p>
              <button id="full-db-btn" class="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm">Скачать полную базу</button>
            </div>
            <div>
              <div class="flex items-center justify-between gap-3 mb-1">
                <span class="text-gray-300">Кэш данных Кинопоиска (дней)</span>
                <span id="kp-ttl-val" class="text-sm font-bold text-orange-300">14</span>
              </div>
              <input type="range" id="kp-ttl-range" min="1" max="90" step="1" class="rating-slider w-full" aria-label="Сколько дней хранить рейтинги Кинопоиска на устройстве">
              <p class="text-xs text-gray-600 mt-1">Повторные карточки не обращаются к API вовсе: запрос идёт только при первом открытии тайтла за срок кэша.</p>
            </div>
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
        <div class="max-w-4xl xl:max-w-6xl mx-auto flex">
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
  const presetsBox = document.getElementById('avatar-presets');
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

  // Пресеты аватаров: emoji на цветном фоне, хранится как data-URI SVG
  presetsBox.innerHTML = AVATAR_PRESETS.map(([emoji, bg], i) => `
    <button class="avatar-preset aspect-square rounded-full overflow-hidden border-2 ${currentUser.profile.avatar_url === presetAvatarUri(emoji, bg) ? 'border-primary' : 'border-transparent'} hover:border-slate-500" data-i="${i}" title="Выбрать аватар">
      <img src="${presetAvatarUri(emoji, bg)}" alt="" class="w-full h-full">
    </button>
  `).join('');
  presetsBox.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.avatar-preset');
    if (!btn) return;
    const [emoji, bg] = AVATAR_PRESETS[Number(btn.dataset.i)];
    const uri = presetAvatarUri(emoji, bg);
    if (await saveProfileFields({ avatar_url: uri })) {
      avatarPreview.src = uri;
      presetsBox.querySelectorAll('.avatar-preset').forEach((b) => {
        b.classList.toggle('border-primary', b === btn);
        b.classList.toggle('border-transparent', b !== btn);
      });
      showToast('Аватар обновлён', 'success');
    }
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

  // Слайдеры порогов рекомендаций: полная шкала, значение видно сразу
  const thresholdRange = document.getElementById('threshold-range');
  const thresholdVal = document.getElementById('threshold-val');
  thresholdRange.value = localStorage.getItem('gulrating:friends_threshold') ?? '7.5';
  thresholdVal.textContent = Number(thresholdRange.value).toFixed(1);
  thresholdRange.addEventListener('input', () => {
    thresholdVal.textContent = Number(thresholdRange.value).toFixed(1);
    localStorage.setItem('gulrating:friends_threshold', thresholdRange.value);
  });

  const wantminRange = document.getElementById('wantmin-range');
  const wantminVal = document.getElementById('wantmin-val');
  wantminRange.value = localStorage.getItem('gulrating:want_min') || '1';
  wantminVal.textContent = wantminRange.value;
  wantminRange.addEventListener('input', () => {
    wantminVal.textContent = wantminRange.value;
    localStorage.setItem('gulrating:want_min', wantminRange.value);
  });

  const myminRange = document.getElementById('mymin-range');
  const myminVal = document.getElementById('mymin-val');
  myminRange.value = localStorage.getItem('gulrating:my_min') ?? '8';
  myminVal.textContent = Number(myminRange.value).toFixed(1);
  myminRange.addEventListener('input', () => {
    myminVal.textContent = Number(myminRange.value).toFixed(1);
    localStorage.setItem('gulrating:my_min', myminRange.value);
  });

  // Срок локального кэша Кинопоиска
  const kpTtlRange = document.getElementById('kp-ttl-range');
  const kpTtlVal = document.getElementById('kp-ttl-val');
  kpTtlRange.value = String(getKpCacheTtlDays());
  kpTtlVal.textContent = kpTtlRange.value;
  kpTtlRange.addEventListener('input', () => {
    kpTtlVal.textContent = kpTtlRange.value;
    localStorage.setItem('gulrating:kp_cache_days', kpTtlRange.value);
  });

  // Офлайн-база фильмов: размер (полная шкала) и статус закачки
  const catSizeRange = document.getElementById('cat-size-range');
  const catSizeVal = document.getElementById('cat-size-val');
  const catSizeStatus = document.getElementById('cat-size-status');
  function paintCatStatus() {
    if (!catSizeStatus) return;
    const stats = getOfflineCatalogStats();
    if (stats.syncing) {
      catSizeStatus.textContent = `Скачивание: ${stats.count} из ${stats.target}…`;
    } else if (!stats.count) {
      catSizeStatus.textContent = 'База ещё не скачана — загрузка идёт автоматически, когда есть сеть.';
    } else if (stats.complete) {
      const date = stats.updatedAt ? new Date(stats.updatedAt).toLocaleDateString('ru-RU') : '';
      catSizeStatus.textContent = `Скачано ${stats.count} тайтлов${date ? ', обновлено ' + date : ''}. Поиск и оценка работают без сети.`;
    } else {
      catSizeStatus.textContent = `Скачано ${stats.count} из ${stats.target} — продолжится автоматически при сети.`;
    }
  }
  catSizeRange.value = String(getCatalogSizeSetting());
  catSizeVal.textContent = catSizeRange.value;
  paintCatStatus();
  catSizeRange.addEventListener('input', () => {
    catSizeVal.textContent = catSizeRange.value;
  });
  // Полная база: статус, скачивание с прогрессом, удаление
  const fullDbBtn = document.getElementById('full-db-btn');
  const fullDbStatus = document.getElementById('full-db-status');
  function paintFullDb() {
    const meta = getFullCatalogMeta();
    if (meta) {
      const mb = meta.bytes ? (meta.bytes / 1048576).toFixed(0) : '?';
      fullDbStatus.textContent = meta.partial
        ? `скачано чанков: ${meta.partial}/${meta.chunks.length}`
        : `✓ ${Number(meta.total).toLocaleString('ru-RU')} тайтлов, ${mb} МБ`;
      fullDbBtn.textContent = meta.partial ? 'Докачать полную базу' : 'Удалить полную базу';
    } else {
      fullDbStatus.textContent = 'не скачана';
      fullDbBtn.textContent = 'Скачать полную базу';
    }
  }
  paintFullDb();
  // Офлайн-база — только для приложения (APK / установленное PWA):
  // десктоп-сайту она не нужна, ничего не скачиваем и не показываем
  if (!isAppContext()) {
    document.getElementById('cat-size-box').style.display = 'none';
    document.getElementById('full-db-box').style.display = 'none';
  }
  // Показываем реальный размер из манифеста, чтобы решение было осознанным
  fetchFullManifest().then(got => {
    if (got && !getFullCatalogMeta()) {
      fullDbStatus.textContent = `доступно: ${Number(got.manifest.total).toLocaleString('ru-RU')} тайтлов, ${(got.manifest.bytes / 1048576).toFixed(0)} МБ`;
    }
  }).catch(() => {});
  fullDbBtn.addEventListener('click', async () => {
    const meta = getFullCatalogMeta();
    if (meta && !meta.partial) {
      await deleteFullCatalog();
      paintFullDb();
      return;
    }
    fullDbBtn.disabled = true;
    fullDbBtn.textContent = 'Скачиваем… 0%';
    const result = await downloadFullCatalog((done, total) => {
      fullDbBtn.textContent = `Скачиваем… ${Math.round(done / total * 100)}%`;
      fullDbStatus.textContent = `чанков: ${done}/${total}`;
    }).catch(() => null);
    fullDbBtn.disabled = false;
    if (result) showToast(`Полная база скачана: ${Number(result.total).toLocaleString('ru-RU')} тайтлов`, 'success', 5000);
    else showToast('Скачивание прервалось на сети — кнопка докачает с того же места', 'info', 5000);
    paintFullDb();
  });

  catSizeRange.addEventListener('change', async () => {
    setCatalogSizeSetting(Number(catSizeRange.value));
    paintCatStatus();
    const tick = setInterval(paintCatStatus, 2000);
    await syncOfflineCatalog().catch(() => null);
    clearInterval(tick);
    paintCatStatus();
  });

  // История просмотров: продолжение, прогресс-бар (позиция из APK), «досмотрено»
  const whBox = document.getElementById('watch-history');
  function paintWatchHistory() {
    const items = getWatchHistory();
    const positions = getPositions();
    if (!items.length) {
      whBox.innerHTML = '<p class="text-xs text-gray-600">Пока пусто: нажмите «Смотреть» в карточке фильма или сериала.</p>';
      return;
    }
    whBox.innerHTML = items.map(i => {
      const pos = positions[i.key];
      const pct = pos && pos.d ? Math.min(100, Math.round(pos.t / pos.d * 100)) : null;
      return `
      <div class="flex items-center gap-3 bg-slate-800/50 rounded-xl p-2" data-key="${escapeHtml(i.key)}">
        ${posterImg(i.poster_path, i.title, 'w-10 aspect-[2/3] rounded-md')}
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium truncate">${escapeHtml(i.title)}</div>
          <div class="text-[11px] text-gray-500">${i.media_type === 'movie' ? 'фильм' : 'сериал'} • ${new Date(i.last_at).toLocaleDateString('ru-RU')}${i.done ? ' • досмотрено' : ''}</div>
          ${pct !== null ? `
            <div class="h-1 mt-1 rounded bg-slate-700 overflow-hidden"><div class="h-full bg-red-500" style="width:${pct}%"></div></div>
            <div class="text-[10px] text-gray-500">просмотрено ${pct}%</div>` : ''}
        </div>
        <div class="flex flex-col gap-1 flex-shrink-0 items-stretch">
          ${(i.kp_url || i.kpId || i.query) ? '<button class="wh-continue px-2 py-1 text-[11px] bg-primary hover:bg-primary/90 text-white rounded-lg">Продолжить</button>' : ''}
          ${i.media_type === 'tv' && !i.done ? '<button class="wh-done px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 rounded-lg">Досмотрено</button>' : ''}
          <button class="wh-del px-2 py-1 text-[11px] text-gray-500 hover:text-red-400" aria-label="Убрать из истории">&times;</button>
        </div>
      </div>`;
    }).join('');
    whBox.querySelectorAll('.wh-continue').forEach(b => b.addEventListener('click', () => {
      const item = getWatchHistory().find(x => x.key === b.closest('[data-key]').dataset.key);
      if (!item || !(item.kp_url || item.kpId || item.query)) return;
      reportWatchNative(item.id, item.media_type);
      if (item.kp_url) {
        // Открываем страницу зеркала в текущей вкладке: на ней доступен
        // полный список источников (включая Alloha и Turbo).
        window.location.href = item.kp_url;
        return;
      }
      // Если у записи нет ссылки зеркала, используем список Kinobox.
      openWatchOverlay({
        kpId: item.kpId,
        query: item.query || item.title,
        titleText: item.title,
        mirrorUrl: item.kp_url
      });
    }));
    whBox.querySelectorAll('.wh-done').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      await markWatchDone(b.closest('[data-key]').dataset.key).catch(() => null);
      showToast('Слежение включено: о новом сезоне придёт уведомление', 'info', 4000);
      paintWatchHistory();
    }));
    whBox.querySelectorAll('.wh-del').forEach(b => b.addEventListener('click', () => {
      removeWatchEntry(b.closest('[data-key]').dataset.key);
      paintWatchHistory();
    }));
  }
  paintWatchHistory();

  // Установка на телефон: кнопка системного install-промта либо подсказка
  const installBox = document.getElementById('install-box');
  function paintInstallBox() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || Boolean(navigator.standalone);
    if (standalone) {
      installBox.innerHTML = '<p class="text-green-400">✓ Установлено: работает как отдельное приложение, оболочка доступна офлайн.</p>';
      return;
    }
    if (window.__gulratingInstallPrompt) {
      installBox.innerHTML = `
        <button id="install-app-btn" class="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-medium rounded-xl">Установить приложение на устройство</button>
        <p class="text-xs text-gray-500">Иконка появится на домашнем экране, окно будет открываться без браузера.</p>`;
      document.getElementById('install-app-btn').addEventListener('click', async () => {
        const promptEvent = window.__gulratingInstallPrompt;
        if (!promptEvent) { paintInstallBox(); return; }
        promptEvent.prompt();
        const choice = await promptEvent.userChoice.catch(() => null);
        window.__gulratingInstallPrompt = null;
        if (choice && choice.outcome === 'accepted') {
          showToast('Устанавливаем приложение…', 'success');
        } else {
          showToast('Установка отменена', 'info');
        }
        paintInstallBox();
      });
      return;
    }
    installBox.innerHTML = `
      <p class="text-xs text-gray-400 leading-relaxed">
        <b class="text-gray-300">Android (Chrome/Yandex):</b> меню браузера → «Установить приложение» / «Добавить на главный экран».<br>
        <b class="text-gray-300">iPhone (Safari):</b> «Поделиться» → «На экран «Домой»».<br>
        После установки ГульРейтинг открывается как обычное приложение, а оболочка работает даже без сети.
      </p>`;
  }
  paintInstallBox();
  window.addEventListener('gulrating:installable', paintInstallBox);
  window.addEventListener('gulrating:appinstalled', paintInstallBox);

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
        <div class="profile-card-poster flex-shrink-0">
          ${posterImg(title.poster_path, title.title, 'w-full aspect-[2/3] rounded-lg')}
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
        <div class="profile-card-poster flex-shrink-0">
          ${posterImg(title.poster_path, title.title, 'w-full aspect-[2/3] rounded-lg')}
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
// Пресеты аватаров: emoji на цветном фоне. Храним как data-URI SVG прямо
// в profiles.avatar_url — отдельное хранилище не нужно.
const AVATAR_PRESETS = [
  ['🦖', '#0f766e'], ['🦊', '#b45309'], ['🐙', '#7c3aed'], ['🦉', '#334155'],
  ['🐸', '#3f6212'], ['🦄', '#be185d'], ['🐳', '#0c4a6e'], ['🦅', '#78350f'],
  ['🐢', '#166534'], ['🦋', '#1d4ed8'], ['🍄', '#b91c1c'], ['🌵', '#15803d'],
  ['🎬', '#1e293b'], ['🍿', '#a16207'], ['👾', '#6d28d9'], ['🤖', '#475569'],
  ['🐺', '#57534e'], ['🔥', '#c2410c'], ['❄️', '#0369a1'], ['🌙', '#312e81'],
  ['⭐', '#a16207'], ['🎧', '#0f766e'], ['🐻', '#713f12'], ['🍩', '#9d174d']
];

function presetAvatarUri(emoji, bg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${bg}"/><text x="32" y="45" font-size="36" text-anchor="middle">${emoji}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

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
