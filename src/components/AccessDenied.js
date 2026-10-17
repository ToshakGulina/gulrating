import { supabase } from '../lib/supabase.js';

export function renderAccessDenied(app) {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-dark to-slate-900">
      <div class="w-full max-w-md text-center">
        <div class="text-5xl mb-4">🔒</div>
        <h1 class="text-2xl font-bold mb-3">Доступ ожидает подтверждения</h1>
        <p class="text-gray-400 mb-6">Ваш аккаунт зарегистрирован, но доступ еще не одобрен администратором. Напишите ему, чтобы он добавил вас.</p>
        <p class="text-xs text-gray-500 mb-4">После одобрения просто обновите эту страницу.</p>
        <div class="flex gap-2 justify-center">
          <button id="refresh-btn" class="bg-primary hover:bg-primary/90 text-white font-semibold py-2 px-6 rounded-xl">Обновить</button>
          <button id="logout-btn" class="bg-slate-800 hover:bg-slate-700 text-gray-300 font-semibold py-2 px-6 rounded-xl">Выйти</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
  });
}
