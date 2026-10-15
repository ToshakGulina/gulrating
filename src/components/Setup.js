import { missingConfigFields, saveLocalAnonKey, clearLocalAnonKey } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { escapeHtml, showToast } from '../lib/dom.js';

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
  const canPasteAnon = missing.includes('SUPABASE_ANON_KEY');
  app.innerHTML = shell(`
    <h2 class="text-lg font-semibold mb-3">⚙️ Приложение не настроено</h2>
    <p class="text-gray-300 mb-4">Не заполнены ключи:</p>
    <ul class="list-disc pl-5 space-y-1 mb-4 text-gray-200">
      ${missing.map(f => `<li><code class="bg-slate-800 px-1.5 py-0.5 rounded">${escapeHtml(f)}</code></li>`).join('')}
    </ul>

    ${canPasteAnon ? `
      <div class="bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-4">
        <p class="text-gray-300 mb-2 font-medium">Быстрый способ: вставить anon key прямо здесь</p>
        <p class="text-gray-500 text-xs mb-3">Ключ сохранится только в этом браузере (localStorage) — удобно для проверки. Чтобы приложение работало у всех друзей без настроек, впишите ключ в файл <code class="bg-slate-800 px-1 py-0.5 rounded">src/config.js</code> и задеплойте снова.</p>
        <textarea id="anon-key-input" rows="3" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
          class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-600 text-xs font-mono mb-2"></textarea>
        <div class="flex gap-2">
          <button id="save-anon-btn" class="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2 rounded-lg text-sm">Сохранить и запустить</button>
          <button id="clear-anon-btn" class="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-gray-300" title="Убрать сохранённый в браузере ключ">Сброс</button>
        </div>
        <p class="text-gray-500 text-xs mt-2">Где взять: Supabase → Settings → API → <b class="text-gray-400">anon public</b>.</p>
      </div>
    ` : ''}

    <p class="text-gray-400 mb-2">Или заполнить вручную в <code class="bg-slate-800 px-1.5 py-0.5 rounded">src/config.js</code>:</p>
    <ul class="list-disc pl-5 space-y-1 text-gray-400 mb-4">
      <li><b class="text-gray-300">SUPABASE_URL</b> и <b class="text-gray-300">SUPABASE_ANON_KEY</b> — Supabase → Settings → API (Project URL и anon public key).</li>
      <li><b class="text-gray-300">TMDB_API_KEY</b> — themoviedb.org → Настройки → API → API Key (v3 auth).</li>
    </ul>
    <button onclick="location.reload()" class="w-full mt-1 bg-slate-800 hover:bg-slate-700 text-gray-200 font-semibold py-2.5 rounded-xl">Обновить страницу</button>
  `);

  const saveBtn = document.getElementById('save-anon-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const value = document.getElementById('anon-key-input').value.trim();
      if (value.length < 20) {
        showToast('Похоже, ключ вставлен не полностью', 'error');
        return;
      }
      saveLocalAnonKey(value);
      location.reload();
    });
    document.getElementById('clear-anon-btn').addEventListener('click', () => {
      clearLocalAnonKey();
      location.reload();
    });
  }
}

// Профиль пользователя не найден в базе — скорее всего не запущен supabase-schema.sql
// или аккаунт был создан ДО запуска схемы (триггер на старых пользователей не действует).
export function renderProfileMissing(app, currentUser) {
  app.innerHTML = shell(`
    <h2 class="text-lg font-semibold mb-3">🧩 Профиль не создан</h2>
    <p class="text-gray-300 mb-3">Вы вошли по почте, но в базе данных нет вашего профиля. Чаще всего это значит одно из двух:</p>
    <ul class="list-disc pl-5 space-y-1 text-gray-400 mb-4">
      <li>в Supabase ещё не запущен скрипт <code class="bg-slate-800 px-1.5 py-0.5 rounded">supabase-schema.sql</code> — он создаёт таблицы и триггер, который автоматически создаёт профиль при регистрации;</li>
      <li>или ваш аккаунт появился <b class="text-gray-300">раньше</b>, чем схема была запущена, — триггер на уже существующих пользователей не действует.</li>
    </ul>

    <button id="create-profile-btn" class="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-xl mb-3">
      Создать мой профиль сейчас
    </button>
    <p class="text-gray-500 text-xs mb-4">Кнопка работает, если схема уже запущена: она создаст вашу строку в таблице profiles (первый пользователь в пустой базе станет администратором). Если схема не запущена — сначала выполните шаг ниже.</p>

    <p class="text-gray-400 mb-2">Если кнопка не помогла — вручную в Supabase → SQL Editor:</p>
    <ol class="list-decimal pl-5 space-y-1 text-gray-400 mb-4">
      <li>Вставьте содержимое файла <code class="bg-slate-800 px-1.5 py-0.5 rounded">supabase-schema.sql</code> и нажмите Run (повторный запуск безопасен).</li>
      <li>Для аккаунтов, созданных до схемы, выполните: <code class="bg-slate-800 px-1.5 py-0.5 rounded">SELECT public.repair_missing_profiles();</code></li>
      <li>Вернитесь сюда и нажмите «Обновить».</li>
    </ol>
    <div class="flex gap-2">
      <button onclick="location.reload()" class="flex-1 bg-primary hover:bg-primary/90 text-white font-semibold py-2.5 rounded-xl">Обновить</button>
      <button id="missing-logout" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl">Выйти</button>
    </div>
  `);

  document.getElementById('missing-logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  const btn = document.getElementById('create-profile-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Создаём...';

    const base = String(currentUser?.email || 'user').split('@')[0] || 'user';
    // Попытки по очереди: 1) первый пользователь пустой базы (станет админом),
    // 2) обычный неодобренный профиль, 3) то же имя с суффиксом, если занято.
    const attempts = [
      { username: base, is_admin: true, is_approved: true },
      { username: base, is_admin: false, is_approved: false },
      { username: `${base}-${Math.floor(100 + Math.random() * 900)}`, is_admin: false, is_approved: false },
    ];

    let lastError = null;
    for (const payload of attempts) {
      const { error } = await supabase
        .from('profiles')
        .insert({ id: currentUser.id, ...payload });
      if (!error) {
        showToast('Профиль создан! Обновляем страницу...', 'success');
        setTimeout(() => location.reload(), 700);
        return;
      }
      lastError = error;
      // 42501 — политика RLS не пустила (не первый пользователь или схема старая),
      // 23505 — имя уже занято: пробуем следующий вариант
      if (error.code === '42501' || error.code === '23505') continue;
      break;
    }

    showToast('Не удалось создать профиль: ' + (lastError?.message || 'неизвестная ошибка') + '. Выполните шаги ниже вручную.', 'error', 8000);
    btn.disabled = false;
    btn.textContent = 'Создать мой профиль сейчас';
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
