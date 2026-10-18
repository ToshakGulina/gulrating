import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayerJsMessage, parsePlayerProgressMessage } from '../src/lib/playerProgressMessages.js';

const ratingModal = readFileSync(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');

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

assert.match(ratingModal, /event\.source !== frame\.contentWindow/,
  'cross-origin messages are accepted only from the selected iframe');
assert.match(ratingModal, /parsePlayerProgressMessage\(event\.data\)/);
assert.match(ratingModal, /saveRemoteProgress\(message\)/);
assert.match(ratingModal, /sendPlayerJsCommand\(frame, state, 'setCurrentTime', target\)/,
  'Player.js-compatible sources receive the saved resume time');

console.log('Browser cross-origin iframe progress messages and Player.js resume adapter: OK');
