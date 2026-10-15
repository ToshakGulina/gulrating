export function renderAccessDenied(app) {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-dark to-slate-900">
      <div class="w-full max-w-md text-center">
        <div class="text-5xl mb-4">🔒</div>
        <h1 class="text-2xl font-bold mb-3">Доступ ожидает подтверждения</h1>
        <p class="text-gray-400 mb-6">Ваш аккаунт зарегистрирован, но доступ еще не одобрен администратором. Напишите ему, чтобы он добавил вас.</p>
        <p class="text-xs text-gray-500 mb-4">После одобрения просто обновите эту страницу.</p>
        <button id="refresh-btn" class="bg-primary hover:bg-primary/90 text-white font-semibold py-2 px-6 rounded-xl">Обновить</button>
      </div>
    </div>
  `;

  document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
}
