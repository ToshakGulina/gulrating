// Supabase загружен локально (vendor/supabase.js, UMD-глобал)
const { createClient } = window.supabase || {};
import { CONFIG, configIsComplete } from '../config.js';

// На основном и preview-доменах Supabase идёт через same-origin Pages Function:
// браузеру нужен только домен приложения, а Cloudflare сам обращается к Supabase.
// Локальную разработку оставляем на прямом URL, где Pages Function отсутствует.
function getSupabaseClientUrl() {
  if (typeof window === 'undefined' || !window.location) return CONFIG.SUPABASE_URL;
  const host = window.location.hostname;
  const pagesHost = host === 'gulrating.pages.dev' || host.endsWith('.gulrating.pages.dev');
  return pagesHost ? `${window.location.origin}/supabase` : CONFIG.SUPABASE_URL;
}

const projectRef = new URL(CONFIG.SUPABASE_URL).hostname.split('.')[0];

// Клиент создаём только если конфиг заполнен, иначе createClient бросит
// исключение и приложение упадёт с пустым экраном.
export let supabase = null;
export let supabaseInitError = null;

if (configIsComplete()) {
  try {
    supabase = createClient(getSupabaseClientUrl(), CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: `sb-${projectRef}-auth-token`,
        storage: localStorage
      }
    });
  } catch (e) {
    supabaseInitError = e;
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('request timeout')), ms); })
  ]).finally(() => clearTimeout(timer));
}

// Профиль-копия нужна только для офлайн-старта уже вошедшего пользователя.
// Данные никогда не используются для авторизации/выдачи доступа на сервере.
function cachedProfile(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(`gulrating:profile:${userId}`) || 'null');
    return value && value.id === userId ? value : null;
  } catch (e) {
    return null;
  }
}

function cachedAuthUser() {
  try {
    const projectRef = new URL(CONFIG.SUPABASE_URL).hostname.split('.')[0];
    const stored = JSON.parse(localStorage.getItem(`sb-${projectRef}-auth-token`) || 'null');
    const session = stored && (stored.currentSession || stored.session || stored);
    return session && session.user && session.user.id ? session.user : null;
  } catch (e) {
    return null;
  }
}

function offlineUser(user, offlineOnly = true) {
  return {
    ...user,
    profile: cachedProfile(user.id) || {
      id: user.id,
      username: user.user_metadata && user.user_metadata.username
        ? user.user_metadata.username
        : (user.email ? user.email.split('@')[0] : 'Пользователь'),
      avatar_url: null,
      // Только локальный интерфейс; сервер всё равно проверяет доступ через RLS.
      is_approved: true,
      is_admin: false
    },
    // Ошибка запроса профиля не равна подтверждённому отсутствию интернета.
    // Оставляем серверные попытки включёнными, пока браузер не сообщил offline.
    offlineOnly
  };
}

// Читаем локальную Supabase-сессию, а профиль пробуем обновить по сети.
// navigator.onLine в WebView иногда сообщает offline даже при доступном 5G/API,
// поэтому это лишь подсказка для таймаута, а не основание пропустить запрос.
export async function getCurrentUser() {
  if (!supabase) return null;

  let user = null;
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 1500);
    if (error) throw error;
    user = data && data.session ? data.session.user : null;
  } catch (e) {
    // Если SDK не успел получить локальную сессию из-за зависшего lock/таймаута,
    // читаем только сохранённого пользователя. Это открывает локальный UI, но
    // не предоставляет доступ к серверным операциям.
    user = cachedAuthUser();
    if (!user) return null;
  }
  if (!user) return null;

  const browserReportsOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const profileKey = `gulrating:profile:${user.id}`;
  try {
    const query = supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    const result = await withTimeout(query, 1500);
    if (!result.error && result.data) {
      try { localStorage.setItem(profileKey, JSON.stringify(result.data)); } catch (e) { /* quota */ }
      return { ...user, profile: result.data };
    }
    if (!result.error && !result.data) return { ...user, profile: null };
  } catch (e) {
    // Недоступность сети — это не потеря аккаунта. Используем копию профиля.
  }

  return offlineUser(user, browserReportsOffline);
}

// Получаем все профили пользователей (для списков участников)
export async function getAllProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('username', { ascending: true });

  if (error) throw error;
  return data || [];
}
