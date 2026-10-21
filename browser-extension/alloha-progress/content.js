/*
 * GulRating player progress bridge.
 * This content script runs only on the explicitly listed Kinobox player
 * origins, including embedded frames, so it can read HTML5 video elements
 * the website itself cannot inspect because of the browser's same-origin policy.
 */
(() => {
  'use strict';

  const BRIDGE_SOURCE = 'gulrating-player-progress-extension';
  const WEBSITE_SOURCE = 'gulrating-website';
  const VALID_APP_HOST = (hostname) => hostname === 'gulrating.pages.dev'
    || hostname.endsWith('.gulrating.pages.dev')
    || hostname === 'localhost'
    || hostname === '127.0.0.1';
  const hookedVideos = new WeakSet();
  const perVideo = new WeakMap();
  let appOrigin = '';

  function allowedAppOrigin(origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return false;
      return VALID_APP_HOST(url.hostname);
    } catch (error) {
      return false;
    }
  }

  function durationOf(video) {
    const duration = Number(video && video.duration);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function currentTimeOf(video) {
    const time = Number(video && video.currentTime);
    return Number.isFinite(time) && time >= 0 ? time : 0;
  }

  function sendToApp(payload) {
    try {
      // The initial hello contains only the protocol version and duration.
      // Progress is sent to the exact GulRating origin after a validated reply.
      window.top.postMessage({ source: BRIDGE_SOURCE, version: 1, ...payload }, appOrigin || '*');
      return true;
    } catch (error) {
      return false;
    }
  }

  function stateFor(video) {
    let state = perVideo.get(video);
    if (!state) {
      state = {
        helloSentAt: 0,
        helloAttempts: 0,
        answered: false,
        resumeTarget: null,
        resumeFinished: false,
        lastSentAt: 0,
      };
      perVideo.set(video, state);
    }
    return state;
  }

  function requestResume(video, state) {
    if (state.answered || durationOf(video) <= 0 || state.helloAttempts >= 20) return;
    const now = Date.now();
    if (now - state.helloSentAt < 1500) return;
    state.helloSentAt = now;
    state.helloAttempts += 1;
    sendToApp({
      type: 'hello',
      duration: durationOf(video),
    });
  }

  function tryResume(video, state) {
    const target = Number(state.resumeTarget);
    const duration = durationOf(video);
    if (state.resumeFinished || !Number.isFinite(target) || target < 30 || duration <= 0) return;
    if (target >= duration - 10 || currentTimeOf(video) > 15) {
      state.resumeFinished = true;
      return;
    }
    try {
      video.currentTime = target;
      if (Math.abs(currentTimeOf(video) - target) <= 5) {
        state.resumeFinished = true;
        reportProgress(video, state, 'seeked', true);
      }
    } catch (error) {
      // Some players reject seeking until the media pipeline is ready. Retry
      // on loadedmetadata/durationchange/timeupdate without marking it done.
    }
  }

  function reportProgress(video, state, eventName, force = false) {
    if (!appOrigin || !state.answered) return;
    const currentTime = currentTimeOf(video);
    const duration = durationOf(video);
    if (currentTime <= 0 || duration <= 0 || currentTime > duration + 30) return;
    if (!force && video.paused) return;
    const now = Date.now();
    if (!force && now - state.lastSentAt < 4000) return;
    state.lastSentAt = now;
    sendToApp({
      type: 'progress',
      event: eventName,
      currentTime,
      duration,
    });
  }

  function attach(video) {
    if (!video || hookedVideos.has(video)) return;
    hookedVideos.add(video);
    const state = stateFor(video);
    const ready = () => {
      requestResume(video, state);
      tryResume(video, state);
    };
    video.addEventListener('loadedmetadata', ready);
    video.addEventListener('durationchange', ready);
    video.addEventListener('timeupdate', () => {
      ready();
      reportProgress(video, state, 'timeupdate');
    });
    video.addEventListener('pause', () => reportProgress(video, state, 'pause', true));
    video.addEventListener('seeked', () => reportProgress(video, state, 'seeked', true));
    video.addEventListener('ended', () => reportProgress(video, state, 'ended', true));
    ready();
  }

  function scan(root, seen) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    try {
      if (root.matches && root.matches('video')) attach(root);
      if (!root.querySelectorAll) return;
      for (const video of root.querySelectorAll('video')) attach(video);
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) scan(element.shadowRoot, seen);
      }
    } catch (error) {
      // Detached/shadow player subtrees are revisited by the observer.
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window.top || !allowedAppOrigin(event.origin)
        || !data || data.source !== WEBSITE_SOURCE || data.type !== 'resume') return;
    appOrigin = event.origin;

    const position = data.position;
    const target = Number(position && position.t);
    const duration = Number(position && position.d);
    if (!Number.isFinite(target) || !Number.isFinite(duration) || target < 30 || duration <= 0) {
      // The site answered; wait for a later load/new overlay instead of probing forever.
      document.querySelectorAll('video').forEach((video) => { stateFor(video).answered = true; });
      return;
    }

    document.querySelectorAll('video').forEach((video) => {
      const state = stateFor(video);
      state.answered = true;
      state.resumeTarget = target;
      tryResume(video, state);
    });
  });

  function scanDocument() {
    scan(document, new WeakSet());
  }

  window.addEventListener('pagehide', () => {
    document.querySelectorAll('video').forEach((video) => {
      const state = stateFor(video);
      reportProgress(video, state, video.paused ? 'pause' : 'timeupdate', true);
    });
  });

  scanDocument();
  try {
    new MutationObserver(scanDocument).observe(document, { childList: true, subtree: true });
  } catch (error) {
    // A periodic scan covers old or unusual embedded-player DOMs.
  }
  setInterval(scanDocument, 1500);
})();
