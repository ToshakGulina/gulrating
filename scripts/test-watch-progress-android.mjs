import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tracker = readFileSync(new URL('../android/app/src/main/assets/player-progress-tracker.js', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../android/app/src/main/java/dev/gulrating/app/MainActivity.java', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');

class FakeVideo {
  constructor() {
    this.duration = 1200;
    this.currentTime = 0;
    this.paused = true;
    this.ended = false;
    this.seekable = { length: 0 };
    this.events = new Map();
  }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(callback);
  }
  emit(name) {
    for (const callback of this.events.get(name) || []) callback();
  }
}

function runTracker({ active = true, savedTime = 180 } = {}) {
  const video = new FakeVideo();
  const writes = [];
  const intervals = [];
  let now = 10_000;
  const documentEvents = new Map();
  const windowEvents = new Map();
  const bridge = {
    isPlaybackTrackingActive: () => active,
    getCurrentWatchKey: () => 'movie:42',
    getCurrentPosition: () => JSON.stringify({ t: savedTime, d: 1200, at: 1 }),
    savePlaybackPosition: (value) => writes.push(JSON.parse(value)),
  };
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => documentEvents.set(name, fn),
    querySelectorAll: (selector) => selector === 'video' ? [video] : [],
  };
  const window = {
    GulRatingBridge: bridge,
    addEventListener: (name, fn) => windowEvents.set(name, fn),
  };
  const setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  const clearInterval = () => {};
  const Clock = { now: () => now };
  new Function('window', 'document', 'setInterval', 'clearInterval', 'Date', tracker)(
    window, document, setInterval, clearInterval, Clock
  );
  return { video, writes, intervals, documentEvents, windowEvents, advance: (ms) => { now += ms; } };
}

const active = runTracker();
assert.equal(active.video.currentTime, 180, 'a saved position is applied when the player frame loads');
assert.equal(active.writes.at(-1)?.t, 180, 'resume position is persisted natively');

active.advance(4000);
active.video.paused = false;
active.video.currentTime = 250;
active.video.emit('timeupdate');
assert.equal(active.writes.at(-1)?.t, 250, 'timeupdate records playback progress');

active.video.paused = true;
active.video.currentTime = 300;
active.video.emit('pause');
assert.equal(active.writes.at(-1)?.t, 300, 'pause forces the latest position to be saved');
assert.equal(active.writes.at(-1)?.force, true);

const inactive = runTracker({ active: false });
assert.equal(inactive.intervals.length, 0, 'the tracker is dormant outside an active player session');
assert.equal(inactive.writes.length, 0);

assert.match(activity, /WebViewCompat\.addDocumentStartJavaScript\(web, script,\s*java\.util\.Collections\.singleton\("\*"\)\)/,
  'the script is installed at document-start in all origins, including embedded frames');
assert.match(activity, /storePlaybackPosition\(currentWatchKey,[\s\S]*?o\.optDouble\("t"/);
assert.match(gradle, /androidx\.webkit:webkit:1\.12\.1/);

console.log('Android progress tracker resumes and saves video time from embedded frames: OK');
