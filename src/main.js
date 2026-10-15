import { supabase, getCurrentUser } from './lib/supabase.js';
import { configIsComplete, APP_BUILD } from './config.js';

// Метка сборки в консоли: помогает понять, какая версия кода работает в браузере
// Акцент интерфейса из настроек профиля применяем до первой отрисовки
try {
  const accent = localStorage.getItem('gulrating:accent');
  if (accent) document.documentElement.style.setProperty('--p-rgb', accent);
} catch (e) { /* приватный режим и т.п. */ }

console.info(`🎬 ГульРейтинг — сборка ${APP_BUILD}`);
import { showToast } from './lib/dom.js';
import { renderAuthPage } from './components/Auth.js';
import { renderFeed, cleanupFeed } from './components/Feed.js';
import { renderAccessDenied } from './components/AccessDenied.js';
import { renderSetupPage, renderFatalError, renderProfileMissing } from './components/Setup.js';

const app = document.getElementById('app');

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
    }
  } catch (e) {
    cleanupFeed();
    renderFatalError(app, e);
  } finally {
    rendering = false;
    hideSplash();
  }
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
    }
  });

  await renderApp();

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
