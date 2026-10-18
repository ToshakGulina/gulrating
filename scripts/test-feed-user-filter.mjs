#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { feedUserOptions, selectedFeedUserId, feedRatingsCacheKey } from '../src/lib/feedPeople.js';

const currentUser = { id: 'self', profile: { username: 'Анна' } };
const options = feedUserOptions([
  { id: 'friend-b', username: 'Борис' },
  { id: 'friend-a', username: 'Алиса' },
  { id: 'friend-a', username: 'Дубликат' },
], currentUser);
assert.deepEqual(options.map(person => person.id), ['self', 'friend-a', 'friend-b']);
assert.equal(options[0].username, 'Анна');
assert.equal(options[1].username, 'Алиса');
assert.equal(selectedFeedUserId('all'), '');
assert.equal(selectedFeedUserId('friend-a'), 'friend-a');
assert.notEqual(feedRatingsCacheKey('all', 'friend-a'), feedRatingsCacheKey('all', 'friend-b'));
assert.equal(feedRatingsCacheKey('all', ''), 'all:all');

const source = await readFile(new URL('../src/components/Feed.js', import.meta.url), 'utf8');
assert.match(source, /id="ratings-user-select"/);
assert.match(source, /from\('profiles'\)\.select\('id, username'\)/);
assert.match(source, /query\.eq\('user_id', selectedUserId\)/);
assert.match(source, /watchlistQuery\.eq\('user_id', selectedUserId\)/);
assert.match(source, /feedRatingsCacheKey\(filter, userSelection\)/);
const searchRatingsSource = source.split('async function getSearchRatings')[1]?.split('function readSort')[0] || '';
assert.ok(searchRatingsSource, 'search results should load all available participant scores');
assert.match(searchRatingsSource, /select\('title_id, rating, user_id, profiles!inner\(username\)'\)/);
assert.match(searchRatingsSource, /\.in\('title_id', ids\)/);
assert.doesNotMatch(searchRatingsSource, /\.eq\('user_id'/,
  'search rating lookup should include all visible participants, not only the signed-in user');
assert.match(source, /renderSearchRatings\(ratingsByTitle\.get\(String\(item\.id\)\)\)/);
assert.doesNotMatch(source, /feed-status-select/, 'status control belongs in the title card, not the home feed');
const modalSource = await readFile(new URL('../src/components/RatingModal.js', import.meta.url), 'utf8');
assert.match(modalSource, /id="title-status-select"/, 'keep status selection in the title card under its poster');

console.log('Main feed supports per-member ratings and watchlist filters with isolated offline caches: OK');
