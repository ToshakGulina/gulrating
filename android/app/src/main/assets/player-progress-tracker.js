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
      bridge.savePlaybackPosition(JSON.stringify({
        t: currentTime,
        d: duration,
        force: Boolean(force)
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
      var position = JSON.parse(bridge.getCurrentPosition() || '{}');
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

  function attach(video) {
    if (!video || hookedVideos.has(video)) return;
    hookedVideos.add(video);
    video.addEventListener('loadedmetadata', function () { resume(video); save(video, true); });
    video.addEventListener('durationchange', function () { resume(video); });
    video.addEventListener('timeupdate', function () { save(video, false); });
    video.addEventListener('pause', function () { save(video, true); });
    video.addEventListener('seeked', function () { save(video, true); });
    video.addEventListener('ended', function () { save(video, true); });
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
