// Вспомогательные функции для безопасного рендеринга HTML
import { CONFIG } from '../config.js';

// Экранирование пользовательских и внешних данных перед вставкой в innerHTML.
// Названия фильмов, комментарии и имена приходят извне — без экранирования
// это XSS (например, комментарий "<img onerror=...>").
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Безопасный атрибут src для аватара: только http(s) или data:image
export function safeAvatarUrl(avatarUrl, username) {
  const fallback = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username || 'user')}`;
  if (!avatarUrl) return fallback;
  try {
    const u = new URL(avatarUrl, location.origin);
    if (u.protocol === 'https:' || u.protocol === 'http:' || (u.protocol === 'data:' && avatarUrl.startsWith('data:image/'))) {
      return avatarUrl;
    }
  } catch (e) {
    // невалидный URL — используем фолбэк
  }
  return fallback;
}

// Год из даты релиза без падения на невалидных значениях
export function releaseYear(releaseDate) {
  if (!releaseDate) return '';
  const year = new Date(releaseDate).getFullYear();
  return Number.isFinite(year) && year > 1000 ? String(year) : '';
}

// Постер с фолбэком: если картинка не загрузилась (TMDb недоступен, постер
// удалён), img убирает себя и остаётся emoji-заглушка под ним.
export function posterImg(posterPath, title, boxClass = 'w-full aspect-[2/3] rounded-lg', imgClass = 'absolute inset-0 w-full h-full object-cover rounded-lg') {
  const alt = escapeHtml(title || '');
  if (!posterPath) {
    return `<div class="poster-frame relative ${boxClass} bg-slate-700 flex items-center justify-center text-gray-500 overflow-hidden">🎬</div>`;
  }
  // Гео-блок CDN постеров обходим фолбэком: ошибка прямой загрузки подменяет
  // src на серверный прокси /timg (Pages Functions) того же домена
  const proxyPath = `/timg/${(CONFIG.TMDB_IMG_BASE.split('/t/p/')[1] || 'w500/')}${posterPath}`;
  return `<div class="poster-frame relative ${boxClass} bg-slate-700 flex items-center justify-center text-gray-500 overflow-hidden">🎬<img src="${CONFIG.TMDB_IMG_BASE}${escapeHtml(posterPath)}" alt="${alt}" loading="lazy" class="${imgClass}" onerror="this.onerror=function(){this.remove()};this.src='${proxyPath}'"></div>`;
}

// Красивый показ оценки: 8 -> "8", 7.5 -> "7.5" (оценки теперь с десятыми)
export function formatRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}

// Показать всплывающее сообщение (аккуратнее, чем alert): тост внизу экрана
export function showToast(message, type = 'info', timeout = 3500) {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  const colors = {
    info: 'bg-slate-800 border-slate-600',
    success: 'bg-green-900/90 border-green-600',
    error: 'bg-red-900/90 border-red-600',
  };
  toast.className = `toast-item pointer-events-auto max-w-sm px-4 py-3 rounded-xl border text-sm shadow-xl ${colors[type] || colors.info}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 200);
  }, timeout);
}

function createToastContainer() {
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.className = 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none px-4';
  document.body.appendChild(container);
  return container;
}
