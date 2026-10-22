import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateSeriesProgress } from '../src/lib/seriesProgress.js';

const positions = {
  'tv:123': { t: 240, d: 600, at: 3 },
  'tv:123:episode:s01e01': { t: 3600, d: 3600, at: 1 },
  'tv:123:episode:s01e02': { t: 1800, d: 3600, at: 2 },
  'tv:124:episode:s01e01': { t: 3600, d: 3600, at: 4 },
};
const progress = estimateSeriesProgress('tv:123', positions, { episodes: 10, episode_runtime: 60 });
assert.deepEqual(progress, {
  watchedSeconds: 5400,
  estimatedTotalSeconds: 36000,
  percent: 15,
  trackedEpisodes: 2,
  totalEpisodes: 10,
  estimated: false,
});
const fallback = estimateSeriesProgress('tv:123', positions, { episodes: 10 });
assert.equal(fallback.estimatedTotalSeconds, 36000, 'missing TMDb runtime uses observed episode duration');
assert.equal(fallback.estimated, true);
assert.equal(estimateSeriesProgress('tv:999', positions, { episodes: 0, episode_runtime: 40 }), null);
assert.equal(estimateSeriesProgress('tv:999', positions, { episodes: 12 }), null,
  'a series without recognized episodes does not invent watched time');
const profile = await readFile(new URL('../src/components/Profile.js', import.meta.url), 'utf8');
assert.match(profile, /Весь сериал:/, 'playback history shows the aggregate series progress separately');
assert.match(profile, /Запомнено в текущей серии:/, 'the current episode resume position remains visible separately');
console.log('Series progress aggregates unique per-episode positions against an estimated full-series runtime: OK');
