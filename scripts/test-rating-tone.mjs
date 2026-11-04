import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ratingTone, ratingBadgeColor, ratingAccentRgb, ratingTextColor } from '../src/lib/ratingTone.js';

assert.equal(ratingTone(10), 'rating-score-perfect');
assert.equal(ratingTone(9.95), 'rating-score-perfect', 'an average displayed as 10.0 also receives the perfect-score tone');
assert.equal(ratingTone(9.9), 'rating-score-high');
assert.equal(ratingTone(8), 'rating-score-high');
assert.equal(ratingTone(7.9), 'rating-score-mid');
assert.equal(ratingTone(4.9), 'rating-score-low');
assert.equal(ratingBadgeColor(10), 'bg-amber-700');
assert.equal(ratingAccentRgb(10), '234 179 8');
assert.equal(ratingTextColor(10, '300'), 'rating-score-perfect-text');

const [feed, profile, modal, tracker, html, sw] = await Promise.all([
  readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8'),
  readFile(new URL('../android/app/src/main/assets/player-progress-tracker.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
]);
assert.match(feed, /ratingTone\(score\)[\s\S]*?ratingBadgeColor\(score\)/);
assert.match(profile, /ratingBadgeColor\(r\.rating\)[\s\S]*?ratingTone\(r\.rating\)/);
assert.match(modal, /ratingTextColor\(value, '300'\)[\s\S]*?ratingAccentRgb\(value\)/);
assert.match(tracker, /rounded >= 10 \? '#d4af37'/,
  'the Android end-of-playback slider also paints a perfect-ten score gold');
assert.match(html, /\.rating-score-badge\.rating-score-perfect[\s\S]*?background-color: #8c6b13/);
assert.match(html, /\.rating-score-perfect-text\s*\{\s*color: #f5cf5b/);
assert.match(html, /:root\[data-theme="nothing"\] \.rating-score-badge\.rating-score-perfect \{ --rating-score-color: #d4af37; \}/);
assert.match(html, /:root\[data-theme="glass"\] \.rating-score-badge\.rating-score-perfect/);
assert.match(sw, /gulrating-v90[\s\S]*?\/src\/lib\/ratingTone\.js/,
  'offline startup precaches the shared score-tone module');
console.log('Perfect tens use the gold score tone across feed, profile, episode prompts, slider accents, and Android: OK');
