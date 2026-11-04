import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const episodeRows = new Map();
const savedSeriesRatings = [];
const originalSupabase = globalThis.__mockEpisodeSupabase;
const originalEnsureTitle = globalThis.__mockEnsureEpisodeTitle;
const originalSaveRating = globalThis.__mockSaveSeriesRating;
let failEpisodeWrites = false;
const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
globalThis.__mockEnsureEpisodeTitle = async () => {};
globalThis.__mockSaveSeriesRating = async (...args) => { savedSeriesRatings.push(args); };
globalThis.__mockEpisodeSupabase = {
  from(table) {
    assert(['episode_ratings', 'ratings'].includes(table));
    const filters = {};
    const builder = {
      upsert(row) {
        assert.equal(table, 'episode_ratings');
        if (failEpisodeWrites) return Promise.resolve({ error: new Error('NetworkError') });
        episodeRows.set(`${row.user_id}:${row.title_id}:${row.season_number}:${row.episode_number}`, row);
        return Promise.resolve({ error: null });
      },
      select() { return builder; },
      eq(key, value) { filters[key] = value; return builder; },
      order() { return builder; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(resolve, reject) {
        if (table === 'ratings') return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        let rows = [...episodeRows.values()].filter(row =>
          Object.entries(filters).every(([key, value]) => String(row[key]) === String(value)));
        rows = rows.map(row => ({ ...row, profiles: { username: `user-${row.user_id}` } }));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  },
};

try {
  let source = await readFile(new URL('../src/lib/episodeRatings.js', import.meta.url), 'utf8');
  source = source
    .replace("import { supabase } from './supabase.js';", 'const supabase = globalThis.__mockEpisodeSupabase;')
    .replace("import { ensureTitleInDatabase, saveRating } from './ratings.js';", 'const ensureTitleInDatabase = globalThis.__mockEnsureEpisodeTitle; const saveRating = globalThis.__mockSaveSeriesRating;');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const { submitEpisodeRating, maybeUpdateSeriesRating, getEpisodeRatings, syncPendingEpisodeRatings, syncNativePlaybackRatings } = await import(moduleUrl);

  const first = await submitEpisodeRating('friend-a', 321, 1, 1, 8);
  assert.deepEqual(first.seriesRating, { rating: 8, episodes: 1 },
    'the series average is set as soon as the first watched episode is rated');
  const second = await submitEpisodeRating('friend-a', 321, 1, 2, 6.5);
  assert.deepEqual(second.seriesRating, { rating: 7.3, episodes: 2 },
    'the average is recalculated from all episode scores actually submitted');
  const final = await submitEpisodeRating('friend-a', 321, 1, 3, 9);
  assert.deepEqual(final.seriesRating, { rating: 7.8, episodes: 3 });
  assert.equal(savedSeriesRatings.length, 3);
  assert.deepEqual(savedSeriesRatings.map(args => args[3]), [8, 7.3, 7.8]);
  assert.equal(savedSeriesRatings[0][0], 'friend-a');
  assert.equal(savedSeriesRatings[0][2], 'tv');

  [7, 8, 9, 10, 6, 8].forEach((rating, index) => {
    episodeRows.set(`friend-c:777:1:${index + 1}`, {
      user_id: 'friend-c', title_id: 777, season_number: 1, episode_number: index + 1, rating,
    });
  });
  assert.deepEqual(await maybeUpdateSeriesRating('friend-c', 777), { rating: 8, episodes: 6 },
    'opening an older series with six existing episode ratings can backfill its missing series score');
  assert.equal(savedSeriesRatings.at(-1)[3], 8);

  const shared = await getEpisodeRatings(321);
  assert.equal(shared.length, 3, 'episode scores are retrievable for the shared friends view');
  assert.equal(shared[1].profiles.username, 'user-friend-a');

  failEpisodeWrites = true;
  const queued = await submitEpisodeRating('friend-b', 654, 1, 1, 7);
  assert.equal(queued.queued, true, 'a network failure keeps the episode score on-device');
  assert.equal(JSON.parse(storage.get('gulrating:pending_episode_ratings')).length, 1);
  assert.equal((await getEpisodeRatings(654, 'friend-a')).length, 0,
    'an offline rating queued by another local account is not shown in the current account');
  assert.equal((await getEpisodeRatings(654, 'friend-b')).length, 1,
    'the owning account can still see its offline episode rating');
  failEpisodeWrites = false;
  assert.equal(await syncPendingEpisodeRatings('friend-b'), 1, 'pending episode ratings retry after reconnection');
  assert.equal(storage.has('gulrating:pending_episode_ratings'), false);

  const nativeQueue = [{ queue_id: 'friend-b:tv:654:episode:s01e01', user_id: 'friend-b', kind: 'episode', title_id: 654, season_number: 1, episode_number: 1, rating: 7 }];
  const clearedNativeQueue = [];
  globalThis.window = { GulRatingBridge: {
    getPendingPlaybackRatings: () => JSON.stringify(nativeQueue),
    clearPendingPlaybackRating: id => clearedNativeQueue.push(id),
  } };
  assert.equal(await syncNativePlaybackRatings('friend-a'), 0,
    'a pending native score must not be assigned to a different account on the device');
  assert.equal(clearedNativeQueue.length, 0, 'the other account’s native queue remains intact');

  const ratingModal = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
  assert.match(ratingModal, /await maybeUpdateSeriesRating\(currentUser\.id, titleId\)\.catch\(\(\) => null\)/,
    'opening a series card backfills the average from episode ratings saved before the feature was added');
  assert.match(ratingModal, /id="episode-rating-score" type="range" min="1" max="10" step="0\.1"/,
    'episode ratings use the same tenth-point precision supported by storage and the main rating slider');

  const schema = await readFile(new URL('../supabase-schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.episode_ratings/);
  assert.match(schema, /Оценки серий видны одобренным/);
  assert.match(schema, /auth\.uid\(\) = user_id AND public\.is_approved\(\)/);
  assert.match(schema, /tablename = 'episode_ratings'[\s\S]*?ALTER PUBLICATION supabase_realtime ADD TABLE public\.episode_ratings/);
  console.log('Episode scores sync to friends and update the series average from rated episodes: OK');
} finally {
  globalThis.__mockEpisodeSupabase = originalSupabase;
  globalThis.__mockEnsureEpisodeTitle = originalEnsureTitle;
  globalThis.__mockSaveSeriesRating = originalSaveRating;
}
