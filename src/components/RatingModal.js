import { saveRating, addToWatchlist, removeFromWatchlist, getUserTitleStatus, deleteRating } from '../lib/ratings.js';
import { getTitleDetails } from '../lib/tmdb.js';
import { openCatalog } from './Catalog.js';
import { getKinopoiskRatings, kinopoiskPageUrl } from '../lib/kinopoisk.js';
import { supabase } from '../lib/supabase.js';
import { addRecentTitle } from '../lib/history.js';
import { enqueueRating, networkLikeError } from '../lib/offline.js';
import { addWatchEntry, reportWatchNative, isApk } from '../lib/watchHistory.js';
import { fetchKinoboxPlayers } from '../lib/kinobox.js';
import { CONFIG } from '../config.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';

// Фирменные иконки источников оценок (inline SVG по оригинальным логотипам):
// Кинопоиск — квадратная иконка сервиса: оранжевый фон и белая киноплёнка
// с четырьмя отверстиями; TMDb — зелёный (#90cea4) контур-«пузырь» с буквами
// TM/DB; друзья — розовый силуэт компании.
const KP_ICON = '<svg viewBox="0 0 32 32" class="w-4 h-4 flex-shrink-0 rounded" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#ff5c00"/><circle cx="16" cy="16" r="10.5" fill="#fdfbf7"/><g fill="#ff5c00"><circle cx="11.6" cy="11.6" r="3.1"/><circle cx="20.4" cy="11.6" r="3.1"/><circle cx="11.6" cy="20.4" r="3.1"/><circle cx="20.4" cy="20.4" r="3.1"/><circle cx="16" cy="16" r="1.9"/></g></svg>';
const TMDB_ICON = '<svg viewBox="0 0 32 32" class="w-4 h-4 flex-shrink-0" aria-hidden="true"><g fill="none" stroke="#90cea4" stroke-width="3.4" stroke-linejoin="round"><rect x="5" y="4.5" width="22" height="17.5" rx="4.5"/><path d="M8.6 22.5v6.2l6.2-6.2"/></g><text x="16" y="12.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6.6" font-weight="800" fill="#ffffff">TM</text><text x="16" y="19.4" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="6.6" font-weight="800" fill="#ffffff">DB</text></svg>';
const IMDB_ICON = '<svg viewBox="0 0 32 32" class="w-4 h-4 flex-shrink-0" aria-hidden="true"><rect x="2" y="8" width="28" height="16" rx="4" fill="#f5c518"/><text x="16" y="20" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="800" fill="#000000">IMDb</text></svg>';
const RU_CRITICS_ICON = '<svg viewBox="0 0 32 32" class="w-4 h-4 flex-shrink-0" aria-hidden="true"><clipPath id="ru-flag-clip"><rect x="3" y="8" width="26" height="16" rx="3"/></clipPath><g clip-path="url(#ru-flag-clip)"><rect x="3" y="8" width="26" height="16" fill="#ffffff"/><rect x="3" y="13.3" width="26" height="5.4" fill="#0039a6"/><rect x="3" y="18.7" width="26" height="5.3" fill="#d52b1e"/></g></svg>';
const CRITICS_ICON = '<svg viewBox="0 0 24 24" class="w-4 h-4 flex-shrink-0" aria-hidden="true" fill="none" stroke="#94a3b8" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.6 3 14.4 0 18-3-3.6-3-14.4 0-18z"/></svg>';
const AWAIT_ICON = '<svg viewBox="0 0 24 24" class="w-4 h-4 flex-shrink-0" aria-hidden="true" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

// Встроенный плеер: оверлей в нашем стиле. Источники и озвучки — ДВУМЯ
// строками (сначала плеер: Alloha/Veoveo/…, затем его озвучки), выбор
// запоминается. Доступность каждого источника Function /kinobox проверяет
// заранее (embed: 'any' | 'referer'): то, что не встраивается в браузере,
// в браузере спрятано за счётчик «ещё N (в приложении)», мёртвые источники
// не показываются вовсе. Кнопка «не играет» прячет источник в памяти
// браузера и сразу включает следующий.
const BAD_DUBS_KEY = 'gulrating:bad_dubs';

// Embed-only плееры: открытые верхним документом отвечают «404 NOT FOUND» /
// «контент не найден» (скриншоты пользователя из APK), но отлично играют
// внутри фрейма — как в браузере. В приложении ведём их во фрейм, остальные
// источники — верхним документом (там работают прогресс и продолжение).
const EMBED_ONLY_HOSTS = ['stravers.live', 'obrut.show'];

function isEmbedOnly(url) {
  try {
    const h = new URL(url).hostname;
    return EMBED_ONLY_HOSTS.some((x) => h === x || h.endsWith('.' + x));
  } catch (e) {
    return false;
  }
}

function readBadDubs() {
  try {
    const v = JSON.parse(localStorage.getItem(BAD_DUBS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function markBadDub(type, name) {
  try {
    const list = readBadDubs();
    const key = `${type}::${name}`;
    if (!list.includes(key)) list.push(key);
    localStorage.setItem(BAD_DUBS_KEY, JSON.stringify(list.slice(-80)));
  } catch (e) { /* приватный режим */ }
}

export function openWatchOverlay(opts) {
  const { kpId, imdbId, query, titleText, mirrorUrl } = opts || {};
  const apk = isApk();
  const ov = document.createElement('div');
  ov.className = 'fixed inset-0 z-50 bg-black/95 flex flex-col p-3 gap-2';
  ov.innerHTML = `
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-semibold text-white truncate flex-1">▶ ${escapeHtml(titleText || '')}</h3>
      <button id="watch-fs" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-gray-200 text-sm" title="На весь экран" aria-label="На весь экран">⛭</button>
      <a id="watch-tab" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-gray-200 text-xs" href="${escapeHtml(mirrorUrl || '#')}" target="_blank" rel="noopener noreferrer" title="Открыть в новой вкладке">вкладка</a>
      <button id="watch-close" class="text-gray-300 hover:text-white text-2xl leading-none px-2" aria-label="Закрыть плеер">&times;</button>
    </div>
    <div id="watch-stage" class="flex-1 relative min-h-0 rounded-xl overflow-hidden bg-black/60 flex items-center justify-center">
      <p id="watch-status" class="text-sm text-gray-400 px-4 text-center">Ищем доступные плееры…</p>
    </div>
    <div id="watch-players" class="flex flex-wrap gap-1.5 flex-shrink-0 content-start"></div>
    <div id="watch-dubs" class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pb-1 flex-shrink-0 content-start"></div>
    <div class="flex items-center gap-2 flex-shrink-0">
      <button id="watch-bad" class="px-2 py-1 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-gray-400 text-xs">не играет</button>
      <p id="watch-hint" class="text-xs text-gray-500 flex-1"></p>
    </div>`;
  document.body.appendChild(ov);

  const stage = ov.querySelector('#watch-stage');
  const playersBox = ov.querySelector('#watch-players');
  const dubsBox = ov.querySelector('#watch-dubs');
  const hint = ov.querySelector('#watch-hint');
  const tabLink = ov.querySelector('#watch-tab');
  const fsBtn = ov.querySelector('#watch-fs');
  if (apk) fsBtn.style.display = 'none'; // фуллскрин в APK делает сам плеер

  let groups = [];        // [{ type, embed, dubs: [{name, quality, url}] }]
  let curType = null;
  let curName = null;
  let showHidden = false; // показать спрятанные (браузер: только-приложение; плохие)

  const CHIP = 'px-3 py-1.5 rounded-lg text-xs whitespace-nowrap flex-shrink-0 ';
  const CHIP_IDLE = CHIP + 'bg-slate-800 hover:bg-slate-700 text-gray-200';
  const CHIP_ON = CHIP + 'bg-primary text-white';

  function setTab(u) {
    if (u) tabLink.href = u;
  }

  function showFrame(url) {
    stage.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.id = 'watch-frame';
    frame.className = 'absolute inset-0 w-full h-full bg-black';
    frame.allow = 'fullscreen; encrypted-media; autoplay';
    frame.setAttribute('allowfullscreen', '');
    // Плеерные CDN сверяют встраивающую страницу со списком зеркал:
    // без referer мы выглядим как прямой заход, а не как чужой сайт
    frame.referrerPolicy = 'no-referrer';
    frame.src = url;
    stage.appendChild(frame);
    setTab(url);
  }

  function curGroup() {
    return groups.find((g) => g.type === curType) || null;
  }

  function curDub() {
    const g = curGroup();
    if (!g) return null;
    return g.dubs.find((d) => d.name === curName) || g.dubs[0] || null;
  }

  function visibleGroups() {
    const bad = readBadDubs();
    return groups
      .map((g) => ({
        ...g,
        dubs: showHidden ? g.dubs : g.dubs.filter((d) => !bad.includes(`${g.type}::${d.name}`)),
      }))
      .filter((g) => g.dubs.length);
  }

  function play(dub, group, autoFs) {
    if (!dub) return;
    setTab(dub.url);
    if (apk) {
      // Embed-only (Alloha, Turbo) — во фрейм, как в браузере: верхним
      // документом они отказываются работать. Остальные — верхним
      // документом через мост: так нативно пишутся прогресс и продолжение
      if (isEmbedOnly(dub.url)) {
        showFrame(dub.url);
        // Автофуллскрин с тапа по озвучке и во фреймовом режиме
        if (autoFs && window.GulRatingBridge && window.GulRatingBridge.enterCinema) {
          window.GulRatingBridge.enterCinema();
        }
        return;
      }
      if (window.GulRatingBridge && window.GulRatingBridge.openPlayer) {
        window.GulRatingBridge.openPlayer(dub.url, mirrorUrl || '');
      } else {
        window.location.href = dub.url;
      }
      return;
    }
    showFrame(dub.url);
    if (autoFs) {
      // Тап по озвучке — пользовательский жест: браузер разрешает
      // развернуть фрейм на весь экран сразу
      const f = stage.querySelector('iframe');
      if (f && f.requestFullscreen) f.requestFullscreen().catch(() => {});
    }
    void group;
  }

  function remember() {
    try {
      localStorage.setItem('gulrating:last_dub', JSON.stringify({ type: curType, name: curName }));
    } catch (e) { /* приватный режим */ }
  }

  function renderPlayers() {
    playersBox.innerHTML = '';
    const vis = visibleGroups();
    vis.forEach((g) => {
      const b = document.createElement('button');
      b.className = g.type === curType ? CHIP_ON : CHIP_IDLE;
      b.textContent = g.type;
      b.title = '';
      b.addEventListener('click', () => {
        // Смена источника НИКОГДА не запускает playback (в том числе у
        // источников с одной озвучкой): лишь подставляет список
        // его озвучек (ту же озвучку, если она есть и здесь). Запуск —
        // отдельным тапом по озвучке, как просил пользователь
        curType = g.type;
        curName = (g.dubs.find((d) => d.name === curName) || g.dubs[0] || {}).name || null;
        renderPlayers();
        renderDubs();
      });
      playersBox.appendChild(b);
    });
    const hiddenCount = groups.reduce((n, g) => n + g.dubs.length, 0)
      - vis.reduce((n, g) => n + g.dubs.length, 0);
    if (hiddenCount > 0) {
      const t = document.createElement('button');
      t.className = CHIP + 'bg-transparent text-gray-500 hover:text-gray-300';
      t.textContent = showHidden ? 'скрыть отмеченные' : `показать скрытые (${hiddenCount})`;
      t.addEventListener('click', () => {
        showHidden = !showHidden;
        renderPlayers();
        renderDubs();
      });
      playersBox.appendChild(t);
    }
  }

  function renderDubs() {
    dubsBox.innerHTML = '';
    const g = curGroup();
    if (!g) return;
    const bad = readBadDubs();
    const dubs = showHidden ? g.dubs : g.dubs.filter((d) => !bad.includes(`${g.type}::${d.name}`));
    (dubs.length ? dubs : g.dubs).forEach((d) => {
      const b = document.createElement('button');
      const isBad = bad.includes(`${g.type}::${d.name}`);
      b.className = d.name === curName ? CHIP_ON : CHIP_IDLE;
      if (isBad) b.classList.add('opacity-50', 'line-through');
      b.textContent = d.quality ? `${d.name} · ${d.quality}` : d.name;
      b.addEventListener('click', () => {
        curName = d.name;
        renderPlayers();
        renderDubs();
        play(d, g, true); // тап по озвучке → сразу во весь экран
        remember();
      });
      dubsBox.appendChild(b);
    });
  }

  // «Не играет»: прячем источник локально и сразу включаем следующий живой
  ov.querySelector('#watch-bad').addEventListener('click', () => {
    const g = curGroup();
    const d = curDub();
    if (!g || !d) return;
    markBadDub(g.type, d.name);
    const pool = visibleGroups();
    const next = pool.find((x) => x.type === g.type && x.dubs.length)
      || pool[0] || null;
    if (next) {
      curType = next.type;
      curName = (next.dubs[0] || {}).name || null;
      renderPlayers();
      renderDubs();
      play(curDub(), next);
      remember();
    } else {
      renderPlayers();
      renderDubs();
      hint.textContent = 'Живых источников не осталось — попробуйте «вкладка».';
    }
  });

  fsBtn.addEventListener('click', () => {
    const frame = stage.querySelector('iframe');
    if (!frame) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (frame.requestFullscreen) frame.requestFullscreen().catch(() => {});
  });
  ov.querySelector('#watch-close').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    ov.remove();
  });
  ov._onKey = (e) => {
    if (!ov.isConnected) {
      document.removeEventListener('keydown', ov._onKey);
      return;
    }
    if (e.key === 'Escape' && !document.fullscreenElement) {
      document.removeEventListener('keydown', ov._onKey);
      ov.remove();
    }
  };
  document.addEventListener('keydown', ov._onKey);

  fetchKinoboxPlayers({ kpId, imdbId, query })
    .then((list) => {
      if (!list.length) return fallback();
      // Группируем по источнику, сохраняя порядок ответа
      for (const item of list) {
        let g = groups.find((x) => x.type === item.type);
        if (!g) {
          g = { type: item.type, embed: item.embed || 'any', dubs: [] };
          groups.push(g);
        }
        if (!g.dubs.find((d) => d.name === item.name)) {
          g.dubs.push({ name: item.name, quality: item.quality, url: item.url });
        }
      }
      // Старт: прошлый выбор, если жив, иначе первый доступный
      let last = null;
      try {
        last = JSON.parse(localStorage.getItem('gulrating:last_dub') || 'null');
      } catch (e) { /* не важно */ }
      const vis = visibleGroups();
      const startG = (last && vis.find((g) => g.type === last.type && g.dubs.some((d) => d.name === last.name)))
        || vis[0] || null;
      if (!startG) return fallback();
      curType = startG.type;
      curName = (last && startG.dubs.find((d) => d.name === last.name) ? last.name : (startG.dubs[0] || {}).name) || null;
      renderPlayers();
      renderDubs();
      if (!apk) play(curDub(), startG);
      else {
        stage.innerHTML = '<p class="text-sm text-gray-300 px-4 text-center">Выберите источник и озвучку — плеер откроется внутри приложения.<br>Кнопка ⛶ внутри плеера развернёт видео на весь экран.</p>';
        setTab((curDub() || {}).url);
      }
      hint.textContent = apk
        ? 'Тап по источнику — только выбор; тап по озвучке — запуск сразу во весь экран (ландшафт). Back — обычный вид. У источников с одной кнопкой озвучки переключает меню самого плеера.'
        : 'Тап по источнику — только выбор; тап по озвучке — запуск сразу во весь экран, Esc — выход. У источников с одной кнопкой озвучки переключает меню самого плеера. «Не играет» спрячет источник и включит следующий.';
    })
    .catch(() => fallback());

  function fallback() {
    playersBox.innerHTML = '';
    dubsBox.innerHTML = '';
    if (apk) {
      stage.innerHTML = '';
      const b = document.createElement('button');
      b.className = 'px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm';
      b.textContent = 'Открыть страницу зеркала';
      b.addEventListener('click', () => { window.location.href = mirrorUrl; });
      stage.appendChild(b);
    } else if (mirrorUrl) {
      showFrame(mirrorUrl);
    } else {
      stage.innerHTML = '<p class="text-sm text-gray-400 px-4 text-center">Плееры не найдены</p>';
    }
    hint.textContent = 'Список плееров получить не удалось — открываем зеркало целиком (там может быть реклама).';
  }
}

// «105 936 голосов» с правильным склонением
function criticsLabel(value) {
  return value <= 10
    ? `${value.toFixed(1)} <span class="text-xs text-gray-500">/ 10</span>`
    : `${Math.round(value)}%`;
}

// «150 млн $» / «1.2 млрд $» для бюджета и сборов
function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} млрд $`;
  if (v >= 1e6) return `${Math.round(v / 1e6)} млн $`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} тыс $`;
  return `${v} $`;
}

function formatVotes(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'голос'
    : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? 'голоса'
    : 'голосов';
  return new Intl.NumberFormat('ru-RU').format(n) + ' ' + word;
}
const FRIENDS_ICON = '<svg viewBox="0 0 24 24" class="w-4 h-4 flex-shrink-0" aria-hidden="true" fill="#f472b6"><path d="M9 11a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v2h16v-2c0-3.3-4.7-5-8-5zm8-2a3.5 3.5 0 10-2.4-6 5.5 5.5 0 010 8c.8.6 1.6 1 2.4 1zm0 2c-.6 0-1.3-.1-2-.3 1.2 1 2 2.3 2 3.8v1.5h6v-2c0-2.2-3.6-3-6-3z"/></svg>';

// Пока оценка не выбрана, пузырёк над бегунком показывает позицию серым

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

    // Без сети статус и оценки друзей недоступны — карточка всё равно
    // открывается (детали из кэша), оценку можно поставить в очередь
    const [status, allRatings, kpRatings] = await Promise.all([
      getUserTitleStatus(currentUser.id, titleId)
        .catch(() => ({ hasRating: false, rating: null, isInWatchlist: false })),
      supabase
        .from('ratings')
        .select(`*, profiles!inner(*)`)
        .eq('title_id', titleId)
        .order('rating', { ascending: false })
        .then(({ data }) => data || [])
        .catch(() => []),
      getKinopoiskRatings(title.title, title.original_title, year)
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

    // Бейдж друзей: оценка одна — пишем имя и оценку напрямую;
    // иначе средняя, а при наведении/тапе — расклад по каждому.
    let friendsBadge = '';
    if (allRatings.length === 1) {
      const r = allRatings[0];
      friendsBadge = `<span class="flex items-center gap-1.5">${FRIENDS_ICON} ${escapeHtml(r.profiles.username)}: <b class="text-pink-300">${formatRating(r.rating)}</b></span>`;
    } else if (averageRating) {
      friendsBadge = `
        <span id="friends-badge" class="relative group flex items-center gap-1.5 cursor-help">
          ${FRIENDS_ICON} Средняя у друзей: <b class="text-pink-300">${averageRating}</b>
          <span id="friends-tip" class="hidden group-hover:block absolute left-0 top-6 z-30 w-48 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
            ${allRatings.map(r => `
              <span class="flex items-center justify-between gap-3 py-0.5">
                <span class="text-gray-300 truncate">${escapeHtml(r.profiles.username)}</span>
                <b class="${valueColor(Number(r.rating))}">${formatRating(r.rating)}</b>
              </span>`).join('')}
          </span>
        </span>`;
    }

    // Очередь внешних рейтингов: первые два доступных видны сразу,
    // остальные — под кнопкой «Все рейтинги». Порядок: КП, IMDb, TMDb,
    // критики РФ, критики мира, ожидание (только для невышедших).
    const ratingRows = [];
    if (kpRatings && kpRatings.kp !== null) {
      ratingRows.push(`${KP_ICON} Кинопоиск: <b class="text-orange-300">${kpRatings.kp.toFixed(1)}</b>${kpRatings.votesKp ? `<span class="text-xs text-gray-500">· ${formatVotes(kpRatings.votesKp)}</span>` : ''}`);
    }
    if (kpRatings && kpRatings.imdb !== null) {
      ratingRows.push(`${IMDB_ICON} IMDb: <b class="text-yellow-300">${kpRatings.imdb.toFixed(1)}</b>${kpRatings.votesImdb ? `<span class="text-xs text-gray-500">· ${formatVotes(kpRatings.votesImdb)}</span>` : ''}`);
    }
    {
      const tmdbValue = (kpRatings && kpRatings.tmdb !== null)
        ? kpRatings.tmdb
        : (title.tmdb_rating ? Number(title.tmdb_rating) : null);
      if (tmdbValue !== null && Number.isFinite(tmdbValue)) {
        ratingRows.push(`${TMDB_ICON} TMDb: <b class="text-cyan-300">${tmdbValue.toFixed(1)}</b>`);
      }
      if (kpRatings && kpRatings.russianFilmCritics !== null) {
        ratingRows.push(`${RU_CRITICS_ICON} Российские критики: <b class="text-gray-200">${criticsLabel(kpRatings.russianFilmCritics)}</b>`);
      }
      if (kpRatings && kpRatings.filmCritics !== null) {
        ratingRows.push(`${CRITICS_ICON} Критики в мире: <b class="text-gray-200">${criticsLabel(kpRatings.filmCritics)}</b>`);
      }
      const releaseDate = title.release_date ? new Date(title.release_date) : null;
      const isUnreleased = releaseDate && Number.isFinite(releaseDate.getTime()) && releaseDate.getTime() > Date.now();
      if (isUnreleased && kpRatings && kpRatings.await !== null) {
        ratingRows.push(`${AWAIT_ICON} Рейтинг ожидания: <b class="text-gray-200">${Math.round(kpRatings.await)}%</b>`);
      }
    }
    const visibleRows = ratingRows.slice(0, 2);
    const extraRows = ratingRows.slice(2);
    const kpPageUrl = kinopoiskPageUrl(kpRatings && kpRatings.kpId);

    modal.querySelector('h2').textContent = title.title || 'Фильм';

    document.getElementById('modal-content').innerHTML = `
      <div class="flex gap-4 mb-4">
        <div id="poster-box" class="flex-shrink-0 w-24 ${title.poster_path ? 'cursor-zoom-in' : ''}" title="${title.poster_path ? 'Открыть постер' : ''}">
          ${posterImg(title.poster_path, title.title, 'w-24 aspect-[2/3] rounded-lg')}
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-bold text-lg leading-tight">${kpPageUrl
            ? `<a href="${kpPageUrl}" target="_blank" rel="noopener noreferrer" class="hover:text-orange-300 underline decoration-dotted underline-offset-4" title="Открыть страницу на Кинопоиске">${escapeHtml(title.title)} ↗</a>`
            : escapeHtml(title.title)}</h3>
          <p class="text-sm text-gray-400 mb-1">${year ? escapeHtml(year) + ' • ' : ''}${mediaType === 'movie' ? 'фильм' : 'сериал'}</p>
          <div class="flex gap-2 flex-wrap mb-2">
            ${(title.genres || []).slice(0, 3).map(g => `<button class="genre-chip text-xs px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded-full cursor-pointer transition-colors" data-genre="${escapeHtml(g)}" title="Открыть каталог с фильтром по жанру «${escapeHtml(g)}»">${escapeHtml(g)}</button>`).join('')}
          </div>
          ${(() => {
            // TMDb и КП не дублируем: по каждой метрике одна строка;
            // если источники расходятся — берём большую сумму
            const pick = (...vals) => {
              const nums = vals.map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
              return nums.length ? Math.max(...nums) : null;
            };
            const rows = [];
            const budget = pick(title.budget, kpRatings && kpRatings.kpBudget);
            const world = pick(title.revenue, kpRatings && kpRatings.kpFeesWorld);
            const ru = pick(kpRatings && kpRatings.kpFeesRussia);
            if (budget) rows.push(`Бюджет: ${formatMoney(budget)}`);
            if (world) rows.push(`Сборы в мире: ${formatMoney(world)}`);
            if (ru) rows.push(`Сборы в России: ${formatMoney(ru)}`);
            return rows.length
              ? `<div class="text-xs text-gray-500 mb-2 space-y-0.5">${rows.map((r, i) => `<div>${i === 0 ? '💵 ' : ''}${r}</div>`).join('')}</div>`
              : '';
          })()}
          '<button id="watch-btn" class="text-xs text-primary hover:underline mb-2 self-start">▶ Смотреть</button>'
          <div class="flex flex-col items-start gap-1.5 text-sm">
            ${visibleRows.map(row => `<span class="flex items-center gap-1.5">${row}</span>`).join('')}
            ${friendsBadge}
            ${extraRows.length ? `
              <button id="more-ratings-btn" class="text-xs text-gray-400 hover:text-white underline decoration-dotted underline-offset-4 text-left">Все рейтинги (${extraRows.length})</button>
              <span id="more-ratings" class="hidden flex-col items-start gap-1.5">
                ${extraRows.map(row => `<span class="flex items-center gap-1.5">${row}</span>`).join('')}
              </span>
            ` : ''}
          </div>
        </div>
      </div>

      ${title.overview ? `
        <p id="overview-text" class="text-sm text-gray-300 mb-1 line-clamp-3">${escapeHtml(title.overview)}</p>
        <button id="overview-toggle" class="text-xs text-primary hover:underline mb-4 hidden">Читать дальше</button>
      ` : ''}

      <div class="border-t border-slate-700 pt-4 mb-4">
        <h4 class="font-semibold mb-3">Ваша оценка</h4>

        <!-- Слайдер оценки: значение живёт в пузырьке над бегунком -->
        <div class="flex items-center gap-3 mb-3 mt-9">
          <button id="rating-minus" class="w-10 h-10 flex-shrink-0 rounded-full bg-slate-700 hover:bg-slate-600 text-xl font-bold" aria-label="Минус 0.1">−</button>
          <div class="relative flex-1">
            <div id="rating-bubble" class="absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-lg text-sm font-bold pointer-events-none whitespace-nowrap border border-slate-600 bg-slate-800 text-gray-400"></div>
            <input type="range" id="rating-slider" min="1" max="10" step="0.1" class="rating-slider w-full" aria-label="Оценка от 1 до 10">
          </div>
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

    // --- Тултип «у кого какая оценка» (тап по бейджу для телефонов) ---
    const friendsBadgeEl = document.getElementById('friends-badge');
    const friendsTip = document.getElementById('friends-tip');
    if (friendsBadgeEl && friendsTip) {
      friendsBadgeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        friendsTip.classList.toggle('hidden');
        friendsTip.classList.toggle('block');
      });
    }

    // --- Постер: клик открывает крупный просмотр ---
    const posterBox = document.getElementById('poster-box');
    if (posterBox && title.poster_path) {
      posterBox.addEventListener('click', () => openLightbox(title.poster_path, title.title));
    }

    // --- Жанры: клик открывает каталог с уже выставленным фильтром ---
    modal.querySelectorAll('.genre-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        closeModal();
        openCatalog(currentUser, (id, type) => {
          openRatingModal(id, type, currentUser, onSaveCallback);
        }, {
          genres: [chip.dataset.genre],
          types: [mediaType]
        });
      });
    });

    // --- Кнопка «Все рейтинги»: раскрывает скрытые строки ---
    const moreBtn = document.getElementById('more-ratings-btn');
    const moreBox = document.getElementById('more-ratings');
    if (moreBtn && moreBox) {
      moreBtn.addEventListener('click', () => {
        const opened = !moreBox.classList.toggle('hidden');
        moreBox.classList.toggle('flex', opened);
        moreBtn.textContent = opened ? 'Свернуть рейтинги' : `Все рейтинги (${moreBox.children.length})`;
      });
    }

    // --- Раскрывающееся описание ---
    const overviewText = document.getElementById('overview-text');
    const overviewToggle = document.getElementById('overview-toggle');
    if (overviewText && overviewToggle) {
      // Кнопка нужна только если текст реально обрезан
      if (overviewText.scrollHeight > overviewText.clientHeight + 4) {
        overviewToggle.classList.remove('hidden');
      }
      overviewToggle.addEventListener('click', () => {
        const collapsed = overviewText.classList.toggle('line-clamp-3');
        overviewToggle.textContent = collapsed ? 'Читать дальше' : 'Свернуть';
      });
    }

    // --- Логика слайдера оценки ---
    const slider = document.getElementById('rating-slider');
    const bubble = document.getElementById('rating-bubble');
    let selectedScore = status.hasRating ? Math.round(Number(status.rating.rating) * 10) / 10 : null;

    function valueColor(n) {
      if (n >= 8) return 'text-green-400';
      if (n >= 5) return 'text-yellow-400';
      return 'text-red-400';
    }

    function valueBg(n) {
      if (n >= 8) return 'bg-green-600';
      if (n >= 5) return 'bg-yellow-600';
      return 'bg-red-600';
    }

    // Пузырёк с значением ездит над бегунком: до первого касания он серый
    // (это позиция бегунка, а не оценка), после — окрашен по оценке
    const THUMB_PX = 28; // ширина бегунка из стилей .rating-slider
    function renderValue() {
      const val = selectedScore === null ? Number(slider.value) : selectedScore;
      const pct = (Math.min(10, Math.max(1, val)) - 1) / 9;
      bubble.style.left = `calc(${(pct * 100).toFixed(2)}% + ${((0.5 - pct) * THUMB_PX).toFixed(1)}px)`;
      bubble.textContent = formatRating(val);
      bubble.className = selectedScore === null
        ? 'absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-lg text-sm font-bold pointer-events-none whitespace-nowrap border border-slate-600 bg-slate-800 text-gray-400'
        : `absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-lg text-sm font-bold pointer-events-none whitespace-nowrap border border-transparent text-white ${valueBg(selectedScore)}`;
    }

    function setScore(n, fromSlider) {
      selectedScore = Math.min(10, Math.max(1, Math.round(n * 10) / 10));
      if (!fromSlider) slider.value = String(selectedScore);
      renderValue();
    }

    slider.addEventListener('input', () => setScore(parseFloat(slider.value), true));
    // Кнопки ± step'ают от ТОГО значения, что показывает пузырёк
    // (до первого касания это позиция бегунка), иначе был скачок 5.5 → 5
    document.getElementById('rating-minus').addEventListener('click', () => {
      setScore((selectedScore === null ? Number(slider.value) : selectedScore) - 0.1, false);
    });
    document.getElementById('rating-plus').addEventListener('click', () => {
      setScore((selectedScore === null ? Number(slider.value) : selectedScore) + 0.1, false);
    });

    if (selectedScore !== null) {
      slider.value = String(selectedScore);
    }
    renderValue();

    // «Смотреть»: в нашем APK открываем плеер прямо в WebView приложения,
    // в браузере — пробуем встроить фреймом поверх карточки
    const watchBtn = modal.querySelector('#watch-btn');
    if (watchBtn) {
      watchBtn.addEventListener('click', () => {
        // История просмотров: «Продолжить» и прогресс берут её отсюда
        const yr = String(title.release_date || title.first_air_date || '').slice(0, 4);
        addWatchEntry({
          id: titleId,
          media_type: mediaType,
          title: title.title,
          poster_path: title.poster_path,
          kp_url: kpPageUrl,
          kpId: kpRatings && kpRatings.kpId,
          query: `${title.title || title.name || ''} ${yr}`.trim()
        });
        reportWatchNative(titleId, mediaType);
        if (isApk()) {
          // РАБОЧАЯ СХЕМА (как в v1.0.4): в приложении плеер открывается
          // страницей зеркала верхним документом — зеркало само разруливает
          // все источники своим виджетом, это заведомо работает со всеми
          // плеерами, фуллскрином и ландшафтом. Чистый список плееров —
          // только в браузере, где он идеален
          window.location.href = kpPageUrl;
          return;
        }
        openWatchOverlay({
          kpId: kpRatings && kpRatings.kpId,
          query: `${title.title || title.name || ''} ${yr}`.trim(),
          titleText: title.title || title.name || '',
          mirrorUrl: kpPageUrl
        });
      });
    }

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
        notifyTelegram(currentUser, title, selectedScore);
        if (onSaveCallback) onSaveCallback();
      } catch (e) {
        if (networkLikeError(e)) {
          // Офлайн: оценка не теряется, а встаёт в очередь на устройстве
          enqueueRating({
            title_id: title.id,
            media_type: mediaType,
            rating: selectedScore,
            comment,
            title: title.title,
            poster_path: title.poster_path
          });
          closeModal();
          showToast('Нет сети: оценка сохранена на устройстве и отправится в базу автоматически', 'info', 6000);
          if (onSaveCallback) onSaveCallback();
          return;
        }
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

// Уведомление в Телеграм-чат компании через Pages Function /tg/notify.
// Авторизация — текущей Supabase-сессией, огонь-и-забудь: бот не должен
// ломать сохранение оценки при любых сбоях.
function notifyTelegram(currentUser, title, score) {
  try {
    supabase.auth.getSession().then(({ data }) => {
      const token = data && data.session && data.session.access_token;
      if (!token) return;
      fetch('/tg/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title_id: title.id,
          media_type: title.media_type || 'movie',
          title: title.title || '',
          rating: score
        })
      }).catch(() => {});
    }).catch(() => {});
  } catch (e) { /* бот опционален */ }
}

// Крупный постер поверх всего: закрытие кликом или Esc
function openLightbox(posterPath, titleText) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6 cursor-zoom-out';
  const bigSrc = (CONFIG.TMDB_IMG_BASE || 'https://image.tmdb.org/t/p/w185').replace(/w\d+/, 'w500') + escapeHtml(posterPath);
  overlay.innerHTML = `<img src="${bigSrc}" alt="${escapeHtml(titleText || '')}" class="max-h-[85vh] max-w-full rounded-xl shadow-2xl">`;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };
  function onEsc(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
}
