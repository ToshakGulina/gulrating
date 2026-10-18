import { saveRating, getUserTitleStatus, deleteRating, setUserTitleStatus } from '../lib/ratings.js';
import { getTitleDetails, getFranchiseTitles } from '../lib/tmdb.js';
import { openCatalog } from './Catalog.js';
import { getKinopoiskRatings, kinopoiskPageUrl } from '../lib/kinopoisk.js';
import { supabase } from '../lib/supabase.js';
import { addRecentTitle } from '../lib/history.js';
import { enqueueRating, networkLikeError } from '../lib/offline.js';
import { addWatchEntry, reportWatchNative, isApk, getPositions, saveWatchPosition } from '../lib/watchHistory.js';
import { fetchKinoboxPlayers, qualityRank } from '../lib/kinobox.js';
import { getOfficialWatchUrl } from '../lib/kinopoiskWatchLinks.js';
import { friendRatingsLabel } from '../lib/ratingLabels.js';
import { CONFIG } from '../config.js';
import { escapeHtml, safeAvatarUrl, releaseYear, showToast, formatRating, posterImg } from '../lib/dom.js';

// Фирменные иконки источников оценок (inline SVG по оригинальным логотипам):
// Кинопоиск — квадратная иконка сервиса: оранжевый фон и белая киноплёнка
// с четырьмя отверстиями; TMDb — зелёный (#90cea4) контур-«пузырь» с буквами
// TM/DB; друзья — розовый силуэт группы.
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

// Same-origin policy blocks inspection of most commercial player iframes.
// Search the top player frame and any same-origin descendants; cross-origin
// frames are deliberately skipped rather than weakening browser security.
function findAccessibleVideo(win, depth = 0) {
  if (!win || depth > 3) return null;
  try {
    const videos = win.document.querySelectorAll('video');
    let candidate = null;
    for (const video of videos) {
      if (Number.isFinite(video.duration) && video.duration > 0) return video;
      if (!candidate) candidate = video;
    }
    for (let i = 0; i < win.frames.length; i += 1) {
      const nested = findAccessibleVideo(win.frames[i], depth + 1);
      if (nested && Number.isFinite(nested.duration) && nested.duration > 0) return nested;
      if (!candidate) candidate = nested;
    }
    return candidate;
  } catch (e) {
    return null;
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
  const { kpId, imdbId, query, titleText, mirrorUrl, watchKey } = opts || {};
  const apk = isApk();
  const ov = document.createElement('div');
  ov.id = 'watch-overlay';
  ov.className = 'fixed inset-0 z-50 bg-black/95 flex flex-col p-3 gap-2';
  ov.innerHTML = `
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-semibold text-white truncate flex-1">▶ ${escapeHtml(titleText || '')}</h3>
      <button id="watch-close" class="rounded-xl px-2 py-1 text-2xl leading-none text-gray-300 hover:bg-slate-800 hover:text-white" aria-label="Закрыть плеер">&times;</button>
    </div>
    <div id="watch-stage" class="flex-1 relative min-h-0 rounded-xl overflow-hidden bg-black/60 flex items-center justify-center">
      <p id="watch-status" class="text-sm text-gray-400 px-4 text-center">Ищем доступные плееры…</p>
    </div>
    <div class="flex flex-col gap-1.5 flex-shrink-0">
      <div class="flex min-w-0 items-center gap-1.5">
        <div id="watch-players" class="flex min-w-0 flex-1 flex-wrap gap-1.5 content-start"></div>
        <button id="watch-mode" class="hidden flex-shrink-0 rounded-full bg-primary/20 px-3 py-1.5 text-xs text-gray-200 hover:bg-primary/30" aria-label="Переключить на зеркало">Зеркало</button>
      </div>
      <div id="watch-dubs" class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pb-1 content-start"></div>
    </div>
    <div class="watch-footer flex items-center gap-2 flex-shrink-0">
      <button id="watch-bad" class="rounded-full bg-slate-800/70 px-3 py-1.5 text-xs text-gray-400 hover:bg-slate-700 hover:text-gray-200">не играет</button>
      <p id="watch-hint" class="text-xs text-gray-500 flex-1"></p>
    </div>`;
  document.body.appendChild(ov);

  const stage = ov.querySelector('#watch-stage');
  const playersBox = ov.querySelector('#watch-players');
  const dubsBox = ov.querySelector('#watch-dubs');
  const hint = ov.querySelector('#watch-hint');
  const modeBtn = ov.querySelector('#watch-mode');
  const badBtn = ov.querySelector('#watch-bad');
  let mirrorMode = false;
  let hasPlayed = false;
  let loadGeneration = 0;
  if (!apk && mirrorUrl) modeBtn.classList.remove('hidden');
  const removeOverlayListeners = () => document.removeEventListener('keydown', ov._onKey);

  let groups = [];        // [{ type, embed, dubs: [{name, quality, url}] }]
  let curType = null;
  let curName = null;
  let showHidden = false; // показать спрятанные (браузер: только-приложение; плохие)
  let progressTimer = null;
  let savedPosition = (!apk && watchKey) ? getPositions()[watchKey] || null : null;
  const videoProgress = new WeakMap();

  function saveVideoPosition(video, state, force = false) {
    if (!watchKey || !state.resumeAttempted || !video) return;
    const t = Number(video.currentTime);
    const d = Number(video.duration);
    if (t <= 0 || !Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
    const now = Date.now();
    if (!force && now - (state.lastSavedAt || 0) < 10_000) return;
    if (saveWatchPosition(watchKey, t, d, force)) {
      state.lastSavedAt = now;
      savedPosition = { t, d, at: now };
    }
  }

  function tryResumeVideo(video, state) {
    if (state.resumeAttempted) return true;
    if (!savedPosition || !Number.isFinite(video.duration) || video.duration <= 0) return false;
    const target = Number(savedPosition.t);
    if (!Number.isFinite(target) || target < 30 || target >= video.duration - 10) {
      state.resumeAttempted = true;
      return true;
    }
    // Не перебиваем осознанное воспроизведение/перемотку, но успеваем
    // продолжить, если autoplay продвинулся немного до загрузки метаданных.
    if (video.currentTime > 15) {
      state.resumeAttempted = true;
      return true;
    }
    try {
      video.currentTime = target;
      state.resumeAttempted = true;
    } catch (e) {
      state.resumeAttempted = true;
    }
    return state.resumeAttempted;
  }

  function inspectPlayerFrame() {
    if (apk || !watchKey) return;
    const frame = stage.querySelector('#watch-frame');
    if (!frame) return;
    const video = findAccessibleVideo(frame.contentWindow);
    if (!video) return;
    let state = videoProgress.get(video);
    if (!state) {
      state = {
        resumeAttempted: !savedPosition || Number(savedPosition.t) < 30,
        lastSavedAt: Number(savedPosition && savedPosition.at) || 0
      };
      videoProgress.set(video, state);
      video.addEventListener('loadedmetadata', () => {
        if (tryResumeVideo(video, state)) saveVideoPosition(video, state);
      });
      video.addEventListener('timeupdate', () => saveVideoPosition(video, state));
      video.addEventListener('pause', () => saveVideoPosition(video, state, true));
      video.addEventListener('seeked', () => saveVideoPosition(video, state, true));
      video.addEventListener('ended', () => saveVideoPosition(video, state, true));
    }
    if (tryResumeVideo(video, state)) saveVideoPosition(video, state);
  }

  function saveCurrentProgress() {
    const frame = stage.querySelector('#watch-frame');
    const video = frame && findAccessibleVideo(frame.contentWindow);
    const state = video && videoProgress.get(video);
    if (video && state) saveVideoPosition(video, state, true);
  }

  function onProgressVisibilityChange() {
    if (document.visibilityState !== 'hidden') return;
    inspectPlayerFrame();
    saveCurrentProgress();
  }

  function onProgressPageHide() {
    inspectPlayerFrame();
    saveCurrentProgress();
  }

  function startProgressTracking(frame) {
    if (apk || !watchKey) return;
    frame.addEventListener('load', inspectPlayerFrame);
    if (progressTimer) clearInterval(progressTimer);
    inspectPlayerFrame();
    progressTimer = setInterval(inspectPlayerFrame, 1500);
    document.addEventListener('visibilitychange', onProgressVisibilityChange);
    window.addEventListener('pagehide', onProgressPageHide);
  }

  function stopProgressTracking() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    saveCurrentProgress();
    document.removeEventListener('visibilitychange', onProgressVisibilityChange);
    window.removeEventListener('pagehide', onProgressPageHide);
  }

  const CHIP = 'px-3 py-1.5 rounded-full text-xs whitespace-nowrap flex-shrink-0 ';
  const CHIP_IDLE = CHIP + 'bg-slate-800 hover:bg-slate-700 text-gray-200';
  const CHIP_ON = CHIP + 'bg-primary text-white';

  function showFrame(url, provider = '') {
    if (!apk && watchKey) saveCurrentProgress();
    stage.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.id = 'watch-frame';
    frame.className = 'absolute inset-0 w-full h-full bg-black';
    frame.allow = 'fullscreen *; encrypted-media *; autoplay *; picture-in-picture *';
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('webkitallowfullscreen', '');
    // Большинство источников ожидает origin; по данным ShikiPlayer только
    // Gendit/Gencit и Flixcdn требуют no-referrer.
    frame.referrerPolicy = /^(gencit|gendit|flixcdn)$/i.test(provider) ? 'no-referrer' : 'origin';
    frame.src = url;
    stage.appendChild(frame);
    startProgressTracking(frame);
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
    hasPlayed = true;
    if (apk) {
      // Embed-only (Alloha, Turbo) — во фрейм, как в браузере: верхним
      // документом они отказываются работать. Остальные — верхним
      // документом через мост: так нативно пишутся прогресс и продолжение
      if (isEmbedOnly(dub.url)) {
        showFrame(dub.url, group && group.type);
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
    // В браузере оставляем списки источника/озвучки видимыми рядом с плеером;
    // кросс-доменный iframe нельзя развернуть в настоящее fullscreen из родителя.
    showFrame(dub.url, group && group.type);
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
        // До первого запуска источник только меняет список озвучек. Во время
        // просмотра выбор другого источника сразу переключает iframe на
        // сохранённую озвучку либо на первую доступную для него.
        curType = g.type;
        curName = (g.dubs.find((d) => d.name === curName) || g.dubs[0] || {}).name || null;
        renderPlayers();
        renderDubs();
        if (hasPlayed) {
          const nextGroup = curGroup();
          const nextDub = curDub();
          if (nextDub) {
            play(nextDub, nextGroup, true);
            remember();
          }
        }
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
        play(d, g, true); // запуск сразу; в APK вход в кино-режим
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
      hint.textContent = 'Живых источников не осталось. Попробуйте другой плеер или повторите поиск.';
    }
  });

  modeBtn.addEventListener('click', () => {
    if (!mirrorUrl || apk) return;
    mirrorMode = !mirrorMode;
    modeBtn.textContent = mirrorMode ? 'Источники' : 'Зеркало';
    modeBtn.setAttribute('aria-label', mirrorMode ? 'Вернуться к прямым источникам' : 'Переключить на зеркало');
    if (mirrorMode) {
      loadGeneration += 1;
      playersBox.style.display = 'none';
      dubsBox.style.display = 'none';
      badBtn.style.display = 'none';
      hint.textContent = 'Открыто зеркало внутри GulRating. Нажмите «Источники», чтобы вернуться к прямым плеерам.';
      showFrame(mirrorUrl);
    } else {
      playersBox.style.display = '';
      dubsBox.style.display = '';
      badBtn.style.display = '';
      load();
    }
  });
  ov.querySelector('#watch-close').addEventListener('click', () => {
    stopProgressTracking();
    removeOverlayListeners();
    ov.remove();
  });
  ov._onKey = (e) => {
    if (!ov.isConnected) {
      removeOverlayListeners();
      return;
    }
    if (e.key === 'Escape') {
      stopProgressTracking();
      removeOverlayListeners();
      ov.remove();
    }
  };
  document.addEventListener('keydown', ov._onKey);

  function load() {
    const generation = ++loadGeneration;
    badBtn.style.display = '';
    stage.innerHTML = '<p id="watch-status" class="text-sm text-gray-400 px-4 text-center">Ищем доступные плееры…</p>';
    playersBox.innerHTML = '';
    dubsBox.innerHTML = '';
    fetchKinoboxPlayers({ kpId, imdbId, query })
      .then((list) => {
        if (generation !== loadGeneration || mirrorMode) return;
        if (!list.length) return fallback('пустой список от API');
        groups = [];
        // Группируем по источнику, сохраняя порядок ответа
        for (const item of list) {
          let g = groups.find((x) => x.type === item.type);
          if (!g) {
            g = { type: item.type, embed: item.embed || 'any', dubs: [] };
            groups.push(g);
          }
          const candidate = { name: item.name, quality: item.quality, url: item.url };
          const existingIndex = g.dubs.findIndex((d) => d.name === candidate.name);
          if (existingIndex < 0) {
            g.dubs.push(candidate);
          } else if (qualityRank(candidate.quality) > qualityRank(g.dubs[existingIndex].quality)) {
            // Если Kinobox отдал ту же озвучку несколькими вариантами,
            // сохраняем iframe с максимальным заявленным качеством.
            g.dubs[existingIndex] = candidate;
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
        if (!startG) return fallback('все источники скрыты');
        curType = startG.type;
        curName = (last && startG.dubs.find((d) => d.name === last.name) ? last.name : (startG.dubs[0] || {}).name) || null;
        renderPlayers();
        renderDubs();
        if (!apk && hasPlayed) {
          play(curDub(), startG, true);
        } else if (!apk) {
          stage.innerHTML = '<p class="text-sm text-gray-300 px-4 text-center">Выберите озвучку ниже — плеер запустится, а источники останутся доступны.</p>';
        } else {
          stage.innerHTML = '<p class="text-sm text-gray-300 px-4 text-center">Выберите источник и озвучку — плеер откроется внутри приложения.<br>Кнопка ⛶ внутри плеера развернёт видео на весь экран.</p>';
        }
        hint.textContent = apk
          ? 'Тап по источнику — только выбор; тап по озвучке — запуск сразу во весь экран (ландшафт). Back — обычный вид. У источников с одной кнопкой озвучки переключает меню самого плеера.'
          : 'Выберите озвучку для запуска. Список источников остаётся видимым; позиция запоминается, если источник разрешает браузеру её прочитать.';
      })
      .catch((err) => {
        if (generation === loadGeneration && !mirrorMode) {
          fallback((err && err.message) || String(err));
        }
      });
  }

  function fallback(reason) {
    groups = [];
    badBtn.style.display = 'none';
    playersBox.innerHTML = '';
    dubsBox.innerHTML = '';
    stage.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'flex flex-col items-center gap-3 px-4 text-center';
    const msg = document.createElement('p');
    msg.className = 'text-sm text-gray-300';
    msg.textContent = apk
      ? 'Открываем страницу зеркала — в приложении это рабочая схема.'
      : 'Список плееров получить не удалось. Причина:';
    box.appendChild(msg);
    if (!apk) {
      const why = document.createElement('p');
      why.className = 'text-[11px] text-gray-500 break-all max-h-16 overflow-y-auto';
      why.textContent = reason || 'неизвестно';
      box.appendChild(why);
    }
    const row = document.createElement('div');
    row.className = 'flex gap-2 flex-wrap justify-center';
    if (apk) {
      const b = document.createElement('button');
      b.className = 'px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm';
      b.textContent = 'Открыть страницу зеркала';
      b.addEventListener('click', () => { window.location.href = mirrorUrl; });
      row.appendChild(b);
    } else {
      const retry = document.createElement('button');
      retry.className = 'px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm';
      retry.textContent = 'Повторить поиск';
      retry.addEventListener('click', () => load());
      row.appendChild(retry);
    }
    box.appendChild(row);
    stage.appendChild(box);
    hint.textContent = apk
      ? 'Зеркало откроется внутри приложения со своим меню озвучек.'
      : 'Останьтесь в GulRating и повторите поиск позже; источник не открывается во вкладке браузера.';
  }

  // Сначала пробуем прямые Kinobox iframeUrl с referrerPolicy=origin.
  // Кнопка «Зеркало» оставляет прежний рабочий сценарий рядом как резерв.
  load();
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

function formatRatingCount(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'оценка'
    : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? 'оценки'
    : 'оценок';
  return `${n} ${word}`;
}

const FRIENDS_ICON = '<svg viewBox="0 0 24 24" class="w-4 h-4 flex-shrink-0" aria-hidden="true" fill="#f472b6"><path d="M9 11a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v2h16v-2c0-3.3-4.7-5-8-5zm8-2a3.5 3.5 0 10-2.4-6 5.5 5.5 0 010 8c.8.6 1.6 1 2.4 1zm0 2c-.6 0-1.3-.1-2-.3 1.2 1 2 2.3 2 3.8v1.5h6v-2c0-2.2-3.6-3-6-3z"/></svg>';

// Пока оценка не выбрана, пузырёк над бегунком показывает позицию серым

export async function openRatingModal(titleId, mediaType, currentUser, onSaveCallback) {
  // Создаем оверлей модалки
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm';
  modal.innerHTML = `
    <div class="rating-modal-panel bg-card w-full max-w-lg rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
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
            <div class="w-28 aspect-[2/3] bg-slate-700 rounded-xl"></div>
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
        .catch(() => ({ hasRating: false, rating: null, isInWatchlist: false, currentStatus: '' })),
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

    const sharedRatings = allRatings;
    const friendRatings = sharedRatings.filter((r) => r.user_id !== currentUser.id);
    const scoreLabel = friendRatingsLabel(friendRatings);
    const averageRating = sharedRatings.length > 0
      ? (sharedRatings.reduce((sum, r) => sum + Number(r.rating), 0) / sharedRatings.length).toFixed(1)
      : null;
    const friendRatingRows = sharedRatings.map((r) => {
      const username = r.profiles?.username || 'Участник';
      const score = Number(r.rating);
      const scoreColor = score >= 8 ? 'text-green-300' : score >= 5 ? 'text-yellow-300' : 'text-red-300';
      return `<li class="flex min-w-0 items-center gap-2 rounded-lg bg-slate-800/80 px-2 py-1.5">
        <img src="${escapeHtml(safeAvatarUrl(r.profiles?.avatar_url, username))}" alt="" class="h-6 w-6 flex-shrink-0 rounded-full bg-slate-700 object-cover">
        <span class="min-w-0 flex-1 truncate text-xs text-gray-200">${escapeHtml(username)}</span>
        <b class="flex-shrink-0 text-xs ${scoreColor}">${escapeHtml(formatRating(score))}</b>
      </li>`;
    }).join('');

    // Подпись стоит перед средним баллом; по наведению/фокусу или нажатию
    // можно посмотреть, чьи оценки вошли в среднее.
    const friendsBadge = averageRating
      ? `<div class="friends-score-details relative inline-block">
          <button id="friends-score-trigger" type="button" class="friends-score-pill friends-score-trigger inline-flex items-center gap-1.5 rounded-full border border-pink-400/20 bg-pink-400/10 px-2.5 py-1 text-xs text-gray-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="${escapeHtml(`${scoreLabel}: ${averageRating}. Показать список оценок`)}" aria-expanded="false" aria-controls="friends-score-popover" title="Наведите или нажмите, чтобы увидеть список оценок">${FRIENDS_ICON}<span class="text-gray-500">${escapeHtml(scoreLabel)}</span><b class="text-pink-300">${averageRating}</b><span class="text-gray-500">· ${formatRatingCount(sharedRatings.length)}</span></button>
          <div id="friends-score-popover" class="friends-score-popover rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl" role="region" aria-label="Список оценок">
            <ul class="space-y-1">${friendRatingRows}</ul>
          </div>
        </div>`
      : '';

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
    const kpWatchUrl = getOfficialWatchUrl(kpRatings && kpRatings.watchability, 'kinopoisk');
    const iviWatchUrl = getOfficialWatchUrl(kpRatings && kpRatings.watchability, 'ivi');
    const platformWatchLinks = [
      kpWatchUrl ? { name: 'Кинопоиск', url: kpWatchUrl } : null,
      iviWatchUrl ? { name: 'Иви', url: iviWatchUrl } : null
    ].filter(Boolean);
    const platformWatchLinksHtml = platformWatchLinks.length
      ? `<div class="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Прямые ссылки просмотра">
          ${platformWatchLinks.map(link => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="Прямая ссылка просмотра из watchability API Кинопоиска" class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-gray-200 hover:border-primary/60 hover:text-white">▶ Смотреть на ${escapeHtml(link.name)}</a>`).join('')}
        </div>`
      : '';
    modal.querySelector('h2').textContent = title.title || 'Фильм';

    document.getElementById('modal-content').innerHTML = `
      <div id="franchise-tabs" class="hidden -mx-4 -mt-4 mb-4 border-b border-slate-700 bg-slate-900/70 px-4 py-2.5">
        <div class="flex items-center gap-1.5">
          <button type="button" class="franchise-scroll-left hidden h-8 w-8 flex-shrink-0 rounded-lg bg-slate-800 text-gray-300 hover:bg-slate-700" aria-label="Прокрутить к предыдущим частям">‹</button>
          <div class="franchise-tabs-list flex min-w-0 flex-1 gap-1.5 overflow-x-auto" role="tablist" aria-label="Другие части"></div>
          <button type="button" class="franchise-scroll-right hidden h-8 w-8 flex-shrink-0 rounded-lg bg-slate-800 text-gray-300 hover:bg-slate-700" aria-label="Прокрутить к следующим частям">›</button>
        </div>
      </div>
      <div class="flex gap-4 mb-4">
        <div id="poster-box" class="flex-shrink-0 w-28 ${title.poster_path ? 'cursor-zoom-in' : ''}" title="${title.poster_path ? 'Открыть постер' : ''}">
          ${posterImg(title.poster_path, title.title, 'w-full aspect-[2/3] rounded-xl')}
          <label class="mt-2 block cursor-default">
            <span class="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-gray-500">Статус</span>
            <select id="title-status-select" class="w-full rounded-lg border border-slate-600 bg-slate-800 px-1 py-1.5 text-[10px] font-medium text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary" data-current-status="${escapeHtml(status.currentStatus || '')}" aria-label="Статус: ${escapeHtml(title.title)}" ${currentUser.offlineOnly || (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'disabled title="Недоступно офлайн"' : ''}>
              <option value="" ${!status.currentStatus ? 'selected' : ''}>Не отмечено</option>
              <option value="watchlist" ${status.currentStatus === 'watchlist' ? 'selected' : ''} ${status.hasRating ? 'disabled' : ''}>Хочу посмотреть</option>
              <option value="in_progress" ${status.currentStatus === 'in_progress' ? 'selected' : ''}>В процессе</option>
              <option value="watched" ${status.currentStatus === 'watched' ? 'selected' : ''}>Просмотрено</option>
              <option value="dropped" ${status.currentStatus === 'dropped' ? 'selected' : ''}>Заброшено</option>
            </select>
          </label>
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
          <button id="watch-btn" class="watch-action-btn inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 mb-2 text-sm font-medium text-primary hover:bg-primary/20 hover:text-white transition-colors"><span aria-hidden="true">▶</span> Смотреть</button>
          ${platformWatchLinksHtml}
          <div class="flex flex-col items-start gap-1.5 text-sm">
            ${visibleRows.map(row => `<span class="flex items-center gap-1.5">${row}</span>`).join('')}
            ${friendsBadge}
            ${extraRows.length ? `
              <button id="more-ratings-btn" class="rating-more-btn rounded-xl bg-slate-800 px-2.5 py-1 text-[11px] text-gray-300 hover:bg-slate-700 hover:text-white text-left">Ещё рейтинги · ${extraRows.length}</button>
              <span id="more-ratings" class="hidden flex-col items-start gap-1.5">
                ${extraRows.map(row => `<span class="flex items-center gap-1.5">${row}</span>`).join('')}
              </span>
            ` : ''}
          </div>
        </div>
      </div>

      ${title.overview ? `
        <p id="overview-text" class="text-sm text-gray-300 mb-1 line-clamp-3">${escapeHtml(title.overview)}</p>
        <button id="overview-toggle" class="text-xs text-primary hover:underline mb-4 hidden" aria-controls="overview-text" aria-expanded="false">Читать дальше</button>
      ` : ''}

      <div class="border-t border-slate-700 pt-4 mb-4">
        <h4 class="font-semibold mb-3">Ваша оценка</h4>

        <!-- Слайдер оценки: значение живёт в пузырьке над бегунком -->
        <div class="flex items-center gap-3 mb-3 mt-9">
          <button id="rating-minus" class="w-10 h-10 flex-shrink-0 rounded-full bg-slate-700 hover:bg-slate-600 text-xl font-bold" aria-label="Минус 0.1">−</button>
          <div class="relative flex-1">
            <div id="rating-bubble" class="absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-xl text-sm font-bold pointer-events-none whitespace-nowrap border border-slate-600 bg-slate-800 text-gray-400"></div>
            <input type="range" id="rating-slider" min="1" max="10" step="0.1" class="rating-slider w-full" aria-label="Оценка от 1 до 10">
          </div>
          <button id="rating-plus" class="w-10 h-10 flex-shrink-0 rounded-full bg-slate-700 hover:bg-slate-600 text-xl font-bold" aria-label="Плюс 0.1">+</button>
        </div>
        <p class="text-xs text-gray-500 text-center mb-3">Тяните бегунок или листайте кнопками — шаг 0.1</p>

        <textarea id="rating-comment" placeholder="Комментарий (опционально)" rows="2"
          class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-white placeholder-gray-500 text-sm mb-3"
        >${escapeHtml(status.hasRating ? (status.rating.comment || '') : '')}</textarea>
        <div class="flex gap-2">
          <button id="save-rating-btn" class="flex-1 bg-primary hover:bg-primary/90 text-white font-medium py-2 px-4 rounded-xl transition-colors" title="Сохранить оценку и закрыть карточку">
            ${status.hasRating ? 'Обновить оценку' : 'Поставить оценку'}
          </button>
          <button id="save-rating-keep-open-btn" class="border border-slate-600 bg-slate-800 hover:bg-slate-700 text-gray-200 font-medium py-2 px-4 rounded-xl transition-colors" title="Сохранить оценку, оставив карточку открытой">
            Сохранить
          </button>
          <button id="delete-rating-btn" class="px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-xl transition-colors ${status.hasRating ? '' : 'hidden'}">
            Удалить
          </button>
        </div>

      </div>

      ${allRatings.length > 0 ? `
        <details class="friends-ratings-details border-t border-slate-700 pt-3">
          <summary class="cursor-pointer select-none rounded-xl px-2.5 py-2 text-sm text-gray-300 hover:bg-slate-800">
            Список оценок <span class="text-gray-500">· ${formatRatingCount(allRatings.length)}</span>
          </summary>
          <div class="mt-2 space-y-2 px-2">
            ${allRatings.map(r => `
              <div class="flex items-center gap-2.5 rounded-xl bg-slate-800/60 px-2.5 py-2">
                <img src="${escapeHtml(safeAvatarUrl(r.profiles.avatar_url, r.profiles.username))}" alt="" class="w-7 h-7 rounded-full bg-slate-700">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium text-xs truncate">${escapeHtml(r.profiles.username)}</span>
                    <span class="font-bold text-xs ${Number(r.rating) >= 8 ? 'text-green-400' : Number(r.rating) >= 5 ? 'text-yellow-400' : 'text-red-400'}">${escapeHtml(formatRating(r.rating))}</span>
                  </div>
                  ${r.comment ? `<p class="text-xs text-gray-400 mt-0.5 line-clamp-2">${escapeHtml(r.comment)}</p>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
      `;

    // Рядом с заголовком показываем вкладки других частей франшизы.
    // TMDb-коллекцию фильмов дополняем точными совпадениями поиска сериалов.
    const franchiseBox = modal.querySelector('#franchise-tabs');
    getFranchiseTitles(titleId, mediaType).then(parts => {
      if (!modal.isConnected || !franchiseBox || !Array.isArray(parts) || parts.length < 2) return;
      franchiseBox.classList.remove('hidden');
      const tabs = franchiseBox.querySelector('.franchise-tabs-list');
      tabs.innerHTML = parts.map(part => {
        const selected = Number(part.id) === Number(titleId) && part.media_type === mediaType;
        const partYear = releaseYear(part.release_date);
        return `<button type="button" role="tab" aria-selected="${selected}" data-title-id="${escapeHtml(part.id)}" data-media-type="${escapeHtml(part.media_type)}" class="franchise-tab max-w-[210px] flex-shrink-0 truncate whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${selected ? 'border-primary bg-primary text-white' : 'border-slate-700 bg-slate-800 text-gray-300 hover:bg-slate-700'}">${escapeHtml(part.title || 'Тайтл')}${partYear ? ` · ${escapeHtml(partYear)}` : ''}</button>`;
      }).join('');
      tabs.querySelectorAll('.franchise-tab').forEach(tab => tab.addEventListener('click', () => {
        if (Number(tab.dataset.titleId) === Number(titleId) && tab.dataset.mediaType === mediaType) return;
        closeModal();
        openRatingModal(tab.dataset.titleId, tab.dataset.mediaType, currentUser, onSaveCallback);
      }));

      const scrollLeftButton = franchiseBox.querySelector('.franchise-scroll-left');
      const scrollRightButton = franchiseBox.querySelector('.franchise-scroll-right');
      const updateFranchiseScrollButtons = () => {
        const maxScroll = tabs.scrollWidth - tabs.clientWidth;
        const canScroll = maxScroll > 2;
        scrollLeftButton.classList.toggle('hidden', !canScroll || tabs.scrollLeft <= 2);
        scrollRightButton.classList.toggle('hidden', !canScroll || tabs.scrollLeft >= maxScroll - 2);
      };
      scrollLeftButton.addEventListener('click', () => tabs.scrollBy({ left: -Math.max(180, tabs.clientWidth * 0.75), behavior: 'smooth' }));
      scrollRightButton.addEventListener('click', () => tabs.scrollBy({ left: Math.max(180, tabs.clientWidth * 0.75), behavior: 'smooth' }));
      tabs.addEventListener('scroll', updateFranchiseScrollButtons, { passive: true });
      requestAnimationFrame(updateFranchiseScrollButtons);
    }).catch(() => {});

    // Статус живёт в карточке тайтла под постером, отдельно от блока оценки.
    const titleStatusSelect = modal.querySelector('#title-status-select');
    if (titleStatusSelect) {
      titleStatusSelect.addEventListener('click', event => event.stopPropagation());
      titleStatusSelect.addEventListener('keydown', event => event.stopPropagation());
      titleStatusSelect.addEventListener('change', async event => {
        event.stopPropagation();
        const nextStatus = titleStatusSelect.value;
        const previousStatus = titleStatusSelect.dataset.currentStatus || '';
        if (nextStatus === previousStatus) return;
        titleStatusSelect.disabled = true;
        try {
          await setUserTitleStatus(currentUser.id, titleId, mediaType, nextStatus);
          status.currentStatus = nextStatus || (status.hasRating ? 'watched' : '');
          status.isInWatchlist = status.currentStatus === 'watchlist';
          titleStatusSelect.dataset.currentStatus = status.currentStatus;
          titleStatusSelect.value = status.currentStatus;
          const labels = { watchlist: 'Хочу посмотреть', in_progress: 'В процессе', watched: 'Просмотрено', dropped: 'Заброшено', '': 'Не отмечено' };
          showToast(`Статус: ${labels[status.currentStatus] || labels['']}`, 'success');
          if (onSaveCallback) onSaveCallback();
        } catch (error) {
          if (error && error.statusSaved) {
            status.currentStatus = nextStatus;
            titleStatusSelect.dataset.currentStatus = nextStatus;
            showToast(error.message, 'error', 6000);
            if (onSaveCallback) onSaveCallback();
          } else {
            titleStatusSelect.value = previousStatus;
            showToast(`Не удалось изменить статус: ${error.message}`, 'error', 5000);
          }
        } finally {
          titleStatusSelect.disabled = false;
        }
      });
    }

    const friendScoreDetails = modal.querySelector('.friends-score-details');
    const friendScoreTrigger = modal.querySelector('#friends-score-trigger');
    if (friendScoreDetails && friendScoreTrigger) {
      const setFriendsPopoverOpen = (open) => {
        friendScoreDetails.dataset.open = String(open);
        friendScoreTrigger.setAttribute('aria-expanded', String(open));
      };
      friendScoreTrigger.addEventListener('click', () => {
        if (friendScoreDetails.dataset.open === 'true') {
          setFriendsPopoverOpen(false);
          friendScoreTrigger.blur();
        } else {
          setFriendsPopoverOpen(true);
        }
      });
      friendScoreTrigger.addEventListener('focus', () => {
        friendScoreTrigger.setAttribute('aria-expanded', 'true');
      });
      friendScoreDetails.addEventListener('pointerenter', () => {
        if (window.matchMedia('(hover: hover)').matches) friendScoreTrigger.setAttribute('aria-expanded', 'true');
      });
      friendScoreDetails.addEventListener('pointerleave', () => {
        if (friendScoreDetails.dataset.open !== 'true' && !friendScoreDetails.contains(document.activeElement)) {
          friendScoreTrigger.setAttribute('aria-expanded', 'false');
        }
      });
      friendScoreTrigger.addEventListener('blur', () => {
        if (friendScoreDetails.dataset.open !== 'true') setFriendsPopoverOpen(false);
      });
      friendScoreTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setFriendsPopoverOpen(false);
          friendScoreTrigger.blur();
        }
      });
      modal.addEventListener('click', (e) => {
        if (friendScoreDetails.dataset.open === 'true' && !friendScoreDetails.contains(e.target)) {
          setFriendsPopoverOpen(false);
          friendScoreTrigger.blur();
        }
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
        moreBtn.textContent = opened ? 'Скрыть рейтинги' : `Ещё рейтинги · ${moreBox.children.length}`;
      });
    }

    // --- Раскрывающееся описание ---
    const overviewText = document.getElementById('overview-text');
    const overviewToggle = document.getElementById('overview-toggle');
    if (overviewText && overviewToggle) {
      // Некоторые браузеры возвращают scrollHeight уже обрезанного текста
      // при -webkit-line-clamp. Сравниваем с невидимой копией без clamp,
      // сохраняя фактическую ширину и типографику элемента.
      const visibleHeight = overviewText.getBoundingClientRect().height;
      const fullCopy = overviewText.cloneNode(true);
      fullCopy.removeAttribute('id');
      fullCopy.setAttribute('aria-hidden', 'true');
      fullCopy.classList.remove('line-clamp-3');
      Object.assign(fullCopy.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        width: `${overviewText.getBoundingClientRect().width}px`,
        height: 'auto',
        maxHeight: 'none',
        overflow: 'visible',
        display: 'block',
        visibility: 'hidden',
        pointerEvents: 'none',
      });
      document.body.appendChild(fullCopy);
      const fullHeight = fullCopy.getBoundingClientRect().height;
      fullCopy.remove();

      if (visibleHeight > 0 && fullHeight > visibleHeight + 1) {
        overviewToggle.classList.remove('hidden');
      }
      overviewToggle.addEventListener('click', () => {
        const collapsed = overviewText.classList.toggle('line-clamp-3');
        overviewToggle.textContent = collapsed ? 'Читать дальше' : 'Свернуть';
        overviewToggle.setAttribute('aria-expanded', String(!collapsed));
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
        ? 'absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-xl text-sm font-bold pointer-events-none whitespace-nowrap border border-slate-600 bg-slate-800 text-gray-400'
        : `absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-xl text-sm font-bold pointer-events-none whitespace-nowrap border border-transparent text-white ${valueBg(selectedScore)}`;
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

    // «Смотреть»: в браузере страница зеркала открывается во фрейме
    // оверлея с крестиком; в APK — верхним документом WebView.
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
        if (isApk() && kpPageUrl) {
          window.location.href = kpPageUrl;
          return;
        }
        openWatchOverlay({
          kpId: kpRatings && kpRatings.kpId,
          query: `${title.title || title.name || ''} ${yr}`.trim(),
          titleText: title.title || title.name || '',
          mirrorUrl: kpPageUrl,
          watchKey: `${mediaType}:${titleId}`
        });
      });
    }

    // Оценку можно сохранить и закрыть карточку либо сохранить, оставив её открытой.
    const saveRatingButton = modal.querySelector('#save-rating-btn');
    const keepRatingModalOpenButton = modal.querySelector('#save-rating-keep-open-btn');
    const deleteRatingButton = modal.querySelector('#delete-rating-btn');

    const syncSavedRatingState = (score, comment) => {
      status.hasRating = true;
      status.rating = { ...(status.rating || {}), rating: score, comment };
      status.currentStatus = 'watched';
      saveRatingButton.textContent = 'Обновить оценку';
      const statusSelect = modal.querySelector('#title-status-select');
      if (statusSelect) {
        statusSelect.value = 'watched';
        statusSelect.dataset.currentStatus = 'watched';
      }
      deleteRatingButton?.classList.remove('hidden');
    };

    const saveSelectedRating = async (closeAfterSave, button) => {
      if (selectedScore === null) {
        showToast('Подвиньте бегунок, чтобы поставить оценку', 'error');
        return;
      }
      const comment = document.getElementById('rating-comment').value.trim();
      const buttons = [saveRatingButton, keepRatingModalOpenButton];
      buttons.forEach(control => { control.disabled = true; });
      button.textContent = 'Сохраняем...';

      try {
        await saveRating(currentUser.id, titleId, mediaType, selectedScore, comment);
        syncSavedRatingState(selectedScore, comment);
        if (closeAfterSave) closeModal();
        showToast(`Оценка ${formatRating(selectedScore)} сохранена`, 'success');
        notifyTelegram(currentUser, title, selectedScore);
        if (onSaveCallback) onSaveCallback();
      } catch (e) {
        if (e && e.ratingSaved) {
          // Оценка уже в базе: не отправляем её повторно в офлайн-очередь.
          syncSavedRatingState(selectedScore, comment);
          if (closeAfterSave) closeModal();
          showToast(e.message, 'error', 6000);
          notifyTelegram(currentUser, title, selectedScore);
          if (onSaveCallback) onSaveCallback();
          return;
        }
        if (networkLikeError(e)) {
          enqueueRating({
            title_id: title.id,
            media_type: mediaType,
            rating: selectedScore,
            comment,
            title: title.title,
            poster_path: title.poster_path
          });
          if (closeAfterSave) closeModal();
          showToast('Нет сети: оценка сохранена на устройстве и отправится в базу автоматически', 'info', 6000);
          if (onSaveCallback) onSaveCallback();
          return;
        }
        showToast('Ошибка при сохранении: ' + e.message, 'error', 5000);
      } finally {
        buttons.forEach(control => { control.disabled = false; });
        if (modal.isConnected) {
          saveRatingButton.textContent = status.hasRating ? 'Обновить оценку' : 'Поставить оценку';
          keepRatingModalOpenButton.textContent = 'Сохранить';
        }
      }
    };

    saveRatingButton.addEventListener('click', () => saveSelectedRating(true, saveRatingButton));
    keepRatingModalOpenButton.addEventListener('click', () => saveSelectedRating(false, keepRatingModalOpenButton));

    // Удаление оценки; кнопка появляется после первого сохранения без закрытия.
    deleteRatingButton?.addEventListener('click', async () => {
      if (!status.hasRating || !confirm('Удалить вашу оценку?')) return;
      try {
        await deleteRating(currentUser.id, titleId);
        closeModal();
        showToast('Оценка удалена', 'success');
        if (onSaveCallback) onSaveCallback();
      } catch (e) {
        showToast('Ошибка при удалении: ' + e.message, 'error', 5000);
      }
    });

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
