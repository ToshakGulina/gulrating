import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../browser-extension/alloha-progress/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const source = readFileSync(new URL('content.js', root), 'utf8');
const modal = readFileSync(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.content_scripts[0].all_frames, true,
  'the player observer must be injected into embedded Alloha frames');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.permissions.length, 0, 'the extension must not request unrelated browser permissions');
assert(manifest.host_permissions.some((host) => host.includes('stravers.live')));
assert(manifest.host_permissions.some((host) => host.includes('alloha.tv')));
assert(manifest.host_permissions.some((host) => host.includes('alloha.cool')));

const listeners = new Map();
const sentToTop = [];
const topWindow = { postMessage: (data, targetOrigin) => sentToTop.push({ data, targetOrigin }) };
const videoListeners = new Map();
const video = {
  currentTime: 0,
  duration: 1200,
  paused: false,
  addEventListener(type, callback) {
    if (!videoListeners.has(type)) videoListeners.set(type, []);
    videoListeners.get(type).push(callback);
  },
  dispatch(type) {
    for (const callback of videoListeners.get(type) || []) callback({ type, target: this });
  },
};
const document = {
  querySelectorAll(selector) {
    if (selector === 'video') return [video];
    return [];
  },
};
const window = {
  top: topWindow,
  addEventListener(type, callback) { listeners.set(type, callback); },
};
class MutationObserver {
  observe() {}
}
const context = {
  window,
  document,
  MutationObserver,
  URL,
  Date,
  WeakMap,
  WeakSet,
  Number,
  Math,
  setInterval() { return 1; },
};
vm.runInNewContext(source, context, { filename: 'alloha-progress/content.js' });

const hello = sentToTop.find((item) => item.data.type === 'hello');
assert(hello, 'the extension should request the saved position when a video is ready');
assert.equal(hello.data.source, 'gulrating-alloha-extension');
assert.equal(hello.data.duration, 1200);
assert.equal(hello.targetOrigin, '*', 'the initial hello has no private or account data');

const onMessage = listeners.get('message');
assert(onMessage, 'the content script should listen for the website resume reply');
onMessage({
  source: topWindow,
  origin: 'https://gulrating.pages.dev',
  data: {
    source: 'gulrating-website',
    type: 'resume',
    position: { t: 240, d: 1200 },
  },
});
assert.equal(video.currentTime, 240, 'a valid saved position should be applied to the HTML5 video');
const seekReport = sentToTop.find((item) => item.data.type === 'progress' && item.data.event === 'seeked');
assert(seekReport, 'the successful resume should report its resulting position');
assert.equal(seekReport.targetOrigin, 'https://gulrating.pages.dev');
assert.equal(seekReport.data.currentTime, 240);

video.currentTime = 265;
video.paused = true;
video.dispatch('pause');
const pauseReport = sentToTop.find((item) => item.data.type === 'progress' && item.data.event === 'pause');
assert(pauseReport, 'pause should flush a final progress event');
assert.equal(pauseReport.data.currentTime, 265);

const beforeInvalidReply = video.currentTime;
onMessage({
  source: topWindow,
  origin: 'https://malicious.example',
  data: { source: 'gulrating-website', type: 'resume', position: { t: 500, d: 1200 } },
});
assert.equal(video.currentTime, beforeInvalidReply, 'messages from non-GulRating origins must be ignored');

assert.match(modal, /ALLOHA_EXTENSION_SOURCE/);
assert.match(modal, /isAllohaPlayerOrigin\(event\.origin\)/);
assert.match(modal, /event\.source\.postMessage\([\s\S]*?event\.origin\)/,
  'the website must reply directly to the active Alloha frame with an exact target origin');
assert.match(modal, /saveRemoteProgress\(progress\)/);

console.log('Alloha browser extension: scoped permissions, resume handshake, progress reporting and origin checks OK');
