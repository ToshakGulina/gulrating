import { supabase } from '../lib/supabase.js';

export function renderAuthPage(app) {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-dark to-slate-900">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="text-5xl mb-4">🎬</div>
          <h1 class="text-3xl font-bold mb-2 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">Кино для друзей</h1>
          <p class="text-gray-400">Оценивайте фильмы и смотрите оценки друзей</p>
        </div>
        
        <div class="bg-card rounded-2xl p-6 shadow-xl">
          <div id="auth-form-container">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">Email</label>
                <input type="email" id="email-input" placeholder="your@email.com" 
                  class="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
              </div>
              
              <button id="login-btn" class="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 px-4 rounded-xl transition-all transform hover:scale-[1.02]">
                Войти
              </button>
              
              <p class="text-xs text-gray-500 text-center">
                При первом входе вы получите ссылку для входа на почту. После этого администратор одобрит ваш доступ.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('email-input').value.trim();
    if (!email) return;

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'Отправляем ссылку...';

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      }
    });

    if (error) {
      alert('Ошибка: ' + error.message);
      btn.disabled = false;
      btn.textContent = 'Войти';
      return;
    }

    document.getElementById('auth-form-container').innerHTML = `
      <div class="text-center py-6">
        <div class="text-4xl mb-3">📧</div>
        <h3 class="text-xl font-semibold mb-2">Ссылка отправлена!</h3>
        <p class="text-gray-400 mb-4">Проверьте почту и перейдите по ссылке для входа</p>
        <p class="text-xs text-gray-500">После входа вернитесь на эту страницу</p>
      </div>
    `;
  });
}
