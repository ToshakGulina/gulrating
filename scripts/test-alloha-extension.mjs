import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PLAYER_PROGRESS_HOSTS } from '../src/lib/playerProgressMessages.js';

const root = new URL('../browser-extension/alloha-progress/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const source = readFileSync(new URL('content.js', root), 'utf8');
const modal = readFileSync(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
const watchHistory = readFileSync(new URL('../src/lib/watchHistory.js', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../android/app/src/main/java/dev/gulrating/app/MainActivity.java', import.meta.url), 'utf8');
const firefoxPackager = readFileSync(new URL('../browser-extension/alloha-progress/package-firefox.sh', import.meta.url), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.content_scripts[0].all_frames, true,
  'the player observer must be injected into embedded Alloha frames');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.permissions.length, 0, 'the extension must not request unrelated browser permissions');
assert.equal(manifest.host_permissions.length, PLAYER_PROGRESS_HOSTS.length * 2,
  'site access must remain limited to the known player hosts and their subdomains');
assert.match(source, /BRIDGE_SOURCE = 'gulrating-player-progress-extension'/,
  'the extension uses the provider-neutral progress bridge');
for (const host of PLAYER_PROGRESS_HOSTS) {
  assert(manifest.host_permissions.includes(`https://${host}/*`), `host permission is scoped to ${host}`);
  assert(manifest.host_permissions.includes(`https://*.${host}/*`), `subdomain permission is scoped to ${host}`);
  assert(manifest.content_scripts[0].matches.includes(`https://${host}/*`), `${host} is actively monitored`);
  assert(manifest.content_scripts[0].matches.includes(`https://*.${host}/*`), `${host} subdomains are monitored`);
}

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
  location: { href: 'https://alloha.tv/embed/show?season=1&episode=2' },
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
assert.equal(hello.data.source, 'gulrating-player-progress-extension');
assert.equal(hello.data.duration, 1200);
assert.deepEqual(JSON.parse(JSON.stringify(hello.data.episode)), { season: 1, episode: 2, key: 's01e02' },
  'the extension identifies the current episode without sending account data');
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
assert.deepEqual(JSON.parse(JSON.stringify(seekReport.data.episode)), { season: 1, episode: 2, key: 's01e02' },
  'extension progress messages carry the episode identity for watch-history aggregation');

video.currentTime = 265;
video.paused = true;
video.dispatch('pause');
const pauseReport = sentToTop.find((item) => item.data.type === 'progress' && item.data.event === 'pause');
assert(pauseReport, 'pause should flush a final progress event');
assert.equal(pauseReport.data.currentTime, 265);

video.currentTime = 280;
listeners.get('pagehide')();
const finalReport = sentToTop.at(-1);
assert.equal(finalReport.data.type, 'progress', 'pagehide must flush the last cross-origin video position');
assert.equal(finalReport.data.currentTime, 280);
assert.equal(finalReport.data.event, 'pause');

const beforeInvalidReply = video.currentTime;
onMessage({
  source: topWindow,
  origin: 'https://malicious.example',
  data: { source: 'gulrating-website', type: 'resume', position: { t: 500, d: 1200 } },
});
assert.equal(video.currentTime, beforeInvalidReply, 'messages from non-GulRating origins must be ignored');

assert.match(modal, /PLAYER_PROGRESS_EXTENSION_SOURCES/);
assert.match(modal, /isSupportedPlayerProgressOrigin\(event\.origin\)/);
assert.match(modal, /'gulrating-alloha-extension'.*backwards-compatible/,
  'previously installed Alloha extensions remain supported during the bridge upgrade');
assert.match(modal, /const EMBED_ONLY_HOSTS = \[[^\]]*'alloha\.tv'[^\]]*'alloha\.cool'/,
  'known Alloha iframe hosts must stay embedded in the Android app instead of opening as a top-level page');
assert.equal(manifest.browser_specific_settings?.gecko?.id, 'alloha-progress@gulrating.pages.dev',
  'the same WebExtension package should have a stable Firefox extension id');
assert.ok(Number(manifest.browser_specific_settings?.gecko?.strict_min_version?.split('.')[0]) <= 109,
  'Firefox MV3 support must declare an explicit minimum Gecko version');
assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, [],
  'the Firefox manifest must declare that the extension does not collect user data');
assert.match(firefoxPackager, /zip -X -q -j .*manifest\.json content\.js icon-16\.png icon-48\.png icon-128\.png/,
  'the Firefox packaging script must create a flat XPI ready for Mozilla signing');
assert.match(await readFileSync(new URL('../browser-extension/alloha-progress/README.md', import.meta.url), 'utf8'),
  /about:debugging#\/runtime\/this-firefox/,
  'Firefox temporary installation instructions should be documented');
assert.match(modal, /event\.source\.postMessage\([\s\S]*?event\.origin\)/,
  'the website must reply directly to the active Alloha frame with an exact target origin');
assert.match(modal, /saveRemoteProgress\(progress\)/);
assert.match(modal, /Позиция сохранена:/,
  'the player overlay should distinguish an actual saved position from a connection handshake');
assert.match(watchHistory, /window\.GulRatingBridge\.savePlaybackPosition\(JSON\.stringify\(/,
  'remote progress messages in the Android overlay are persisted through the native bridge');
assert.match(activity, /public boolean savePlaybackPosition\(String json\)/,
  'the Android bridge reports whether a remote position was actually written');
assert.match(modal, /formatPlaybackTime\(progress\.t\)/);

console.log('Provider progress extension: scoped hosts, resume handshake, cross-origin saves and native bridge OK');
