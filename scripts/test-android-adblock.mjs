#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const java = await readFile(new URL('../android/app/src/main/java/dev/gulrating/app/MainActivity.java', import.meta.url), 'utf8');
const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const list = java.match(/AD_HOST_SUFFIXES\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1];
assert.ok(list, 'the Android WebView has a bundled ad-host blocklist');
const domains = [...list.matchAll(/"([a-z0-9.-]+)"/gi)].map(match => match[1]);
assert(domains.length >= 30, 'the built-in filter covers common video ad and popunder networks');

const isBlocked = host => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
for (const host of [
  'doubleclick.net', 'securepubads.g.doubleclick.net', 'clickadu.com',
  'cdn.adskeeper.com', 'popads.net', 'adfox.ru',
]) assert.equal(isBlocked(host), true, `${host} should be filtered`);
for (const host of [
  'kinokino.vip', 'alloha.cool', 'kodik.info', 'videocdn.net',
  'notdoubleclick.net', 'example.com.doubleclick.net.evil.test',
]) assert.equal(isBlocked(host), false, `${host} must not be mistaken for an ad host`);

assert.match(java, /normalized\.equals\(suffix\) \|\| normalized\.endsWith\("\." \+ suffix\)/,
  'host matching is suffix-safe and does not overblock deceptive domains');
assert.match(java, /return !request\.isForMainFrame\(\) && hasExplicitAdPath\(uri\)/,
  'path-based rules only affect embedded subresources, not legitimate navigation');
assert.match(java, /return new WebResourceResponse\("text\/plain", "UTF-8", 204, "No Content"/,
  'blocked requests receive an empty no-content response');
assert.match(java, /isBlockedAdResource\(uri\)[\s\S]*?blockedAdResponse\(\)/,
  'the Android service-worker interception path applies the same filter');
assert.match(java, /shouldBlockAdRequest\(request\)[\s\S]*?blockedAdResponse\(\)/,
  'the regular WebView resource path filters ads');
assert.match(java, /if \(isBlockedAdHost\(host\)[\s\S]*?return true;/,
  'popunder navigation is stopped before player-session routing');
for (const playerHost of ['kinokino.vip', 'alloha.cool', 'kodik.info']) {
  assert(java.includes(`"${playerHost}"`), `${playerHost} remains an allowed playback provider`);
}
assert.match(gradle, /versionCode 31[\s\S]*?versionName '1\.0\.31'/,
  'the ad-filtered APK has a new installable version');

console.log('Android WebView ad filtering preserves player hosts and blocks common ad networks: OK');
