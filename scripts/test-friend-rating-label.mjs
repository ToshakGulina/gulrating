#!/usr/bin/env node
import assert from 'node:assert/strict';
import { friendRatingsLabel } from '../src/lib/ratingLabels.js';

const oneFriend = [{ profiles: { username: 'Тимоха' } }];
const twoFriends = [...oneFriend, { profiles: { username: 'Алиса' } }];

assert.equal(friendRatingsLabel([], 0), 'Ваша оценка');
assert.equal(friendRatingsLabel(oneFriend, 1), 'Тимоха');
assert.equal(friendRatingsLabel(oneFriend, 2), 'Друзья', 'two total ratings, including own, use the plural label');
assert.equal(friendRatingsLabel(twoFriends, 2), 'Друзья');
assert.equal(friendRatingsLabel([{ profiles: {} }], 1), 'Участник');
assert.equal(friendRatingsLabel(null, 0), 'Ваша оценка');

console.log('One total friend rating shows the friend name; multiple ratings show Друзья: OK');
