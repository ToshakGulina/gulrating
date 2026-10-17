import { supabase } from '../lib/supabase.js';
import { showToast } from '../lib/dom.js';

// Экран входа: пароль по умолчанию (сайт запоминает вход в браузере),
// магическая ссылка на почту — запасной вариант.
export function renderAuthPage(app) {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-dark to-slate-900">
      <div class="w-full max-w-md">
        <div class="text-center mb-6">
          <div class="text-4xl mb-3">🎬</div>
          <h1 class="text-3xl font-bold mb-2 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">ГульРейтинг</h1>
          <p class="text-gray-400">Оценки фильмов и сериалов вместе с друзьями</p>
        </div>

        <div class="bg-card rounded-xl border border-slate-700/60 p-5 shadow-xl">
          <div class="flex rounded-xl bg-slate-800 p-1 mb-4 text-sm font-medium">
            <button id="tab-password" class="flex-1 py-2 rounded-lg bg-primary text-white">Пароль</button>
            <button id="tab-otp" class="flex-1 py-2 rounded-lg text-gray-400">Ссылка на почту</button>
          </div>

          <div id="auth-form-container">
            <div class="space-y-3">
              <div id="name-row" class="hidden">
                <label class="block text-sm font-medium text-gray-300 mb-1.5" for="name-input">Имя (как видеть друзьям)</label>
                <input type="text" id="name-input" placeholder="Например, Антон" autocomplete="nickname"
                  class="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1.5" for="email-input">Email</label>
                <input type="email" id="email-input" placeholder="your@email.com" autocomplete="email"
                  class="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
              </div>
              <div id="pass-row">
                <label class="block text-sm font-medium text-gray-300 mb-1.5" for="pass-input">Пароль</label>
                <input type="password" id="pass-input" placeholder="Минимум 6 символов" autocomplete="current-password"
                  class="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
              </div>

              <button id="login-btn" class="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 px-4 rounded-xl transition-all transform hover:scale-[1.02]">
                Войти
              </button>

              <p id="forgot-row" class="text-xs text-center">
                <button id="forgot-btn" class="text-gray-400 hover:underline">Забыли пароль или не задавали его? Прислать письмо</button>
              </p>

              <p class="text-xs text-center">
                <button id="switch-btn" class="text-primary hover:underline">Нет аккаунта? Создать</button>
              </p>
              <p id="auth-hint" class="text-xs text-gray-500 text-center">
                Сайт запоминает вход в этом браузере — повторно вводить пароль не придётся.
                Новых участников одобряет администратор.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const nameRow = document.getElementById('name-row');
  const nameInput = document.getElementById('name-input');
  const passRow = document.getElementById('pass-row');
  const passInput = document.getElementById('pass-input');
  const input = document.getElementById('email-input');
  const btn = document.getElementById('login-btn');
  const switchBtn = document.getElementById('switch-btn');
  const forgotRow = document.getElementById('forgot-row');
  const forgotBtn = document.getElementById('forgot-btn');
  const hint = document.getElementById('auth-hint');
  const tabPassword = document.getElementById('tab-password');
  const tabOtp = document.getElementById('tab-otp');

  // mode: 'password' | 'otp'; signup — режим регистрации внутри 'password'
  let mode = 'password';
  let signup = false;

  function repaint() {
    const passActive = mode === 'password';
    tabPassword.className = 'flex-1 py-2 rounded-lg ' + (passActive ? 'bg-primary text-white' : 'text-gray-400');
    tabOtp.className = 'flex-1 py-2 rounded-lg ' + (!passActive ? 'bg-primary text-white' : 'text-gray-400');
    passRow.classList.toggle('hidden', !passActive);
    nameRow.classList.toggle('hidden', !(passActive && signup));
    switchBtn.classList.toggle('hidden', !passActive);
    forgotRow.classList.toggle('hidden', !(passActive && !signup));
    passInput.autocomplete = signup ? 'new-password' : 'current-password';
    if (passActive) {
      btn.textContent = signup ? 'Создать аккаунт' : 'Войти';
      switchBtn.textContent = signup ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать';
      hint.textContent = 'Сайт запоминает вход в этом браузере — повторно вводить пароль не придётся. Новых участников одобряет администратор.';
    } else {
      btn.textContent = 'Прислать ссылку';
      hint.textContent = 'Пришлём одноразовую ссылку для входа на почту. Удобно, если забыли пароль.';
    }
    btn.disabled = false;
  }

  async function sendRecovery() {
    const email = input.value.trim();
    if (!email) {
      showToast('Введите email — на него придёт письмо для создания пароля', 'error');
      input.focus();
      return;
    }
    forgotBtn.disabled = true;
    const res = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/'
    });
    forgotBtn.disabled = false;
    if (res.error) {
      showToast(humanizeAuthError(res.error), 'error', 6000);
      return;
    }
    document.getElementById('auth-form-container').innerHTML = `
      <div class="text-center py-6">
        <div class="text-4xl mb-3">📧</div>
        <h3 class="text-xl font-semibold mb-2">Письмо отправлено</h3>
        <p class="text-gray-400 mb-4">Откройте ссылку из письма — сайт предложит задать новый пароль.</p>
        <p class="text-xs text-gray-500">Если письма нет во «Входящих» — загляните в «Спам». Пароль станет единственным способом входа вместо одноразовых ссылок.</p>
      </div>
    `;
  }
  forgotBtn.addEventListener('click', sendRecovery);

  tabPassword.addEventListener('click', () => { mode = 'password'; repaint(); });
  tabOtp.addEventListener('click', () => { mode = 'otp'; repaint(); });
  switchBtn.addEventListener('click', () => { signup = !signup; repaint(); });

  async function submit() {
    const email = input.value.trim();
    if (!email) {
      showToast('Введите email', 'error');
      input.focus();
      return;
    }

    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = 'Минутку...';

    let error = null;
    let session = null;

    if (mode === 'otp') {
      const res = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin }
      });
      error = res.error;
    } else if (signup) {
      const password = passInput.value;
      if (password.length < 6) {
        btn.disabled = false;
        btn.textContent = oldLabel;
        showToast('Пароль минимум 6 символов', 'error');
        return;
      }
      const res = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username: nameInput.value.trim() || email.split('@')[0] },
          emailRedirectTo: window.location.origin
        }
      });
      error = res.error;
      session = res.data && res.data.session;
    } else {
      const res = await supabase.auth.signInWithPassword({ email, password: passInput.value });
      error = res.error;
    }

    if (error) {
      btn.disabled = false;
      btn.textContent = oldLabel;
      if (signup && /already registered/i.test(error.message)) {
        signup = false;
        repaint();
      }
      showToast(humanizeAuthError(error), 'error', 6000);
      return;
    }

    if (mode === 'otp') {
      document.getElementById('auth-form-container').innerHTML = `
        <div class="text-center py-6">
          <div class="text-4xl mb-3">📧</div>
          <h3 class="text-xl font-semibold mb-2">Ссылка отправлена!</h3>
          <p class="text-gray-400 mb-4">Проверьте почту и перейдите по ссылке для входа</p>
          <p class="text-xs text-gray-500">Если письма нет во «Входящих» — загляните в «Спам». После входа вернитесь на эту страницу.</p>
        </div>
      `;
      return;
    }

    if (signup && !session) {
      // В проекте Supabase включено подтверждение почты: аккаунт создан, но сессии ещё нет
      document.getElementById('auth-form-container').innerHTML = `
        <div class="text-center py-6">
          <div class="text-4xl mb-3">📧</div>
          <h3 class="text-xl font-semibold mb-2">Аккаунт создан</h3>
          <p class="text-gray-400 mb-4">Подтвердите почту по ссылке из письма, затем войдите с паролем.</p>
        </div>
      `;
      return;
    }

    showToast(signup ? 'Аккаунт создан! Ждите одобрения администратора' : 'Вход выполнен', 'success');
    // Дальше состояние поймает onAuthStateChange в main.js и перерисует приложение
  }

  btn.addEventListener('click', submit);
  [input, passInput, nameInput].forEach((el) => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  }));

  repaint();
}

// Вход по ссылке восстановления: Supabase даёт сессию с событием
// PASSWORD_RECOVERY — в этот момент нужно задать новый пароль.
export function openRecoveryPasswordModal() {
  if (document.getElementById('recovery-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'recovery-overlay';
  overlay.className = 'fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-card w-full max-w-sm rounded-2xl p-6 shadow-xl">
      <h3 class="text-lg font-bold mb-1">Задайте новый пароль</h3>
      <p class="text-xs text-gray-400 mb-4">Вы вошли по ссылке из письма. Придумайте пароль — дальше вход будет по нему, без одноразовых ссылок.</p>
      <input type="password" id="recovery-pass" placeholder="Минимум 6 символов" autocomplete="new-password"
        class="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
      <input type="password" id="recovery-pass2" placeholder="Повторите пароль" autocomplete="new-password"
        class="w-full mt-3 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500">
      <button id="recovery-save" class="w-full mt-4 bg-primary hover:bg-primary/90 text-white font-semibold py-3 px-4 rounded-xl">Сохранить пароль</button>
      <button id="recovery-cancel" class="w-full mt-2 text-xs text-gray-400 hover:underline">Позже</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const pass1 = overlay.querySelector('#recovery-pass');
  const pass2 = overlay.querySelector('#recovery-pass2');
  const save = overlay.querySelector('#recovery-save');
  const close = () => overlay.remove();
  overlay.querySelector('#recovery-cancel').addEventListener('click', close);

  async function submit() {
    const password = pass1.value;
    if (password.length < 6) {
      showToast('Пароль минимум 6 символов', 'error');
      return;
    }
    if (password !== pass2.value) {
      showToast('Пароли не совпадают', 'error');
      return;
    }
    save.disabled = true;
    const res = await supabase.auth.updateUser({ password });
    save.disabled = false;
    if (res.error) {
      showToast(humanizeAuthError(res.error), 'error', 6000);
      return;
    }
    close();
    showToast('Пароль сохранён — дальше входите по нему', 'success');
  }
  save.addEventListener('click', submit);
  [pass1, pass2].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  }));
  pass1.focus();
}

function humanizeAuthError(error) {
  const msg = (error && error.message) || '';
  if (/rate limit/i.test(msg)) return 'Слишком много попыток подряд. Подождите минуту и попробуйте снова.';
  if (/invalid email/i.test(msg)) return 'Похоже, в email опечатка. Проверьте адрес.';
  if (/invalid login credentials/i.test(msg)) return 'Неверный email или пароль. Если пароль не задавали (аккаунт создан по ссылке) — нажмите «Забыли пароль…» и задайте его.';
  if (/already registered/i.test(msg)) return 'Этот email уже зарегистрирован: войдите с паролем, а если пароль не задавали — «Забыли пароль или не задавали его?».';
  if (/email not confirmed/i.test(msg)) return 'Почта не подтверждена. Проверьте письмо со ссылкой или войдите по ссылке на почту.';
  if (/password.*at least|at least 6/i.test(msg)) return 'Пароль должен быть не короче 6 символов.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Нет соединения с Supabase. Проверьте интернет.';
  return 'Ошибка входа: ' + msg;
}
