import { supabase, getCurrentUser } from './lib/supabase.js';
import { renderAuthPage } from './components/Auth.js';
import { renderFeed } from './components/Feed.js';
import { renderAccessDenied } from './components/AccessDenied.js';

const app = document.getElementById('app');

async function init() {
  // Проверяем авторизацию
  let currentUser = await getCurrentUser();

  // Если сессия в URL после входа по почте - обрабатываем её
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      currentUser = await getCurrentUser();
      renderApp();
    }
  });

  renderApp();

  async function renderApp() {
    if (!currentUser) {
      // Пользователь не авторизован - показываем страницу входа
      renderAuthPage(app);
    } else if (!currentUser.profile.is_approved) {
      // Пользователь авторизован но еще не одобрен админом
      renderAccessDenied(app);
    } else {
      // Пользователь авторизован и одобрен - показываем основной интерфейс
      await renderFeed(app, currentUser);
    }
  }
}

init();
