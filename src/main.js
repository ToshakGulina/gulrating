import { supabase, getCurrentUser } from './lib/supabase.js';
import { syncOfflineCatalog, isAppContext } from './lib/offlineCatalog.js';
import { checkNewSeasons } from './lib/watchHistory.js';
import { configIsComplete, APP_BUILD } from './config.js';
import { setSyncUser, syncUserData } from './lib/userSync.js';
import { activePageKey, clearPageState } from './lib/pageState.js';
import { applyTheme, getThemeId } from './lib/theme.js';
import { installButtonRipple } from './lib/buttonRipple.js';
import { installHorizontalOverflowFit } from './lib/horizontalOverflow.js';
import { installDotMatrixHeadings } from './lib/dotMatrix.js';
import { installAppMotion } from './lib/motion.js';

// Метка сборки в консоли: помогает понять, какая версия кода работает в браузере
// Тема из локальных настроек применяется до первой отрисовки.
applyTheme(getThemeId());
installButtonRipple();
installHorizontalOverflowFit();
installDotMatrixHeadings();
installAppMotion();

console.info(`🎬 ГульРейтинг — сборка ${APP_BUILD}`);
import { showToast } from './lib/dom.js';
import { renderAuthPage, openRecoveryPasswordModal } from './components/Auth.js';
import { renderFeed, cleanupFeed } from './components/Feed.js';
import { renderAccessDenied } from './components/AccessDenied.js';
import { renderSetupPage, renderFatalError, renderProfileMissing } from './components/Setup.js';

const app = document.getElementById('app');
window.addEventListener('gulrating:sync-not-configured', () => {
  showToast('Для синхронизации выполните supabase-user-sync.sql в Supabase → SQL Editor.', 'info', 9000);
});
window.addEventListener('gulrating:sync-restored', () => {
  if (offlineOnlySession) renderApp();
});
window.addEventListener('gulrating:network-restored', () => {
  if (offlineOnlySession) renderApp();
});

// Установка на устройство (Android/iOS): браузер отдаёт событие установки
// один раз — сохраняем его и показываем кнопку в профиле
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__gulratingInstallPrompt = e;
  window.dispatchEvent(new Event('gulrating:installable'));
});
window.addEventListener('appinstalled', () => {
  window.__gulratingInstallPrompt = null;
  showToast('Приложение установлено на устройство', 'success');
  window.dispatchEvent(new Event('gulrating:appinstalled'));
});

let rendering = false;
let offlineOnlySession = false;
let onlineRefreshPending = false;
let networkWasOffline = false;
let renderedAuthUserSignature = null;

function authUserSignature(user) {
  if (!user) return null;
  return JSON.stringify([
    user.id,
    user.email || '',
    user.phone || '',
    user.user_metadata || {},
    user.app_metadata || {},
  ]);
}

// Сеть пропала/вернулась: интерфейс живёт из кэша, объясняем состояние
window.addEventListener('offline', () => {
  networkWasOffline = true;
  showToast('Нет сети: интерфейс из кэша, данные обновятся при появлении интернета', 'info', 4000);
});
window.addEventListener('online', () => {
  const genuinelyReconnected = networkWasOffline || offlineOnlySession;
  networkWasOffline = false;
  if (genuinelyReconnected) {
    showToast('Снова в сети', 'success', 2000);
    checkNewSeasons().catch(() => {});
    if (!offlineOnlySession) getCurrentUser().then(user => {
      syncQueuedTitleStatuses(user);
      syncQueuedPlaybackRatings(user);
    }).catch(() => {});
  }
  // Полная перерисовка ленты здесь сбрасывала видимый экран и запускала
  // анимации заново при возврате во вкладку. Обновляем приложение только
  // если оно действительно было запущено без сети.
  if (rendering) onlineRefreshPending = true;
  else if (offlineOnlySession) renderApp();
  // Дозакачиваем офлайн-базу фильмов (только в приложении)
  if (isAppContext()) syncOfflineCatalog().catch(() => {});
});

function syncQueuedTitleStatuses(user) {
  if (!user || user.offlineOnly) return;
  import('./lib/ratings.js')
    .then(({ syncPendingTitleStatuses }) => syncPendingTitleStatuses(user.id))
    .then(count => {
      if (count) showToast(`Синхронизировано статусов: ${count}`, 'success', 2500);
    })
    .catch(() => {});
}

function syncQueuedPlaybackRatings(user) {
  if (!user || user.offlineOnly || navigator.onLine === false) return;
  import('./lib/episodeRatings.js')
    .then(async ({ syncPendingEpisodeRatings, syncNativePlaybackRatings }) => {
      const counts = await Promise.all([
        syncPendingEpisodeRatings(user.id),
        syncNativePlaybackRatings(user.id),
      ]);
      const total = counts.reduce((sum, count) => sum + Number(count || 0), 0);
      if (total) showToast(`Синхронизированы оценки после просмотра: ${total}`, 'success', 3000);
    })
    .catch(() => {});
}

function hideSplash() {
  const html = document.documentElement;
  if (html.classList.contains('skip-entry-motion')) {
    // Не дать отключённым на время загрузки CSS-анимациям стартовать заново
    // именно в момент снятия временного класса; новые элементы оживут штатно.
    document.querySelectorAll(
      '#app:not(:empty), #blocks-wrap > *, #ratings-list > .title-card, #trends-grid > .rec-card, .profile-section-panel:not(.hidden), .rating-modal-panel, .fixed.inset-0:not(#boot-splash), #search-results:not(.hidden), nav.fixed, #toast-container > *'
    ).forEach((element) => { element.style.animation = 'none'; });
    html.classList.remove('skip-entry-motion');
  }
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.classList.contains('splash-leaving')) return;
  splash.classList.add('splash-leaving');
  // Keep a fallback for browsers that do not dispatch animationend.
  setTimeout(() => splash.remove(), 220);
}

async function renderApp() {
  // Защита от параллельных перерисовок (события авторизации могут прийти пачкой)
  if (rendering) return;
  rendering = true;
  try {
    const currentUser = await getCurrentUser();
    syncQueuedTitleStatuses(currentUser);
    syncQueuedPlaybackRatings(currentUser);
    renderedAuthUserSignature = authUserSignature(currentUser);
    offlineOnlySession = Boolean(currentUser && currentUser.offlineOnly);
    setSyncUser(currentUser);
    if (currentUser) {
      // Pull/merge запускается в фоне; при сбое userSync делает автоматические
      // повторы с увеличивающимся интервалом. Экран не ждёт завершения запроса.
      syncUserData(currentUser, 5000)
        .then(() => applyTheme(getThemeId()))
        .catch(() => {});
      applyTheme(getThemeId());
    }

    if (!currentUser) {
      cleanupFeed();
      clearPageState(app);
      renderAuthPage(app);
    } else if (!currentUser.profile) {
      // Вошли, но профиля в базе нет: не запущен supabase-schema.sql
      // или аккаунт создан до запуска схемы
      cleanupFeed();
      clearPageState(app);
      renderProfileMissing(app, currentUser);
    } else if (!currentUser.profile.is_approved) {
      cleanupFeed();
      clearPageState(app);
      renderAccessDenied(app);
    } else {
      if (activePageKey(app) === 'profile') {
        const { renderProfilePage } = await import('./components/Profile.js');
        await renderProfilePage(app, currentUser);
      } else {
        await renderFeed(app, currentUser, { refresh: activePageKey(app) === 'feed' });
      }
      await handleDeepLink(currentUser);
    }
  } catch (e) {
    cleanupFeed();
    clearPageState(app);
    renderFatalError(app, e);
  } finally {
    rendering = false;
    hideSplash();
    if (onlineRefreshPending) {
      onlineRefreshPending = false;
      // Если онлайн восстановился во время определения сессии, повторяем
      // загрузку только для офлайн-профиля — без лишнего рендера обычного входа.
      if (offlineOnlySession) queueMicrotask(() => renderApp());
    }
  }
}

// Ссылка из Телеграм-бота (?title=movie:123): открываем карточку тайтла
// поверх ленты. Параметр съедаем сразу, чтобы повторные рендеры не
// открывали модалку заново.
async function handleDeepLink(currentUser) {
  const params = new URLSearchParams(location.search);
  const ref = params.get('title');
  if (!ref) return;
  const m = /^(movie|tv):(\d+)$/.exec(ref);
  history.replaceState(null, '', location.pathname + location.hash);
  if (!m) return;
  const { openRatingModal } = await import('./components/RatingModal.js');
  openRatingModal(m[2], m[1], currentUser, () => renderApp());
}

async function init() {
  // Ключи не заполнены — показываем понятную инструкцию вместо падения
  if (!configIsComplete() || !supabase) {
    renderSetupPage(app);
    hideSplash();
    return;
  }

  // Реагируем на вход/выход (в том числе на возврат по магической ссылке)
  supabase.auth.onAuthStateChange((event, session) => {
    const nextSignature = authUserSignature(session && session.user);
    if (event === 'SIGNED_IN') {
      // Supabase пересылает auth-события между вкладками. Повторный SIGNED_IN
      // того же аккаунта не должен заново собирать экран и мигать лентой.
      if (nextSignature !== renderedAuthUserSignature) renderApp();
    } else if (event === 'SIGNED_OUT') {
      if (renderedAuthUserSignature !== null) renderApp();
    } else if (event === 'USER_UPDATED') {
      if (nextSignature !== renderedAuthUserSignature) renderApp();
    } else if (event === 'PASSWORD_RECOVERY') {
      // Вход по ссылке восстановления: перерисовываем app и сразу просим задать пароль
      renderApp();
      openRecoveryPasswordModal();
    }
  });

  await renderApp();

  // Фоновая закачка офлайн-базы фильмов (resume-able, не блокирует интерфейс).
  // Только в приложении: десктоп-сайту офлайн-база не нужна
  if (isAppContext()) syncOfflineCatalog().catch(() => {});

  // Досмотренные сериалы: вышел новый сезон/серии — уведомление (троттлинг внутри)
  checkNewSeasons({ offlineOnly: offlineOnlySession }).catch(() => {});

  // Обновление сайта не прерывает текущую сессию: новая версия кода
  // активируется после закрытия вкладок и будет доступна при следующем запуске.
}

init();
