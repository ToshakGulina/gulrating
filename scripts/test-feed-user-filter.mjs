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

console.log('Main feed supports per-member ratings and watchlist filters with isolated offline caches: OK');
