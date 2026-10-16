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

  function load() {
    stage.innerHTML = '<p id="watch-status" class="text-sm text-gray-400 px-4 text-center">Ищем доступные плееры…</p>';
    playersBox.innerHTML = '';
    dubsBox.innerHTML = '';
    fetchKinoboxPlayers({ kpId, imdbId, query })
      .then((list) => {
        if (!list.length) return fallback('пустой список от API');
        groups = [];
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
        if (!startG) return fallback('все источники скрыты');
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
      .catch((err) => fallback((err && err.message) || String(err)));
  }

  function fallback(reason) {
    groups = [];
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
      b.className = 'px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm';
      b.textContent = 'Открыть страницу зеркала';
      b.addEventListener('click', () => { window.location.href = mirrorUrl; });
      row.appendChild(b);
    } else {
      const retry = document.createElement('button');
      retry.className = 'px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm';
      retry.textContent = 'Повторить поиск';
      retry.addEventListener('click', () => load());
      row.appendChild(retry);
      if (mirrorUrl) {
        const tab = document.createElement('a');
        tab.className = 'px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-gray-200 text-sm';
        tab.href = mirrorUrl;
        tab.target = '_blank';
        tab.rel = 'noopener noreferrer';
        tab.textContent = 'Зеркало в новой вкладке';
        row.appendChild(tab);
      }
    }
    box.appendChild(row);
    stage.appendChild(box);
    hint.textContent = apk
      ? 'Зеркало откроется внутри приложения со своим меню озвучек.'
      : 'Кнопка выше откроет зеркало отдельно — там просмотр работает всегда. Текст причины пригодится, если пожалуешься агенту.';
  }

  load();
}

