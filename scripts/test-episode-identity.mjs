import assert from 'node:assert/strict';
import { extractEpisodeIdentity, episodePositionKey } from '../src/lib/episodeIdentity.js';

assert.deepEqual(extractEpisodeIdentity('https://player.example/embed/title?season=2&episode=11'), {
  season: 2, episode: 11, key: 's02e11',
});
assert.deepEqual(extractEpisodeIdentity('show.S03E07.1080p.m3u8'), {
  season: 3, episode: 7, key: 's03e07',
});
assert.deepEqual(extractEpisodeIdentity('Тайтл — 2 сезон 5 серия'), {
  season: 2, episode: 5, key: 's02e05',
});
assert.deepEqual(extractEpisodeIdentity('Episode 9 / Season 1'), {
  season: 1, episode: 9, key: 's01e09',
});
assert.deepEqual(extractEpisodeIdentity('The.Show.4x03.WEB-DL'), {
  season: 4, episode: 3, key: 's04e03',
});
assert.equal(extractEpisodeIdentity('/catalog/123/45'), null,
  'ambiguous numeric paths are not mistaken for episode IDs');
assert.equal(extractEpisodeIdentity('movie-2025'), null,
  'a year in a title does not produce a false episode ID');
assert.equal(episodePositionKey('tv:123', { key: 's02e11' }), 'tv:123:episode:s02e11');
assert.equal(episodePositionKey('tv:123', null), null);
console.log('Episode identifiers parse explicit player season/episode metadata only: OK');
