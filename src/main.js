import { supabase, getCurrentUser } from './lib/supabase.js';
import { configIsComplete } from './config.js';
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
      cleanupFeed();
      renderProfileMissing(app);
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
}

init();
