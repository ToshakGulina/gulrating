/*
 * Runs at document-start in the player page and every embedded frame.
 * The Android WebView bridge is available in frames even when the parent cannot
 * inspect them because of the browser's same-origin policy.
 */
(function installGulRatingProgressTracker() {
  'use strict';

  var bridge = window.GulRatingBridge;
  if (!bridge || typeof bridge.isPlaybackTrackingActive !== 'function') return;
  try {
    if (!bridge.isPlaybackTrackingActive()) return;
  } catch (error) {
    return;
  }

  if (window.__gulRatingProgressTrackerInstalled) return;
  window.__gulRatingProgressTrackerInstalled = true;

  var hookedVideos = new WeakSet();
  var lastSentAt = new WeakMap();
  var scanTimer = null;

  function getCurrentKey() {
    try {
      return bridge.getCurrentWatchKey() || '';
    } catch (error) {
      return '';
    }
  }

  function normalizeEpisode(season, episode) {
    var s = Number(season);
    var e = Number(episode);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 999 || e < 1 || e > 9999) return null;
    return { season: s, episode: e, key: 's' + String(s).padStart(2, '0') + 'e' + String(e).padStart(2, '0') };
  }

  function episodeFromText(value) {
    var text = String(value || '').replace(/[?#&]/g, ' ');
    var query;
    try {
      query = new URL(value, window.location.href).searchParams;
      var season = query.get('season') || query.get('season_number') || query.get('s');
      var episode = query.get('episode') || query.get('episode_number') || query.get('ep') || query.get('e');
      if (season && episode) return normalizeEpisode(season, episode);
    } catch (error) { /* text may not be a URL */ }
    var match = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,4})(?:$|[^a-z0-9])/i.exec(text)
      || /(?:^|[^\d])(\d{1,3})\s*x\s*(\d{1,4})(?:$|[^\d])/i.exec(text)
      || /(?:season|сезон)\s*#?\s*(\d{1,3})[^\d]{0,32}(?:episode|эпизод|сер(?:ия|ии|ию))\s*#?\s*(\d{1,4})/i.exec(text)
      || /(?:^|[^\d])(\d{1,3})\s*сезон[^\d]{0,24}(\d{1,4})\s*сер(?:ия|ии|ию)(?:$|[^а-яё])/i.exec(text);
    if (match) return normalizeEpisode(match[1], match[2]);
    match = /(?:episode|эпизод|сер(?:ия|ии|ию))\s*#?\s*(\d{1,4})[^\d]{0,32}(?:season|сезон)\s*#?\s*(\d{1,3})/i.exec(text);
    return match ? normalizeEpisode(match[2], match[1]) : null;
  }

  function detectEpisode(video) {
    var candidates = [window.location.href, document.title];
    if (video) {
      candidates.push(video.currentSrc, video.src);
      if (typeof video.getAttribute === 'function') candidates.push(video.getAttribute('title'), video.getAttribute('aria-label'));
    }
    for (var i = 0; i < candidates.length; i += 1) {
      var episode = episodeFromText(candidates[i]);
      if (episode) return episode;
    }
    return null;
  }

  function getDuration(video) {
    var duration = Number(video.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    try {
      var ranges = video.seekable;
      if (ranges && ranges.length > 0) {
        var start = Number(ranges.start(0));
        var end = Number(ranges.end(ranges.length - 1));
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
      }
    } catch (error) {
      // Some streaming engines expose a transient, unreadable seekable range.
    }
    return 0;
  }

  function save(video, force) {
    var key = getCurrentKey();
    if (!key || !video) return;

    var currentTime = Number(video.currentTime);
    var duration = getDuration(video);
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration)
        || currentTime <= 0 || duration <= 0 || currentTime > duration + 30) return;

    var now = Date.now();
    var last = lastSentAt.get(video) || 0;
    if (!force && now - last < 3500) return;
    if (!force && video.paused) return;

    lastSentAt.set(video, now);
    try {
      var episode = detectEpisode(video);
      bridge.savePlaybackPosition(JSON.stringify({
        t: currentTime,
        d: duration,
        force: Boolean(force),
        episode: episode
      }));
    } catch (error) {
      // Native tracking is optional; a page must never fail because of it.
    }
  }

  function resume(video) {
    if (!video || video.__gulRatingResumeChecked) return;
    var key = getCurrentKey();
    if (!key) return;

    var duration = getDuration(video);
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      var episode = detectEpisode(video);
      var storedPosition = episode && typeof bridge.getCurrentEpisodePosition === 'function'
        ? bridge.getCurrentEpisodePosition(episode.key)
        : bridge.getCurrentPosition();
      var position = JSON.parse(storedPosition || '{}');
      var target = Number(position && position.t);
      if (!Number.isFinite(target) || target < 30 || target >= duration - 10) {
        video.__gulRatingResumeChecked = true;
        return;
      }
      // Do not override a source's own resume state or a deliberate user seek.
      if (Number(video.currentTime) > 15) {
        video.__gulRatingResumeChecked = true;
        return;
      }
      video.currentTime = target;
      if (Math.abs(Number(video.currentTime) - target) <= 5) {
        video.__gulRatingResumeChecked = true;
        save(video, true);
      }
    } catch (error) {
      // A source may disallow seeking until its media pipeline is initialized.
      // Let the next metadata/duration event retry instead of marking it done.
    }
  }

  var shownRatingPrompts = new Set();

  function showRatingPrompt(video) {
    if (!bridge || typeof bridge.savePendingPlaybackRating !== 'function' || getDuration(video) < 120) return;
    var watchKey = getCurrentKey();
    var type = watchKey.split(':')[0];
    if (type !== 'movie' && type !== 'tv') return;
    var detectedEpisode = type === 'tv' ? detectEpisode(video) : null;
    var promptKey = type === 'movie' ? watchKey + ':movie' : watchKey + ':' + (detectedEpisode ? detectedEpisode.key : 'manual');
    if (shownRatingPrompts.has(promptKey)) return;
    shownRatingPrompts.add(promptKey);

    var overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', type === 'movie' ? 'Оценка фильма' : 'Оценка серии');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,23,.82);font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#f8fafc;';

    var card = document.createElement('div');
    card.style.cssText = 'box-sizing:border-box;width:min(420px,100%);max-height:90vh;overflow:auto;border:1px solid rgba(186,230,253,.3);border-radius:22px;padding:22px;background:rgba(15,23,42,.98);box-shadow:0 24px 80px rgba(0,0,0,.55);';
    var heading = document.createElement('h2');
    heading.textContent = type === 'movie' ? 'Оцените фильм' : 'Оцените серию';
    heading.style.cssText = 'margin:0 0 6px;font-size:21px;font-weight:750;';
    var description = document.createElement('p');
    var watchTitle = '';
    try { watchTitle = typeof bridge.getCurrentWatchTitle === 'function' ? bridge.getCurrentWatchTitle() : ''; } catch (error) { /* title is optional */ }
    description.textContent = type === 'movie'
      ? (watchTitle || document.title || 'Фильм закончился — поделитесь впечатлением.')
      : (watchTitle ? 'Сериал: «' + watchTitle + '». Ваша оценка серии будет общей с друзьями.' : 'Серия закончилась. Ваша оценка будет общей с друзьями.');
    description.style.cssText = 'margin:0 0 18px;color:#cbd5e1;font-size:14px;line-height:1.45;';
    card.appendChild(heading);
    card.appendChild(description);

    var seasonInput = null;
    var episodeInput = null;
    if (type === 'tv') {
      var episodeFields = document.createElement('div');
      episodeFields.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 16px;';
      [[ 'Сезон', detectedEpisode && detectedEpisode.season ], [ 'Серия', detectedEpisode && detectedEpisode.episode ]].forEach(function (field, index) {
        var label = document.createElement('label');
        label.textContent = field[0];
        label.style.cssText = 'display:flex;flex-direction:column;gap:5px;color:#cbd5e1;font-size:12px;';
        var input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = index === 0 ? '999' : '9999';
        input.step = '1';
        input.required = true;
        input.value = field[1] ? String(field[1]) : '';
        input.setAttribute('aria-label', field[0]);
        input.style.cssText = 'box-sizing:border-box;width:100%;border:1px solid #475569;border-radius:10px;padding:10px 12px;background:#0b1220;color:#fff;font:inherit;';
        label.appendChild(input);
        episodeFields.appendChild(label);
        if (index === 0) seasonInput = input;
        else episodeInput = input;
      });
      card.appendChild(episodeFields);
    }

    var ratingLabel = document.createElement('label');
    ratingLabel.textContent = 'Ваша оценка';
    ratingLabel.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:4px 0 8px;font-size:14px;color:#dbeafe;';
    var ratingOutput = document.createElement('strong');
    ratingOutput.textContent = '8.0';
    ratingOutput.style.cssText = 'font-size:24px;color:#7dd3fc;';
    ratingLabel.appendChild(ratingOutput);
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '1';
    slider.max = '10';
    slider.step = '0.1';
    slider.value = '8';
    slider.setAttribute('aria-label', 'Оценка от 1 до 10');
    slider.style.cssText = 'width:100%;accent-color:#38bdf8;margin:0 0 20px;';
    slider.addEventListener('input', function () { ratingOutput.textContent = Number(slider.value).toFixed(1); });
    card.appendChild(ratingLabel);
    card.appendChild(slider);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
    var later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'Позже';
    later.style.cssText = 'border:1px solid #475569;border-radius:11px;padding:10px 14px;background:#1e293b;color:#e2e8f0;font:inherit;';
    later.addEventListener('click', function () { overlay.remove(); });
    var save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Сохранить';
    save.style.cssText = 'border:0;border-radius:11px;padding:10px 16px;background:#0284c7;color:#fff;font-weight:700;font:inherit;';
    save.addEventListener('click', function () {
      var payload = { kind: type === 'movie' ? 'movie' : 'episode', rating: Number(slider.value) };
      if (type === 'tv') {
        var season = Number(seasonInput.value);
        var episodeNumber = Number(episodeInput.value);
        var episode = normalizeEpisode(season, episodeNumber);
        if (!episode) {
          description.textContent = 'Укажите корректные номера сезона и серии.';
          seasonInput.focus();
          return;
        }
        payload.season_number = episode.season;
        payload.episode_number = episode.episode;
        var currentTime = Number(video && video.currentTime);
        var duration = getDuration(video);
        if (Number.isFinite(currentTime) && duration > 0) {
          try {
            bridge.savePlaybackPosition(JSON.stringify({ t: currentTime, d: duration, force: true, episode: episode }));
          } catch (error) { /* the rating queue remains the primary action */ }
        }
      }
      save.disabled = true;
      var accepted = false;
      try { accepted = Boolean(bridge.savePendingPlaybackRating(JSON.stringify(payload))); } catch (error) { accepted = false; }
      if (!accepted) {
        save.disabled = false;
        description.textContent = 'Не удалось сохранить оценку. Попробуйте ещё раз.';
        return;
      }
      heading.textContent = 'Оценка сохранена';
      description.textContent = 'Синхронизируем её с GulRating при возвращении в приложение.';
      actions.remove();
      window.setTimeout(function () { overlay.remove(); }, 1700);
    });
    actions.appendChild(later);
    actions.appendChild(save);
    card.appendChild(actions);
    overlay.appendChild(card);
    (document.body || document.documentElement).appendChild(overlay);
    if (type === 'tv' && !detectedEpisode) seasonInput.focus();
    else save.focus();
  }

  function attach(video) {
    if (!video || hookedVideos.has(video)) return;
    hookedVideos.add(video);
    video.addEventListener('loadedmetadata', function () { resume(video); save(video, true); });
    video.addEventListener('durationchange', function () { resume(video); });
    video.addEventListener('timeupdate', function () { save(video, false); });
    video.addEventListener('pause', function () { save(video, true); });
    video.addEventListener('seeked', function () { save(video, true); });
    video.addEventListener('ended', function () {
      save(video, true);
      showRatingPrompt(video);
    });
    resume(video);
  }

  function scan(root, seenRoots) {
    if (!root || seenRoots.has(root)) return;
    seenRoots.add(root);
    try {
      if (root.matches && root.matches('video')) attach(root);
      if (root.querySelectorAll) {
        var videos = root.querySelectorAll('video');
        for (var i = 0; i < videos.length; i += 1) attach(videos[i]);
        // Some modern players put the media element inside an open shadow root.
        var elements = root.querySelectorAll('*');
        for (var j = 0; j < elements.length; j += 1) {
          if (elements[j].shadowRoot) scan(elements[j].shadowRoot, seenRoots);
        }
      }
    } catch (error) {
      // A detached or cross-origin root is skipped; sibling frames are scanned
      // by their own copy of this document-start script.
    }
  }

  function scanDocument() {
    try {
      if (!bridge.isPlaybackTrackingActive()) {
        if (scanTimer !== null) clearInterval(scanTimer);
        scanTimer = null;
        return;
      }
    } catch (error) {
      return;
    }
    scan(document, new Set());
  }

  function saveVisibleVideos() {
    var videos = document.querySelectorAll ? document.querySelectorAll('video') : [];
    for (var i = 0; i < videos.length; i += 1) save(videos[i], true);
  }

  scanDocument();
  scanTimer = setInterval(scanDocument, 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveVisibleVideos();
  });
  window.addEventListener('pagehide', saveVisibleVideos);
})();
