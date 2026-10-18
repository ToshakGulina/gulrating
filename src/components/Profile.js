import { supabase } from '../lib/supabase.js';
import { setUserTitleStatus, queueUserTitleStatus } from '../lib/ratings.js';
import { mountPage } from '../lib/pageState.js';
import { APP_BUILD } from '../config.js';
import { formatDistanceToNow } from '../lib/date.js';
import { openRatingModal } from './RatingModal.js';
import { FEED_SECTIONS, getFeedOrder, getVisibleFeedSections, saveFeedOrder, saveVisibleFeedSections } from './Feed.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';
import { getCatalogSizeSetting, setCatalogSizeSetting, syncOfflineCatalog, getOfflineCatalogStats, isAppContext } from '../lib/offlineCatalog.js';
import { getFullCatalogMeta, fetchFullManifest, downloadFullCatalog, deleteFullCatalog } from '../lib/fullCatalog.js';
import { getWatchHistory, getPositions, removeWatchEntry, markWatchDone, unmarkWatchDone, reportWatchNative, isApk } from '../lib/watchHistory.js';
import { openWatchOverlay } from './RatingModal.js';
import { getKpCacheTtlDays } from '../lib/kinopoisk.js';
import { THEMES, getThemeId, setTheme } from '../lib/theme.js';

// Полная тема оформления задаётся data-theme на корне документа.
let installBoxUpdateHandler = null;

function formatPlaybackTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}:${remainder}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`;
}

const PROFILE_SNAPSHOT_PREFIX = 'gulrating:profile_snapshot:';
const PROFILE_ACTIVITY_TABS = [
  { id: 'watchlist', label: 'Хочу посмотреть' },
  { id: 'in_progress', label: 'В процессе' },
  { id: 'watched', label: 'Просмотрено' },
  { id: 'dropped', label: 'Заброшено' },
];

function readProfileSnapshot(userId) {
  try {
    const snapshot = JSON.parse(localStorage.getItem(`${PROFILE_SNAPSHOT_PREFIX}${userId}`) || 'null');
    return snapshot && Array.isArray(snapshot.ratings) ? snapshot : null;
  } catch (e) {
    return null;
  }
}

function writeProfileSnapshot(userId, snapshot) {
  try {
    localStorage.setItem(`${PROFILE_SNAPSHOT_PREFIX}${userId}`, JSON.stringify(snapshot));
  } catch (e) { /* keep the previous snapshot if storage is full */ }
}

window.addEventListener('gulrating:pages-cleared', () => {
  if (!installBoxUpdateHandler) return;
  window.removeEventListener('gulrating:installable', installBoxUpdateHandler);
  window.removeEventListener('gulrating:appinstalled', installBoxUpdateHandler);
  installBoxUpdateHandler = null;
});

export async function renderProfilePage(app, currentUser, { force = false } = {}) {
  const page = mountPage(app, 'profile');
  const pageRoot = page.root;
  if (!page.isNew && !force) return;
  const previousProfileSection = pageRoot.querySelector('.profile-section-tab[aria-selected="true"]')?.dataset.profileSection || 'overview';
  const savedActivityTab = pageRoot.querySelector('.tab-btn.bg-primary')?.dataset.tab || 'watched';
  const previousActivityTab = PROFILE_ACTIVITY_TABS.some(tab => tab.id === savedActivityTab) ? savedActivityTab : 'watched';
  if (page.isNew) pageRoot.innerHTML = '<div class="p-8 text-center text-sm text-gray-400">Загружаем профиль…</div>';

  const cachedSnapshot = readProfileSnapshot(currentUser.id);
  const useLocalSnapshot = Boolean(currentUser.offlineOnly)
    || (typeof navigator !== 'undefined' && navigator.onLine === false);
  let snapshot = cachedSnapshot;
  if (!useLocalSnapshot) {
    let timeoutId;
    const liveResults = await Promise.race([
      Promise.all([
        supabase.from('ratings').select('*, titles!inner(*)', { count: 'exact' }).eq('user_id', currentUser.id).order('created_at', { ascending: false }),
        supabase.from('watchlist').select('*, titles!inner(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
        supabase.from('title_statuses').select('title_id,status,titles!inner(*)').eq('user_id', currentUser.id),
        currentUser.profile.is_admin
          ? supabase.from('profiles').select('id,username,avatar_url,is_approved,is_admin,created_at').order('username', { ascending: true })
          : Promise.resolve({ data: [], error: null })
      ]).then(results => ({ results })).catch(() => ({ failed: true })),
      new Promise(resolve => { timeoutId = setTimeout(() => resolve({ timedOut: true }), 1800); })
    ]);
    clearTimeout(timeoutId);
    if (liveResults.results) {
      const [ratingResult, watchlistResult, statusResult, profileResult] = liveResults.results;
      const previous = cachedSnapshot || {};
      snapshot = {
        ratings: ratingResult.error ? (previous.ratings || []) : (ratingResult.data || []),
        ratingsCount: ratingResult.error ? previous.ratingsCount : ratingResult.count,
        watchlist: watchlistResult.error ? (previous.watchlist || []) : (watchlistResult.data || []),
        titleStatuses: statusResult.error ? (previous.titleStatuses || []) : (statusResult.data || []),
        profiles: profileResult.error ? (previous.profiles || []) : (profileResult.data || []),
        savedAt: Date.now()
      };
      if (liveResults.results.some(result => !result.error)) writeProfileSnapshot(currentUser.id, snapshot);
    }
  }

  snapshot ||= { ratings: [], ratingsCount: 0, watchlist: [], titleStatuses: [], profiles: [] };
  let myRatingsList = snapshot.ratings || [];
  let watchlistList = snapshot.watchlist || [];
  let titleStatusesList = snapshot.titleStatuses || [];
  const ratingsCount = snapshot.ratingsCount ?? myRatingsList.length;
  const statusByTitleId = new Map(titleStatusesList.map(row => [String(row.title_id), row.status]));
  const profileList = snapshot.profiles || [];

  const averageRating = myRatingsList.length > 0
    ? (myRatingsList.reduce((sum, r) => sum + r.rating, 0) / myRatingsList.length).toFixed(1)
    : '—';

  const pendingUsers = profileList.filter(p => !p.is_approved);
  const approvedUsers = profileList.filter(p => p.is_approved);

  pageRoot.innerHTML = `
    <div class="max-w-4xl xl:max-w-6xl mx-auto pb-20">
      <div class="sticky top-0 z-20 bg-dark/80 backdrop-blur-card py-4 px-4 border-b border-slate-800">
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-bold">Профиль</h1>
          <button id="logout-btn" class="text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg bg-card hover:bg-slate-700">Выйти</button>
        </div>
      </div>

      <div class="p-4">
        <div class="profile-section-switch flex gap-2 p-1 mb-3 rounded-xl bg-slate-900/70" role="tablist" aria-label="Раздел профиля">
          <button class="profile-section-tab flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary text-white" data-profile-section="overview" role="tab" aria-controls="profile-overview-panel" aria-selected="true">Профиль</button>
          <button class="profile-section-tab flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-400 hover:text-white" data-profile-section="settings" role="tab" aria-controls="profile-settings-panel" aria-selected="false">Настройки</button>
        </div>
        <section id="profile-overview-panel" class="profile-section-panel space-y-3" role="tabpanel" aria-label="Профиль">
        <!-- Карточка профиля -->
        <div class="bg-card rounded-xl border border-slate-700/60 p-4">
          <div class="flex items-center gap-4 mb-4">
            <button id="profile-avatar-edit" type="button" class="relative flex-shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" title="Изменить аватар" aria-label="Изменить аватар">
              <img id="profile-avatar" src="${escapeHtml(safeAvatarUrl(currentUser.profile.avatar_url, currentUser.profile.username))}" alt="" class="w-20 h-20 rounded-full bg-slate-700 object-cover">
              <span class="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full border-2 border-card bg-primary text-sm text-white" aria-hidden="true">✎</span>
            </button>
            <div class="min-w-0">
              <button id="profile-name-edit" type="button" class="inline-flex max-w-full items-center gap-2 rounded-md text-left text-xl font-bold hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" title="Изменить ник">
                <span id="profile-name" class="truncate">${escapeHtml(currentUser.profile.username)}</span>
                <span class="text-xs text-gray-500" aria-hidden="true">✎</span>
              </button>
              <p class="text-gray-400 text-sm">${escapeHtml(currentUser.email)}</p>
              ${currentUser.profile.is_admin ? '<span class="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full mt-1 inline-block">Администратор</span>' : ''}
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-slate-800/80 rounded-lg p-2.5">
              <div class="text-2xl font-bold">${ratingsCount ?? myRatingsList.length}</div>
              <div class="text-xs text-gray-400">Оценок</div>
            </div>
            <div class="bg-slate-800/80 rounded-lg p-2.5">
              <div class="text-2xl font-bold">${averageRating}</div>
              <div class="text-xs text-gray-400">Средняя</div>
            </div>
            <div class="bg-slate-800/80 rounded-lg p-2.5">
              <div class="text-2xl font-bold">${watchlistList.length}</div>
              <div class="text-xs text-gray-400">В планах</div>
            </div>
          </div>
        </div>

        <!-- История просмотров и отслеживание новых выпусков -->
        <div class="bg-card rounded-xl border border-slate-700/60 p-3">
          <h3 class="font-semibold mb-3">История просмотров</h3>
          <div id="watch-history" class="space-y-2"></div>
        </div>
        <div class="bg-card rounded-xl border border-slate-700/60 p-3">
          <h3 class="font-semibold mb-1">Просмотрено</h3>
          <p class="text-xs text-gray-500 mb-3">Здесь тайтлы, за которыми следим: уведомим о новых сезонах и сериях сериалов или частях фильма из коллекции TMDb.</p>
          <div id="watched-history" class="space-y-2"></div>
        </div>

        <!-- Оценки и список просмотра -->
        <div class="flex gap-2 mb-2 overflow-x-auto scrollbar-hide" role="tablist" aria-label="Статусы тайтлов">
          ${PROFILE_ACTIVITY_TABS.map(tab => `
            <button class="tab-btn px-4 py-2 ${tab.id === previousActivityTab ? 'bg-primary text-white' : 'bg-card hover:bg-slate-700'} rounded-full text-sm font-medium whitespace-nowrap" data-tab="${tab.id}" role="tab" aria-selected="${tab.id === previousActivityTab}">${tab.label}</button>
          `).join('')}
        </div>

        <div id="profile-content" class="space-y-3" role="tabpanel" aria-label="Тайтлы в выбранном статусе"></div>
        </section>
        <section id="profile-settings-panel" class="profile-section-panel hidden space-y-3" role="tabpanel" aria-label="Настройки">
        <h2 class="text-xl font-bold mb-2">Настройки</h2>
        <!-- Настройки аккаунта и приложения -->
        <div class="bg-card rounded-xl border border-slate-700/60 p-4">
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
              <span class="text-gray-300">Объединить оценки одного фильма разными людьми в ленте</span>
              <input id="merge-ratings-toggle" type="checkbox" class="w-4 h-4">
            </label>
            <div class="mt-5 border-t border-slate-700 pt-4">
              <h4 class="font-medium text-gray-200">Состав и порядок ленты</h4>
              <p class="text-xs text-gray-500 mt-1 mb-3">Отметьте нужные разделы и задайте их порядок. Управление находится только здесь.</p>
              <div id="feed-layout-editor" class="space-y-2"></div>
            </div>
            <div>
              <h4 class="font-medium text-gray-200">Тема оформления</h4>
              <p class="text-xs text-gray-500 mt-1 mb-3">Тема меняет фон, карточки, текст и акценты. Выбор сохраняется на устройстве и синхронизируется с аккаунтом.</p>
              <div id="theme-options" class="theme-options">
                ${THEMES.map(theme => `<button type="button" class="theme-option" data-theme-id="${theme.id}" aria-pressed="false" aria-label="${theme.name}: ${theme.description}">
                  <span class="theme-preview" aria-hidden="true">
                    <span style="background-color:rgb(${theme.preview.bg})"></span>
                    <span style="background-color:rgb(${theme.preview.card})"></span>
                    <span style="background-color:rgb(${theme.preview.primary})"></span>
                    <span style="background-color:rgb(${theme.preview.secondary})"></span>
                  </span>
                  <span class="text-sm font-semibold">${theme.name}</span>
                  <span class="text-xs text-gray-500">${theme.description}</span>
                </button>`).join('')}
              </div>
            </div>
          </div>
        </div>

        <!-- Секция админа: управление пользователями -->
        ${currentUser.profile.is_admin ? `
          <div class="bg-card rounded-xl border border-slate-700/60 p-4">
            <h3 class="font-semibold mb-3">👥 Управление доступом (${profileList.length})</h3>
            
            ${pendingUsers.length > 0 ? `
              <p class="text-sm text-yellow-400 mb-2">Ожидают подтверждения доступа:</p>
              <div class="space-y-2 mb-4">
                ${pendingUsers.map(p => `
                  <div class="flex flex-wrap items-center gap-3 p-2 bg-slate-800 rounded-lg">
                    <div class="flex items-center gap-2 flex-1 min-w-[120px]">
                      <img src="${escapeHtml(safeAvatarUrl(p.avatar_url, p.username))}" alt="" class="w-8 h-8 rounded-full bg-slate-700">
                      <div class="font-medium text-sm">${escapeHtml(p.username)}</div>
                    </div>
                    <label class="inline-flex items-center gap-1.5 text-xs text-gray-300">
                      <input type="checkbox" class="user-admin-toggle w-4 h-4" data-user-id="${escapeHtml(p.id)}" data-original="${p.is_admin ? '1' : '0'}" ${p.is_admin ? 'checked' : ''}>
                      Администратор
                    </label>
                    <button class="approve-user-btn px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm" data-user-id="${escapeHtml(p.id)}">Одобрить</button>
                  </div>
                `).join('')}
              </div>
            ` : '<p class="text-sm text-gray-400 mb-3">Нет новых заявок на доступ</p>'}
            
            <p class="text-sm font-medium mb-2">Участники:</p>
            <div class="space-y-2">
              ${approvedUsers.map(p => `
                <div class="flex flex-wrap items-center gap-3 p-2 hover:bg-slate-800 rounded-lg">
                  <div class="flex items-center gap-2 flex-1 min-w-[120px]">
                    <img src="${escapeHtml(safeAvatarUrl(p.avatar_url, p.username))}" alt="" class="w-8 h-8 rounded-full bg-slate-700">
                    <div class="font-medium text-sm">${escapeHtml(p.username)}${String(p.id) === String(currentUser.id) ? ' (вы)' : ''}</div>
                  </div>
                  <label class="inline-flex items-center gap-1.5 text-xs text-gray-300">
                    <input type="checkbox" class="user-admin-toggle w-4 h-4" data-user-id="${escapeHtml(p.id)}" data-original="${p.is_admin ? '1' : '0'}" ${p.is_admin ? 'checked' : ''} ${String(p.id) === String(currentUser.id) ? 'disabled' : ''}>
                    Администратор
                  </label>
                  ${String(p.id) !== String(currentUser.id) ? `<button class="revoke-user-btn px-2 py-1 text-xs rounded-lg bg-slate-700 hover:bg-red-900/70 text-gray-200" data-user-id="${escapeHtml(p.id)}">Отозвать доступ</button>` : ''}
                </div>
              `).join('')}
            </div>
            <button id="export-btn" class="w-full mt-4 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">💾 Экспортировать все данные в JSON (бэкап)</button>
            <p class="text-xs text-gray-500 mt-3">Просто разошлите друзьям ссылку на сайт. После того как они зарегистрируются по почте, они появятся в списке выше и вы сможете одобрить им доступ в один клик.</p>
          </div>
        ` : ''}

        </section>
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

  function setProfileSection(section) {
    pageRoot.querySelectorAll('.profile-section-tab').forEach(button => {
      const selected = button.dataset.profileSection === section;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('bg-primary', selected);
      button.classList.toggle('text-white', selected);
      button.classList.toggle('text-gray-400', !selected);
    });
    pageRoot.querySelectorAll('.profile-section-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `profile-${section}-panel`);
    });
  }
  pageRoot.querySelectorAll('.profile-section-tab').forEach(button => {
    button.addEventListener('click', () => setProfileSection(button.dataset.profileSection));
  });
  setProfileSection(previousProfileSection);

  // Обработчик выхода
  pageRoot.querySelector('#logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  // --- Настройки: аватар, ник, лента ---
  const avatarPreview = pageRoot.querySelector('#avatar-preview');
  const profileAvatar = pageRoot.querySelector('#profile-avatar');
  const avatarInput = pageRoot.querySelector('#avatar-input');
  const presetsBox = pageRoot.querySelector('#avatar-presets');
  const nickInput = pageRoot.querySelector('#nick-input');
  const sortSelect = pageRoot.querySelector('#sort-select');

  pageRoot.querySelector('#profile-avatar-edit').addEventListener('click', () => {
    setProfileSection('settings');
    avatarInput.click();
  });
  pageRoot.querySelector('#profile-name-edit').addEventListener('click', () => {
    setProfileSection('settings');
    nickInput.focus();
    nickInput.select();
  });

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
        profileAvatar.src = dataUrl;
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
      profileAvatar.src = uri;
      presetsBox.querySelectorAll('.avatar-preset').forEach((b) => {
        b.classList.toggle('border-primary', b === btn);
        b.classList.toggle('border-transparent', b !== btn);
      });
      showToast('Аватар обновлён', 'success');
    }
  });

  pageRoot.querySelector('#avatar-remove-btn').addEventListener('click', async () => {
    if (await saveProfileFields({ avatar_url: null })) {
      avatarPreview.src = safeAvatarUrl(null, currentUser.profile.username);
      profileAvatar.src = avatarPreview.src;
      showToast('Аватар убран', 'success');
    }
  });

  pageRoot.querySelector('#nick-save-btn').addEventListener('click', async () => {
    const value = nickInput.value.trim();
    if (!value) {
      showToast('Ник не может быть пустым', 'error');
      return;
    }
    if (value === currentUser.profile.username) return;
    if (await saveProfileFields({ username: value })) {
      showToast('Ник сохранён', 'success');
      pageRoot.querySelector('#profile-name').textContent = value;
      if (!currentUser.profile.avatar_url) {
        const fallbackAvatar = safeAvatarUrl(null, value);
        profileAvatar.src = fallbackAvatar;
        avatarPreview.src = fallbackAvatar;
      }
    }
  });

  sortSelect.value = localStorage.getItem('gulrating:feed_sort') || 'new';
  sortSelect.addEventListener('change', () => {
    localStorage.setItem('gulrating:feed_sort', sortSelect.value);
    showToast('Порядок ленты обновлён', 'success');
  });

  // Слайдеры порогов рекомендаций: полная шкала, значение видно сразу
  const thresholdRange = pageRoot.querySelector('#threshold-range');
  const thresholdVal = pageRoot.querySelector('#threshold-val');
  thresholdRange.value = localStorage.getItem('gulrating:friends_threshold') ?? '7.5';
  thresholdVal.textContent = Number(thresholdRange.value).toFixed(1);
  thresholdRange.addEventListener('input', () => {
    thresholdVal.textContent = Number(thresholdRange.value).toFixed(1);
    localStorage.setItem('gulrating:friends_threshold', thresholdRange.value);
  });

  const wantminRange = pageRoot.querySelector('#wantmin-range');
  const wantminVal = pageRoot.querySelector('#wantmin-val');
  wantminRange.value = localStorage.getItem('gulrating:want_min') || '1';
  wantminVal.textContent = wantminRange.value;
  wantminRange.addEventListener('input', () => {
    wantminVal.textContent = wantminRange.value;
    localStorage.setItem('gulrating:want_min', wantminRange.value);
  });

  const myminRange = pageRoot.querySelector('#mymin-range');
  const myminVal = pageRoot.querySelector('#mymin-val');
  myminRange.value = localStorage.getItem('gulrating:my_min') ?? '8';
  myminVal.textContent = Number(myminRange.value).toFixed(1);
  myminRange.addEventListener('input', () => {
    myminVal.textContent = Number(myminRange.value).toFixed(1);
    localStorage.setItem('gulrating:my_min', myminRange.value);
  });

  // Срок локального кэша Кинопоиска
  const kpTtlRange = pageRoot.querySelector('#kp-ttl-range');
  const kpTtlVal = pageRoot.querySelector('#kp-ttl-val');
  kpTtlRange.value = String(getKpCacheTtlDays());
  kpTtlVal.textContent = kpTtlRange.value;
  kpTtlRange.addEventListener('input', () => {
    kpTtlVal.textContent = kpTtlRange.value;
    localStorage.setItem('gulrating:kp_cache_days', kpTtlRange.value);
  });

  // Офлайн-база фильмов: размер (полная шкала) и статус закачки
  const catSizeRange = pageRoot.querySelector('#cat-size-range');
  const catSizeVal = pageRoot.querySelector('#cat-size-val');
  const catSizeStatus = pageRoot.querySelector('#cat-size-status');
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
  const fullDbBtn = pageRoot.querySelector('#full-db-btn');
  const fullDbStatus = pageRoot.querySelector('#full-db-status');
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
    pageRoot.querySelector('#cat-size-box').style.display = 'none';
    pageRoot.querySelector('#full-db-box').style.display = 'none';
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

  // Историю просмотра разделяем на непросмотренное и отмеченное «Просмотрено».
  const whBox = pageRoot.querySelector('#watch-history');
  const watchedBox = pageRoot.querySelector('#watched-history');
  function paintWatchHistory() {
    const allItems = getWatchHistory();
    const historyItems = allItems.filter(item => !item.done);
    const watchedItems = allItems.filter(item => item.done);
    const positions = getPositions();

    function rowsHtml(items, watched) {
      if (!items.length) return `<p class="text-xs text-gray-600">${watched ? 'Пока ничего не отмечено.' : 'Пока пусто: нажмите «Смотреть» в карточке фильма или сериала.'}</p>`;
      return items.map(i => {
        const pos = positions[i.key];
        const savedSeconds = pos && Number.isFinite(Number(pos.t)) && Number(pos.t) > 0 ? Number(pos.t) : null;
        const savedTime = savedSeconds === null ? null : formatPlaybackTime(savedSeconds);
        const pct = pos && Number(pos.d) > 0 && savedSeconds !== null
          ? Math.min(100, Math.round(savedSeconds / Number(pos.d) * 100)) : null;
        const status = watched
          ? (i.media_type === 'movie'
            ? (i.done.collectionId ? `Следим за новыми частями: ${escapeHtml(i.done.collectionName || 'коллекция TMDb')}` : 'Отмечено просмотренным; коллекция-продолжение в TMDb не указана')
            : 'Следим за новыми сезонами и сериями')
          : `${i.media_type === 'movie' ? 'фильм' : 'сериал'} • ${new Date(i.last_at).toLocaleDateString('ru-RU')}`;
        return `
          <div class="flex items-center gap-3 bg-slate-800/50 rounded-xl p-2" data-key="${escapeHtml(i.key)}">
            <div class="watch-history-open flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" role="button" tabindex="0" aria-label="Открыть карточку: ${escapeHtml(i.title)}">
              ${posterImg(i.poster_path, i.title, 'w-14 sm:w-16 flex-shrink-0 aspect-[2/3] rounded-md')}
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">${escapeHtml(i.title)}</span>
                <span class="block text-[11px] text-gray-500">${status}</span>
                ${watched ? `<span class="block text-[10px] text-gray-600">Отмечено ${new Date(i.done.at).toLocaleDateString('ru-RU')}</span>` : ''}
                ${pct !== null ? `<span class="mt-1 block h-1 overflow-hidden rounded bg-slate-700"><span class="block h-full bg-red-500" style="width:${pct}%"></span></span>` : ''}
                ${savedTime !== null ? `<span class="block text-[10px] text-gray-500">Запомнено: ${savedTime}${pct !== null ? ` · ${pct}%` : ''}</span>` : ''}
              </span>
            </div>
            <div class="flex flex-col gap-1 flex-shrink-0 items-stretch">
              ${(i.kp_url || i.kpId || i.query) ? '<button class="wh-continue px-2 py-1 text-[11px] bg-primary hover:bg-primary/90 text-white rounded-lg">Продолжить</button>' : ''}
              ${watched ? '<button class="wh-unmark px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 text-gray-200 rounded-lg">Снять отметку</button>' : '<button class="wh-done px-2 py-1 text-[11px] bg-slate-700 hover:bg-slate-600 text-gray-200 rounded-lg">Просмотрено</button>'}
              <button class="wh-del px-2 py-1 text-[11px] text-gray-500 hover:text-red-400" aria-label="Убрать из истории">&times;</button>
            </div>
          </div>`;
      }).join('');
    }

    whBox.innerHTML = rowsHtml(historyItems, false);
    watchedBox.innerHTML = rowsHtml(watchedItems, true);

    [whBox, watchedBox].forEach(box => {
      box.querySelectorAll('.watch-history-open').forEach(card => {
        const openHistoryCard = () => {
          const item = getWatchHistory().find(entry => entry.key === card.closest('[data-key]').dataset.key);
          if (!item) return;
          openRatingModal(item.id, item.media_type, currentUser, () => {
            renderProfilePage(document.getElementById('app'), currentUser, { force: true });
          });
        };
        card.addEventListener('click', openHistoryCard);
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openHistoryCard();
          }
        });
      });
      box.querySelectorAll('.wh-continue').forEach(button => button.addEventListener('click', () => {
        const item = getWatchHistory().find(x => x.key === button.closest('[data-key]').dataset.key);
        if (!item || !(item.kp_url || item.kpId || item.query)) return;
        reportWatchNative(item.id, item.media_type);
        if (isApk() && item.kp_url) {
          window.location.href = item.kp_url;
          return;
        }
        openWatchOverlay({ kpId: item.kpId, query: item.query || item.title, titleText: item.title, mirrorUrl: item.kp_url, watchKey: item.key });
      }));
      box.querySelectorAll('.wh-done').forEach(button => button.addEventListener('click', async () => {
        const key = button.closest('[data-key]').dataset.key;
        button.disabled = true;
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
        try {
          const item = await markWatchDone(key);
          if (!item) throw new Error('Запись истории не найдена');
          showToast(item.media_type === 'movie'
            ? (item.done.collectionId ? 'Отмечено. Проверим новые части этой коллекции' : 'Отмечено. Для уведомлений о продолжении нужна коллекция TMDb')
            : 'Отмечено. Проверим новые сезоны и серии', 'success', 5000);
          paintWatchHistory();
        } catch (error) {
          button.disabled = false;
          showToast('Не удалось отметить просмотренным: ' + error.message, 'error', 5000);
        }
      }));
      box.querySelectorAll('.wh-unmark').forEach(button => button.addEventListener('click', () => {
        unmarkWatchDone(button.closest('[data-key]').dataset.key);
        paintWatchHistory();
      }));
      box.querySelectorAll('.wh-del').forEach(button => button.addEventListener('click', () => {
        removeWatchEntry(button.closest('[data-key]').dataset.key);
        paintWatchHistory();
      }));
    });
  }
  paintWatchHistory();

  // Установка на телефон: кнопка системного install-промта либо подсказка
  const installBox = pageRoot.querySelector('#install-box');
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
      pageRoot.querySelector('#install-app-btn').addEventListener('click', async () => {
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
  if (installBoxUpdateHandler) {
    window.removeEventListener('gulrating:installable', installBoxUpdateHandler);
    window.removeEventListener('gulrating:appinstalled', installBoxUpdateHandler);
  }
  installBoxUpdateHandler = paintInstallBox;
  window.addEventListener('gulrating:installable', installBoxUpdateHandler);
  window.addEventListener('gulrating:appinstalled', installBoxUpdateHandler);

  const mergeRatingsToggle = pageRoot.querySelector('#merge-ratings-toggle');
  mergeRatingsToggle.checked = localStorage.getItem('gulrating:merge_title_ratings') === '1';
  mergeRatingsToggle.addEventListener('change', () => {
    localStorage.setItem('gulrating:merge_title_ratings', mergeRatingsToggle.checked ? '1' : '0');
    window.dispatchEvent(new Event('gulrating:merge-ratings-changed'));
    showToast('Настройка объединения оценок сохранена', 'success');
  });

  // Состав и порядок ленты настраиваются только здесь, в профиле.
  const feedLayoutEditor = pageRoot.querySelector('#feed-layout-editor');
  let feedOrder = getFeedOrder();
  let visibleFeedSections = new Set(getVisibleFeedSections());
  function paintFeedLayoutEditor() {
    feedLayoutEditor.innerHTML = feedOrder.map((id, index) => {
      const section = FEED_SECTIONS.find(item => item.id === id);
      if (!section) return '';
      return `
        <div class="flex items-center gap-2 rounded-lg bg-slate-800/70 p-2">
          <span class="w-6 text-center text-xs text-gray-500">${index + 1}</span>
          <label class="flex flex-1 items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" class="feed-section-visible h-4 w-4" data-section="${id}" ${visibleFeedSections.has(id) ? 'checked' : ''}>
            <span>${section.label}</span>
          </label>
          <button class="feed-section-move w-8 h-8 rounded-lg bg-slate-700 text-gray-200 hover:bg-slate-600 disabled:opacity-30" data-section="${id}" data-direction="up" ${index === 0 ? 'disabled' : ''} aria-label="Переместить ${section.label} выше" title="Выше">↑</button>
          <button class="feed-section-move w-8 h-8 rounded-lg bg-slate-700 text-gray-200 hover:bg-slate-600 disabled:opacity-30" data-section="${id}" data-direction="down" ${index === feedOrder.length - 1 ? 'disabled' : ''} aria-label="Переместить ${section.label} ниже" title="Ниже">↓</button>
        </div>`;
    }).join('');

    feedLayoutEditor.querySelectorAll('.feed-section-visible').forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) visibleFeedSections.add(input.dataset.section);
        else visibleFeedSections.delete(input.dataset.section);
        visibleFeedSections = new Set(saveVisibleFeedSections([...visibleFeedSections]));
        window.dispatchEvent(new Event('gulrating:feed-layout-changed'));
        paintFeedLayoutEditor();
        showToast('Состав ленты сохранён', 'success');
      });
    });
    feedLayoutEditor.querySelectorAll('.feed-section-move').forEach(button => {
      button.addEventListener('click', () => {
        const from = feedOrder.indexOf(button.dataset.section);
        const to = from + (button.dataset.direction === 'up' ? -1 : 1);
        if (from < 0 || to < 0 || to >= feedOrder.length) return;
        [feedOrder[from], feedOrder[to]] = [feedOrder[to], feedOrder[from]];
        feedOrder = saveFeedOrder(feedOrder);
        window.dispatchEvent(new Event('gulrating:feed-layout-changed'));
        paintFeedLayoutEditor();
        showToast('Порядок ленты сохранён', 'success');
      });
    });
  }
  paintFeedLayoutEditor();

  // Применяем полную тему и держим состояние кнопок доступным для скринридера.
  const themeOptions = [...pageRoot.querySelectorAll('.theme-option')];
  const paintSelectedTheme = () => {
    const selectedTheme = getThemeId();
    themeOptions.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeId === selectedTheme)));
  };
  themeOptions.forEach(button => button.addEventListener('click', () => {
    const selected = setTheme(button.dataset.themeId);
    paintSelectedTheme();
    const theme = THEMES.find(item => item.id === selected);
    showToast(`Тема «${theme?.name || 'Классическая'}» применена`, 'success');
  }));
  paintSelectedTheme();

  function updateProfileStatus(titleId, mediaType, status) {
    const id = String(titleId);
    const title = myRatingsList.find(item => String(item.title_id) === id)?.titles
      || watchlistList.find(item => String(item.title_id) === id)?.titles
      || titleStatusesList.find(item => String(item.title_id) === id)?.titles;
    watchlistList = watchlistList.filter(item => String(item.title_id) !== id);
    titleStatusesList = titleStatusesList.filter(item => String(item.title_id) !== id);
    statusByTitleId.delete(id);

    if (status === 'watchlist') {
      if (title) watchlistList.unshift({ user_id: currentUser.id, title_id: titleId, created_at: new Date().toISOString(), titles: title });
    } else if (status) {
      const row = { user_id: currentUser.id, title_id: titleId, status, titles: title || { id: titleId, media_type } };
      titleStatusesList.unshift(row);
      statusByTitleId.set(id, status);
    }

    snapshot = { ...snapshot, ratings: myRatingsList, watchlist: watchlistList, titleStatuses: titleStatusesList };
    writeProfileSnapshot(currentUser.id, snapshot);
    const activeTab = pageRoot.querySelector('.tab-btn[aria-selected="true"]')?.dataset.tab || 'watched';
    setActivityTab(activeTab);
    initTitleCards(pageRoot, currentUser, updateProfileStatus);
  }

  function setActivityTab(tab) {
    pageRoot.querySelectorAll('.tab-btn').forEach(button => {
      const selected = button.dataset.tab === tab;
      button.classList.toggle('bg-primary', selected);
      button.classList.toggle('text-white', selected);
      button.classList.toggle('bg-card', !selected);
      button.classList.toggle('hover:bg-slate-700', !selected);
      button.setAttribute('aria-selected', String(selected));
    });
    pageRoot.querySelector('#profile-content').innerHTML = renderProfileStatusTab(
      tab, myRatingsList, watchlistList, titleStatusesList, statusByTitleId, currentUser
    );
  }
  pageRoot.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      setActivityTab(button.dataset.tab);
      initTitleCards(pageRoot, currentUser, updateProfileStatus);
    });
  });
  setActivityTab(previousActivityTab);

  // Обработчики навигации
  pageRoot.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.page === 'feed') {
        const { renderFeed } = await import('./Feed.js');
        renderFeed(document.getElementById('app'), currentUser);
      }
    });
  });

  // Инициализируем клики по карточкам
  initTitleCards(pageRoot, currentUser, updateProfileStatus);

  // Обработчики одобрения пользователей для админа
  if (currentUser.profile.is_admin) {
    pageRoot.querySelectorAll('.approve-user-btn').forEach(btn => {
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
        renderProfilePage(app, currentUser, { force: true });
      });
    });

    pageRoot.querySelectorAll('.user-admin-toggle').forEach(input => {
      input.addEventListener('change', async () => {
        const userId = input.dataset.userId;
        const isAdmin = input.checked;
        input.disabled = true;
        const { error } = await supabase.from('profiles')
          .update({ is_admin: isAdmin }).eq('id', userId);
        if (error) {
          input.checked = input.dataset.original === '1';
          input.disabled = false;
          showToast('Не удалось изменить права: ' + error.message, 'error', 5000);
          return;
        }
        showToast(isAdmin ? 'Права администратора выданы' : 'Права администратора сняты', 'success');
        renderProfilePage(app, currentUser, { force: true });
      });
    });

    pageRoot.querySelectorAll('.revoke-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        btn.disabled = true;
        const { error } = await supabase.from('profiles')
          .update({ is_approved: false }).eq('id', userId);
        if (error) {
          btn.disabled = false;
          showToast('Не удалось отозвать доступ: ' + error.message, 'error', 5000);
          return;
        }
        showToast('Доступ пользователя отозван', 'success');
        renderProfilePage(app, currentUser, { force: true });
      });
    });

    // Экспорт данных
    pageRoot.querySelector('#export-btn').addEventListener('click', async () => {
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

function renderMyRatings(ratings, statusByTitleId, currentUser) {
  if (!ratings || ratings.length === 0) {
    return `
      <div class="col-span-full text-center py-12 text-gray-500">
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
    const savedStatus = statusByTitleId.get(String(title.id));
    const currentTitleStatus = !savedStatus || savedStatus === 'watchlist' ? 'watched' : savedStatus;

    return `
      <div class="title-card bg-card rounded-xl border border-slate-700/50 p-3 flex gap-3 hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}">
        <div class="profile-card-poster flex-shrink-0">
          ${posterImg(title.poster_path, title.title, 'w-full aspect-[2/3] rounded-lg')}
          <label class="mt-1 block">
            <span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-gray-500">Статус</span>
            <select class="profile-status-select w-[112px] min-w-[112px] rounded-lg border border-slate-700 bg-slate-900 px-1 py-1 text-[9px] leading-tight text-gray-200" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}" data-current-status="${escapeHtml(currentTitleStatus)}" data-has-rating="true" aria-label="Статус: ${escapeHtml(title.title)}">
              <option value="" ${!currentTitleStatus ? 'selected' : ''}>Не отмечено</option>
              <option value="watchlist" ${currentTitleStatus === 'watchlist' ? 'selected' : ''} disabled>Хочу посмотреть</option>
              <option value="in_progress" ${currentTitleStatus === 'in_progress' ? 'selected' : ''}>В процессе</option>
              <option value="watched" ${currentTitleStatus === 'watched' ? 'selected' : ''}>Просмотрено</option>
              <option value="dropped" ${currentTitleStatus === 'dropped' ? 'selected' : ''}>Заброшено</option>
            </select>
          </label>
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

function renderProfileStatusTab(tab, ratings, watchlist, titleStatuses, statusByTitleId, currentUser) {
  if (tab === 'watchlist') {
    const ratedIds = new Set((ratings || []).map(row => String(row.title_id)));
    return renderWatchlist((watchlist || []).filter(item => !ratedIds.has(String(item.title_id))), currentUser);
  }

  const ratedTitles = (ratings || []).filter(row => {
    const explicitStatus = statusByTitleId.get(String(row.title_id));
    const status = !explicitStatus || explicitStatus === 'watchlist' ? 'watched' : explicitStatus;
    return status === tab;
  });
  const allRatedIds = new Set((ratings || []).map(row => String(row.title_id)));
  const unratedStatuses = (titleStatuses || []).filter(item =>
    item.status === tab && !allRatedIds.has(String(item.title_id))
  );

  if (!ratedTitles.length && !unratedStatuses.length) {
    const label = PROFILE_ACTIVITY_TABS.find(item => item.id === tab)?.label || 'этот статус';
    return `<div class="col-span-full text-center py-10 text-sm text-gray-500">Нет тайтлов в статусе «${escapeHtml(label)}».</div>`;
  }

  return [
    ratedTitles.length ? renderMyRatings(ratedTitles, statusByTitleId, currentUser) : '',
    unratedStatuses.length ? renderTitleStatuses(unratedStatuses, [], currentUser) : ''
  ].join('');
}

function renderWatchlist(items, currentUser) {
  if (!items || items.length === 0) {
    return `
      <div class="col-span-full text-center py-12 text-gray-500">
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
      <div class="title-card bg-card rounded-xl border border-slate-700/50 p-3 flex gap-3 hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}">
        <div class="profile-card-poster flex-shrink-0">
          ${posterImg(title.poster_path, title.title, 'w-full aspect-[2/3] rounded-lg')}
          <select class="profile-status-select mt-1 w-[112px] min-w-[112px] rounded-lg border border-slate-700 bg-slate-900 px-1 py-1 text-[9px] leading-tight text-gray-200" data-title-id="${escapeHtml(title.id)}" data-media-type="${escapeHtml(title.media_type)}" data-current-status="watchlist" data-has-rating="false" aria-label="Статус: ${escapeHtml(title.title)}">
            <option value="watchlist" selected>Хочу посмотреть</option>
            <option value="in_progress">В процессе</option>
            <option value="watched">Просмотрено</option>
            <option value="dropped">Заброшено</option>
            <option value="">Не отмечено</option>
          </select>
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

function renderTitleStatuses(items, ratings, currentUser) {
  const ratedIds = new Set((ratings || []).map(row => String(row.title_id)));
  const visibleStatuses = (items || []).filter(item => !ratedIds.has(String(item.title_id)) && item.titles);
  if (!visibleStatuses.length) {
    return `<div class="col-span-full text-center py-10 text-sm text-gray-500">Нет тайтлов со статусами «В процессе», «Просмотрено» или «Заброшено» без оценки.</div>`;
  }

  return visibleStatuses.map(item => `
    <div class="title-card bg-card rounded-xl border border-slate-700/50 p-3 flex gap-3 hover:bg-slate-800 transition-colors cursor-pointer" data-title-id="${escapeHtml(item.titles.id)}" data-media-type="${escapeHtml(item.titles.media_type)}">
      <div class="profile-card-poster flex-shrink-0">
        ${posterImg(item.titles.poster_path, item.titles.title, 'w-full aspect-[2/3] rounded-lg')}
        <label class="mt-1 block">
          <span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-gray-500">Статус</span>
          <select class="profile-status-select w-[112px] min-w-[112px] rounded-lg border border-slate-700 bg-slate-900 px-1 py-1 text-[9px] leading-tight text-gray-200" data-title-id="${escapeHtml(item.title_id)}" data-media-type="${escapeHtml(item.titles.media_type)}" data-current-status="${escapeHtml(item.status)}" data-has-rating="false" aria-label="Статус: ${escapeHtml(item.titles.title)}">
            <option value="">Не отмечено</option>
            <option value="watchlist">Хочу посмотреть</option>
            <option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>В процессе</option>
            <option value="watched" ${item.status === 'watched' ? 'selected' : ''}>Просмотрено</option>
            <option value="dropped" ${item.status === 'dropped' ? 'selected' : ''}>Заброшено</option>
          </select>
        </label>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-semibold leading-tight">${escapeHtml(item.titles.title)}</h3>
        <p class="text-sm text-gray-400">${releaseYear(item.titles.release_date)} · ${item.titles.media_type === 'movie' ? 'фильм' : 'сериал'}</p>
      </div>
    </div>
  `).join('');
}

function initTitleCards(pageRoot, currentUser, onStatusUpdated) {
  pageRoot.querySelectorAll('.profile-status-select').forEach(select => {
    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('keydown', event => event.stopPropagation());
    select.addEventListener('change', async event => {
      event.stopPropagation();
      const titleId = select.dataset.titleId;
      const mediaType = select.dataset.mediaType;
      const nextStatus = select.value;
      const previousStatus = select.dataset.currentStatus || '';
      const actualStatus = nextStatus || (select.dataset.hasRating === 'true' ? 'watched' : '');
      const isOffline = currentUser.offlineOnly || (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (isOffline) {
        try {
          queueUserTitleStatus(currentUser.id, titleId, mediaType, nextStatus);
          select.dataset.currentStatus = actualStatus;
          onStatusUpdated?.(titleId, mediaType, actualStatus);
          showToast('Статус сохранён на устройстве и синхронизируется при подключении', 'info', 4500);
        } catch (error) {
          select.value = previousStatus;
          showToast(`Не удалось сохранить статус на устройстве: ${error.message}`, 'error', 5000);
        }
        return;
      }
      select.disabled = true;
      select.dataset.currentStatus = actualStatus;
      const setMatchingSelectsDisabled = disabled => pageRoot.querySelectorAll('.profile-status-select').forEach(item => {
        if (item.dataset.titleId === String(titleId)) item.disabled = disabled;
      });
      onStatusUpdated?.(titleId, mediaType, actualStatus);
      setMatchingSelectsDisabled(true);
      try {
        await setUserTitleStatus(currentUser.id, titleId, mediaType, nextStatus);
        const labels = { watchlist: 'Хочу посмотреть', in_progress: 'В процессе', watched: 'Просмотрено', dropped: 'Заброшено', '': 'Не отмечено' };
        showToast(`Статус: ${labels[actualStatus] || labels['']}`, 'success');
        setMatchingSelectsDisabled(false);
      } catch (error) {
        const rollbackStatus = previousStatus || (select.dataset.hasRating === 'true' ? 'watched' : '');
        select.value = rollbackStatus;
        select.dataset.currentStatus = rollbackStatus;
        onStatusUpdated?.(titleId, mediaType, rollbackStatus);
        setMatchingSelectsDisabled(false);
        showToast(`Не удалось изменить статус: ${error.message}`, 'error', 5000);
      }
    });
  });

  pageRoot.querySelectorAll('.title-card').forEach(card => {
    card.addEventListener('click', () => {
      const titleId = card.dataset.titleId;
      const mediaType = card.dataset.mediaType;
      openRatingModal(titleId, mediaType, currentUser, (appEl) => {
        // Перерисовываем профиль, чтобы обновилась статистика (без полной перезагрузки)
        renderProfilePage(document.getElementById('app'), currentUser, { force: true });
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
