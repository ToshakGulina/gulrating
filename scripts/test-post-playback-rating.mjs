import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const episodeRatings = await readFile(new URL('../src/lib/episodeRatings.js', import.meta.url), 'utf8');
const tracker = await readFile(new URL('../android/app/src/main/assets/player-progress-tracker.js', import.meta.url), 'utf8');

assert.match(modal, /video\.addEventListener\('ended',[\s\S]*?showPostPlaybackRating/,
  'same-origin HTML5 players open the rating card on end');
assert.match(modal, /progress\.event === 'ended'\) showPostPlaybackRating/,
  'cross-origin players with an ended message open the same rating card');
assert.match(modal, /id="watch-rate"/,
  'a manual post-watch button remains available for players that do not report ended');
assert.match(modal, /await saveRating\(currentUser\.id, titleId, 'movie'/,
  'movie ratings use the shared title ratings table');
assert.match(modal, /submitEpisodeRating\(currentUser\.id, titleId/,
  'series episodes use their own shared rating records');
assert.match(modal, /episodeRatingsPanel/,
  'series cards display friends’ episode-by-episode averages');
assert.match(modal, /id="episode-rating-form"/,
  'episode ratings can be entered directly from the series card');
assert.match(modal, /submitEpisodeRating\(currentUser\.id, titleId, season, episode/,
  'the card form saves an episode score for the selected season and episode');
assert.match(modal, /episode-rating-list/,
  'the episode score list refreshes in the open card after submission');
assert.match(modal, /if \(episode\) savedPosition = episodePosition;/,
  'a recognized new episode does not inherit the previous episode’s resume point');
assert.match(modal, /const latest = episode \? episodePosition :/,
  'the extension handshake resumes by episode when identity is available');
assert.match(episodeRatings, /unique\.size < expectedEpisodes/,
  'the automatic series score waits until every currently listed episode has a rating');
assert.match(main, /syncNativePlaybackRatings\(user\.id\)/,
  'native playback ratings synchronize after returning to the authenticated app shell');
assert.match(tracker, /savePendingPlaybackRating\(JSON\.stringify\(payload\)\)/,
  'the APK player card queues movie and episode scores without exposing credentials to providers');
console.log('Movie/episode end prompts, friend-visible episode scores, native queue, and series auto-average are wired: OK');
