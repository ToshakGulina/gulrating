import { missingConfigFields } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { escapeHtml } from '../lib/dom.js';

function shell(inner) {
  return `
    <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-dark to-slate-900">
      <div class="w-full max-w-lg">
        <div class="text-center mb-6">
          <div class="text-5xl mb-4">🎬</div>
          <h1 class="text-2xl font-bold mb-2 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">Кино для друзей</h1>
        </div>
        <div class="bg-card rounded-2xl p-6 shadow-xl text-sm leading-relaxed">
          ${inner}
        </div>
      </div>
    </div>
  `;
}

// Экран-подсказка: в src/config.js не заполнены ключи
export function renderSetupPage(app) {
  const missing = missingConfigFields();
  app.innerHTML = shell(`
    <h2 class="text-lg font-semibold mb-3">⚙️ Приложение не настроено</h2>
    <p class="text-gray-300 mb-4">В файле <code class="bg-slate-800 px-1.5 py-0.5 rounded">src/config.js</code> не заполнены ключи:</p>
    <ul class="list-disc pl-5 space-y-1 mb-4 text-gray-200">
      ${missing.map(f => `<li><code class="bg-slate-800 px-1.5 py-0.5 rounded">${escapeHtml(f)}</code></li>`).join('')}
    </ul>
    <p class="text-gray-400 mb-2">Где их взять:</p>
    <ul class="list-disc pl-5 space-y-1 text-gray-400 mb-4">
      <li><b class="text-gray-300">SUPABASE_URL</b> и <b class="text-gray-300">SUPABASE_ANON_KEY</b> — Supabase → Settings → API (Project URL и anon public key).</li>
      <li><b class="text-gray-300">TMDB_API_KEY</b> — themoviedb.org → Настройки → API → API Key (v3 auth).</li>
    </ul>
    <p class="text-gray-400">После того как вставите ключи, обновите эту страницу.</p>
    <button onclick="location.reload()" class="w-full mt-4 bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-xl">Обновить страницу</button>
  `);
}

// Профиль пользователя не найден в базе — скорее всего не запущен supabase-schema.sql
export function renderProfileMissing(app) {
  app.innerHTML = shell(`
    <h2 class="text-lg font-semibold mb-3">🧩 Профиль не создан</h2>
    <p class="text-gray-300 mb-3">Вы вошли по почте, но в базе данных нет вашего профиля. Обычно это значит, что в Supabase ещё не запущен скрипт <code class="bg-slate-800 px-1.5 py-0.5 rounded">supabase-schema.sql</code> — именно он создаёт таблицы и триггер, который автоматически создаёт профиль при регистрации.</p>
    <ol class="list-decimal pl-5 space-y-1 text-gray-400 mb-4">
      <li>Откройте Supabase → SQL Editor → New query.</li>
      <li>Вставьте содержимое файла <code class="bg-slate-800 px-1.5 py-0.5 rounded">supabase-schema.sql</code> и нажмите Run.</li>
      <li>Вернитесь сюда и нажмите «Обновить».</li>
    </ol>
    <p class="text-gray-500 text-xs mb-4">Если скрипт уже запускался, а профиль всё равно не создался (например, аккаунт появился до запуска скрипта) — создайте строку в таблице profiles вручную или перерегистрируйтесь.</p>
    <div class="flex gap-2">
      <button onclick="location.reload()" class="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-xl">Обновить</button>
      <button id="missing-logout" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl">Выйти</button>
    </div>
  `);
  document.getElementById('missing-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}

// Фатальная ошибка запуска — показываем её вместо белого экрана
export function renderFatalError(app, error) {
  const message = error && error.message ? error.message : String(error);
  app.innerHTML = shell(`
    <h2 class="text-lg font-semibold mb-3 text-red-400">💥 Ошибка запуска</h2>
    <p class="text-gray-300 mb-3">Приложение не смогло подключиться к базе данных:</p>
    <pre class="bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-red-300 whitespace-pre-wrap mb-4">${escapeHtml(message)}</pre>
    <p class="text-gray-400 mb-4">Частые причины: не запущен <code class="bg-slate-800 px-1.5 py-0.5 rounded">supabase-schema.sql</code>, неверные ключи в <code class="bg-slate-800 px-1.5 py-0.5 rounded">src/config.js</code>, нет интернета или адрес сайта не добавлен в Redirect URLs в Supabase.</p>
    <button onclick="location.reload()" class="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-xl">Попробовать снова</button>
  `);
}
