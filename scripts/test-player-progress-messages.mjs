import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addSupportedResumeParameter, createPlayerJsMessage, isSupportedPlayerProgressOrigin, parsePlayerProgressMessage } from '../src/lib/playerProgressMessages.js';

const ratingModal = readFileSync(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');

assert.equal(isSupportedPlayerProgressOrigin('https://player.kodik.info'), true,
  'known player subdomains are accepted for extension progress reports');
assert.equal(isSupportedPlayerProgressOrigin('https://evilalloha.tv.attacker.example'), false,
  'suffix lookalikes cannot spoof a supported provider origin');
assert.equal(isSupportedPlayerProgressOrigin('http://kodik.info'), false,
  'player extension messages must use HTTPS origins');
assert.equal(isSupportedPlayerProgressOrigin('https://unlisted-player.example'), false,
  'unlisted third-party origins cannot send extension progress messages');

assert.deepEqual(parsePlayerProgressMessage({
  context: 'player.js',
  event: 'ready',
  value: { src: 'https://player.example/embed/42', methods: ['setCurrentTime', 'getCurrentTime'], events: ['timeupdate', 'pause'] },
}), {
  kind: 'ready',
  src: 'https://player.example/embed/42',
  methods: ['setCurrentTime', 'getCurrentTime'],
  events: ['timeupdate', 'pause'],
});

assert.deepEqual(parsePlayerProgressMessage(JSON.stringify({
  context: 'player.js', event: 'timeupdate', value: { seconds: 321.5, duration: 5400 }, listener: 'gulrating-timeupdate'
})), { kind: 'progress', event: 'timeupdate', t: 321.5, d: 5400, playerJs: true });

assert.deepEqual(parsePlayerProgressMessage({
  type: 'PLAYER_EVENT',
  data: { event: 'seeked', currentTime: 90, duration: 900 },
}), { kind: 'progress', event: 'seeked', t: 90, d: 900, playerJs: false });

// Actual documented VidAPI event shape (status/progress fields rather than event/currentTime).
assert.deepEqual(parsePlayerProgressMessage({
  type: 'PLAYER_EVENT',
  data: { player_status: 'playing', player_progress: 246.5, player_duration: 7200 },
}), { kind: 'progress', event: 'play', t: 246.5, d: 7200, playerJs: false });

// Some providers use a separate watching-log message rather than PLAYER_EVENT.
assert.deepEqual(parsePlayerProgressMessage({
  type: 'watching-log', currentTime: 47, duration: 600,
}), { kind: 'progress', event: 'timeupdate', t: 47, d: 600, playerJs: false });

assert.deepEqual(parsePlayerProgressMessage({
  source: 'player-api', event: 'pause', currentTime: 46, duration: 3600,
}), { kind: 'progress', event: 'pause', t: 46, d: 3600, playerJs: false });

assert.equal(parsePlayerProgressMessage({ event: 'ad-loaded', duration: 30, currentTime: 3 }), null,
  'unrelated iframe messages must not be treated as playback progress');
assert.equal(parsePlayerProgressMessage({ event: 'timeupdate', currentTime: 99, duration: 0 }), null,
  'zero/unknown duration must not overwrite useful saved progress');

assert.deepEqual(JSON.parse(createPlayerJsMessage('setCurrentTime', 321, 'resume-1')), {
  context: 'player.js', version: '0.0.11', method: 'setCurrentTime', value: 321, listener: 'resume-1'
});

const vidLinkUrl = addSupportedResumeParameter('https://vidlink.pro/movie/123', 'VidLink', 321.9);
assert.equal(new URL(vidLinkUrl).searchParams.get('startAt'), '321',
  'VidLink documents startAt as the cross-device resume parameter');
assert.equal(addSupportedResumeParameter('https://player.example/embed/123', 'Unknown', 321),
  'https://player.example/embed/123', 'unknown providers must not receive guessed query parameters');

assert.match(ratingModal, /isFromActivePlayer\(frame, event\.source\)/,
  'messages from nested descendants of the selected iframe are accepted without reading their DOM');
assert.match(ratingModal, /parsePlayerProgressMessage\(event\.data\)/);
assert.match(ratingModal, /saveRemoteProgress\(message\)/);
assert.match(ratingModal, /sendPlayerJsCommand\(frame, state, 'setCurrentTime', target\)/,
  'Player.js-compatible sources receive the saved resume time');

console.log('Browser cross-origin iframe progress messages and Player.js resume adapter: OK');
