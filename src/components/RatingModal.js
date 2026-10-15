import { CONFIG } from '../config.js';
import { saveRating, addToWatchlist, removeFromWatchlist, getUserTitleStatus, deleteRating } from '../lib/ratings.js';
import { getTitleDetails } from '../lib/tmdb.js';
import { getKinopoiskRating } from '../lib/kinopoisk.js';
import { supabase } from '../lib/supabase.js';
import { addRecentTitle } from '../lib/history.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating } from '../lib/dom.js';

export async function openRatingModal(titleId, mediaType, currentUser, onSaveCallback) {
  // Создаем оверлей модалки
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm';
  modal.innerHTML = `
    <div class="bg-card w-full max-w-lg rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
      <div class="p-4 flex justify-between items-center border-b border-slate-700 sticky top-0 bg-card z-10">
        <h2 class="text-xl font-bold">Загружаем информацию...</h2>
        <button id="close-modal" class="text-gray-400 hover:text-white" aria-label="Закрыть">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div id="modal-content" class="p-4">
        <div class="animate-pulse space-y-4">
          <div class="flex gap-4">
            <div class="w-24 aspect-[2/3] bg-slate-700 rounded-lg"></div>
            <div class="flex-1 space-y-2">
              <div class="h-6 bg-slate-700 rounded w-3/4"></div>
              <div class="h-4 bg-slate-700 rounded w-1/2"></div>
              <div class="h-20 bg-slate-700 rounded w-full mt-2"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // Закрытие модалки
  const closeModal = () => {
    document.removeEventListener('keydown', onKeydown);
    modal.remove();
    document.body.style.overflow = '';
  };
  const onKeydown = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onKeydown);
  document.getElementById('close-modal').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  try {
    // Загружаем детали тайтла, затем параллельно статус пользователя,
    // оценки друзей и (опционально) рейтинг Кинопоиска
    const title = await getTitleDetails(titleId, mediaType);
    const year = releaseYear(title.release_date);

    const [status, allRatings, kpRating] = await Promise.all([
      getUserTitleStatus(currentUser.id, titleId),
      supabase
        .from('ratings')
        .select(`*, profiles!inner(*)`)
        .eq('title_id', titleId)
        .order('rating', { ascending: false })
        .then(({ data }) => data || []),
      getKinopoiskRating(title.title, title.original_title, year)
    ]);

    // Запоминаем тайтл в «недавно открытых» для истории поиска
    addRecentTitle({
      id: title.id,
      media_type: mediaType,
      title: title.title,
      poster_path: title.poster_path,
      year
    });

    const averageRating = allRatings.length > 0
      ? (allRatings.reduce((sum, r) => sum + Number(r.rating), 0) / allRatings.length).toFixed(1)
      : null;

    modal.querySelector('h2').textContent = title.title || 'Фильм';

    document.getElementById('modal-content').innerHTML = `
      <div class="flex gap-4 mb-4">
        <div class="flex-shrink-0 w-24">
          ${title.poster_path
            ? `<img src="${CONFIG.TMDB_IMG_BASE}${escapeHtml(title.poster_path)}" alt="${escapeHtml(title.title)}" class="w-full aspect-[2/3] rounded-lg object-cover">`
            : `<div class="w-full aspect-[2/3] rounded-lg bg-slate-700 flex items-center justify-center text-gray-500">🎬</div>`
          }
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-lg leading-tight">${escapeHtml(title.title)}</h3>
          <p class="text-sm text-gray-400 mb-1">${year ? escapeHtml(year) + ' • ' : ''}${mediaType === 'movie' ? 'фильм' : 'сериал'}</p>
          <div class="flex gap-2 flex-wrap mb-2">
            ${(title.genres || []).slice(0, 3).map(g => `<span class="text-xs px-2 py-0.5 bg-slate-700 rounded-full">${escapeHtml(g)}</span>`).join('')}
          </div>
          <div class="flex gap-3 text-sm flex-wrap">
            ${kpRating !== null ? `<span class="flex items-center gap-1"><span class="text-orange-400">★</span> Кинопоиск: ${kpRating.toFixed(1)}</span>` : ''}
            ${title.tmdb_rating ? `<span class="flex items-center gap-1"><span class="text-cyan-400">★</span> TMDb: ${Number(title.tmdb_rating).toFixed(1)}</span>` : ''}
            ${averageRating ? `<span class="flex items-center gap-1"><span class="text-pink-400">★</span> Средняя у друзей: ${averageRating}</span>` : ''}
          </div>
        </div>
      </div>

      ${title.overview ? `<p class="text-sm text-gray-300 mb-4 line-clamp-3">${escapeHtml(title.overview)}</p>` : ''}

      <div class="border-t border-slate-700 pt-4 mb-4">
        <h4 class="font-semibold mb-3">Ваша оценка</h4>

        <!-- Слайдер оценки: как яркость на телефоне, с шагом 0.1 -->
        <div class="text-center mb-2">
          <span id="rating-value" class="text-5xl font-bold">—</span>
          <span class="text-gray-500 text-lg ml-1">/10</span>
        </div>
        <div class="flex items-center gap-3 mb-3">
          <button id="rating-minus" class="w-10 h-10 flex-shrink-0 rounded-full bg-slate-700 hover:bg-slate-600 text-xl font-bold" aria-label="Минус 0.1">−</button>
          <input type="range" id="rating-slider" min="1" max="10" step="0.1" class="rating-slider flex-1" aria-label="Оценка от 1 до 10">
          <button id="rating-plus" class="w-10 h-10 flex-shrink-0 rounded-full bg-slate-700 hover:bg-slate-600 text-xl font-bold" aria-label="Плюс 0.1">+</button>
        </div>
        <p class="text-xs text-gray-500 text-center mb-3">Тяните бегунок или листайте кнопками — шаг 0.1</p>

        <textarea id="rating-comment" placeholder="Комментарий (опционально)" rows="2"
          class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500 text-sm mb-3"
        >${escapeHtml(status.hasRating ? (status.rating.comment || '') : '')}</textarea>
        <div class="flex gap-2">
          <button id="save-rating-btn" class="flex-1 bg-primary hover:bg-primary/90 text-white font-medium py-2 px-4 rounded-lg transition-colors">
            ${status.hasRating ? 'Обновить оценку' : 'Сохранить оценку'}
          </button>
          ${status.hasRating ? `
            <button id="delete-rating-btn" class="px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors">
              Удалить
            </button>
          ` : ''}
        </div>

        ${!status.hasRating ? `
          <button id="add-watchlist-btn" class="w-full mt-2 py-2 px-4 rounded-lg border border-slate-700 hover:bg-slate-700 transition-colors text-sm ${status.isInWatchlist ? 'text-green-400 border-green-600/30 bg-green-600/10' : ''}">
            ${status.isInWatchlist ? '✓ В списке «Хочу посмотреть»' : '+ Добавить в «Хочу посмотреть»'}
          </button>
        ` : ''}
      </div>

      ${allRatings.length > 0 ? `
        <div class="border-t border-slate-700 pt-4">
          <h4 class="font-semibold mb-3">Оценки друзей</h4>
          <div class="space-y-3">
            ${allRatings.map(r => `
              <div class="flex gap-3 items-start">
                <img src="${escapeHtml(safeAvatarUrl(r.profiles.avatar_url, r.profiles.username))}" alt="" class="w-8 h-8 rounded-full bg-slate-700">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-sm">${escapeHtml(r.profiles.username)}</span>
                    <span class="font-bold text-sm ${Number(r.rating) >= 8 ? 'text-green-400' : Number(r.rating) >= 5 ? 'text-yellow-400' : 'text-red-400'}">${escapeHtml(formatRating(r.rating))}/10</span>
                  </div>
                  ${r.comment ? `<p class="text-sm text-gray-400 mt-0.5">${escapeHtml(r.comment)}</p>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    // --- Логика слайдера оценки ---
    const slider = document.getElementById('rating-slider');
    const valueEl = document.getElementById('rating-value');
    let selectedScore = status.hasRating ? Math.round(Number(status.rating.rating) * 10) / 10 : null;

    function valueColor(n) {
      if (n >= 8) return 'text-green-400';
      if (n >= 5) return 'text-yellow-400';
      return 'text-red-400';
    }

    function renderValue() {
      if (selectedScore === null) {
        valueEl.textContent = '—';
        valueEl.className = 'text-5xl font-bold text-gray-500';
        return;
      }
      valueEl.textContent = formatRating(selectedScore);
      valueEl.className = `text-5xl font-bold ${valueColor(selectedScore)}`;
    }

    function setScore(n, fromSlider) {
      selectedScore = Math.min(10, Math.max(1, Math.round(n * 10) / 10));
      if (!fromSlider) slider.value = String(selectedScore);
      renderValue();
    }

    slider.addEventListener('input', () => setScore(parseFloat(slider.value), true));
    document.getElementById('rating-minus').addEventListener('click', () => {
      setScore((selectedScore === null ? 5.1 : selectedScore) - 0.1, false);
    });
    document.getElementById('rating-plus').addEventListener('click', () => {
      setScore((selectedScore === null ? 4.9 : selectedScore) + 0.1, false);
    });

    if (selectedScore !== null) {
      slider.value = String(selectedScore);
    }
    renderValue();

    // Сохранение оценки
    document.getElementById('save-rating-btn').addEventListener('click', async () => {
      if (selectedScore === null) {
        showToast('Подвиньте бегунок, чтобы поставить оценку', 'error');
        return;
      }
      const comment = document.getElementById('rating-comment').value.trim();

      const btn = document.getElementById('save-rating-btn');
      btn.disabled = true;
      btn.textContent = 'Сохраняем...';

      try {
        await saveRating(currentUser.id, titleId, mediaType, selectedScore, comment);
        closeModal();
        showToast(`Оценка ${formatRating(selectedScore)} сохранена`, 'success');
        if (onSaveCallback) onSaveCallback();
      } catch (e) {
        showToast('Ошибка при сохранении: ' + e.message, 'error', 5000);
        btn.disabled = false;
        btn.textContent = status.hasRating ? 'Обновить оценку' : 'Сохранить оценку';
      }
    });

    // Удаление оценки
    if (status.hasRating) {
      document.getElementById('delete-rating-btn').addEventListener('click', async () => {
        if (confirm('Удалить вашу оценку?')) {
          try {
            await deleteRating(currentUser.id, titleId);
            closeModal();
            showToast('Оценка удалена', 'success');
            if (onSaveCallback) onSaveCallback();
          } catch (e) {
            showToast('Ошибка при удалении: ' + e.message, 'error', 5000);
          }
        }
      });
    }

    // Добавление / удаление из «хочу посмотреть»
    if (!status.hasRating) {
      const watchlistBtn = document.getElementById('add-watchlist-btn');
      watchlistBtn.addEventListener('click', async () => {
        watchlistBtn.disabled = true;
        try {
          if (status.isInWatchlist) {
            await removeFromWatchlist(currentUser.id, titleId);
            status.isInWatchlist = false;
            showToast('Убрали из «Хочу посмотреть»', 'success');
          } else {
            await addToWatchlist(currentUser.id, titleId, mediaType);
            status.isInWatchlist = true;
            showToast('Добавили в «Хочу посмотреть»', 'success');
          }
          watchlistBtn.textContent = status.isInWatchlist ? '✓ В списке «Хочу посмотреть»' : '+ Добавить в «Хочу посмотреть»';
          watchlistBtn.classList.toggle('text-green-400', status.isInWatchlist);
          watchlistBtn.classList.toggle('border-green-600/30', status.isInWatchlist);
          watchlistBtn.classList.toggle('bg-green-600/10', status.isInWatchlist);
          if (onSaveCallback) onSaveCallback();
        } catch (e) {
          showToast('Ошибка: ' + e.message, 'error', 5000);
        } finally {
          watchlistBtn.disabled = false;
        }
      });
    }

  } catch (e) {
    document.getElementById('modal-content').innerHTML = `
      <div class="text-center py-8 text-red-400">
        Ошибка загрузки: ${escapeHtml(e.message)}
      </div>
    `;
  }
}
