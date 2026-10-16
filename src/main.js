import { supabase, getCurrentUser } from './lib/supabase.js';
import { syncOfflineCatalog, isAppContext } from './lib/offlineCatalog.js';
import { checkNewSeasons } from './lib/watchHistory.js';
import { configIsComplete, APP_BUILD } from './config.js';
import { setSyncUser, syncUserData } from './lib/userSync.js';

// Метка сборки в консоли: помогает понять, какая версия кода работает в браузере
// Акцент интерфейса из настроек профиля применяем до первой отрисовки
try {
  const accent = localStorage.getItem('gulrating:accent');
  if (accent) document.documentElement.style.setProperty('--p-rgb', accent);
} catch (e) { /* приватный режим и т.п. */ }

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

// Сеть пропала/вернулась: интерфейс живёт из кэша, объясняем состояние
window.addEventListener('offline', () => {
  showToast('Нет сети: интерфейс из кэша, данные обновятся при появлении интернета', 'info', 4000);
});
window.addEventListener('online', () => {
  showToast('Снова в сети', 'success', 2000);
  // Обновляем сессию/профиль с сервера после локального офлайн-старта.
  renderApp();
  // Дозакачиваем офлайн-базу фильмов (только в приложении)
  if (isAppContext()) syncOfflineCatalog().catch(() => {});
});

function hideSplash() {
  const splash = document.getElementById('boot-splash');
  if (splash) splash.remove();
}

let rendering = false;

async function renderApp() {
  // Защита от параллельных перерисовок (события авторизации могут прийти пачкой)
  if (rendering) return;
  rendering = true;
  try {
    const currentUser = await getCurrentUser();
    setSyncUser(currentUser);
    if (currentUser) {
      // Быстрый pull/merge настроек на старте; таймаут не должен блокировать
      // офлайн-вход. Неудача остаётся локально и повторится при сети/изменениях.
      await syncUserData(currentUser, 1600);
    }

    if (!currentUser) {
      cleanupFeed();
      renderAuthPage(app);
    } else if (!currentUser.profile) {
      // Вошли, но профиля в базе нет: не запущен supabase-schema.sql
      // или аккаунт создан до запуска схемы
      cleanupFeed();
      renderProfileMissing(app, currentUser);
    } else if (!currentUser.profile.is_approved) {
      cleanupFeed();
      renderAccessDenied(app);
    } else {
      await renderFeed(app, currentUser);
      await handleDeepLink(currentUser);
    }
  } catch (e) {
    cleanupFeed();
    renderFatalError(app, e);
  } finally {
    rendering = false;
    hideSplash();
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
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      renderApp();
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
  checkNewSeasons().catch(() => {});

  // Интерфейс отдаётся из кэша мгновенно (sw.js), а здесь фоном проверяем,
  // не появился ли новый деплой: если сборка отличается — ненавязчивый тост
  setTimeout(() => {
    fetch('/src/config.js?build-check=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        const m = text.match(/APP_BUILD\s*=\s*"([^"]+)"/);
        if (m && m[1] && m[1] !== APP_BUILD) {
          showToast('Доступна новая версия сайта — обновите страницу', 'info', 8000);
        }
      })
      .catch(() => {});
  }, 4000);
}

init();
